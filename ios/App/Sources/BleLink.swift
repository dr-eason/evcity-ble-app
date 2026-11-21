import CoreBluetooth
import EVCCore
import Foundation

/// 真蓝牙。逐条对应 Android `MainActivity.java` 的扫描、连接、发现服务、开通知、写入、心跳、读状态。
/// 所有回调都在主线程（CBCentralManager 的 queue 传 .main），和 Java 里全部 post 到主 Handler 一样。
final class BleLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private static let namePrefix = "EVC"
    private static let serviceID = CBUUID(string: "55535343-FE7D-4AE5-8FA9-9FAFD205E455")
    /// 桩 → 手机，通知。
    private static let txID = CBUUID(string: "49535343-8841-43F4-A8D4-ECBE34729BB3")
    /// 手机 → 桩，写。
    private static let rxID = CBUUID(string: "49535343-1E4D-4BD9-BA61-23C647249616")

    private struct Found {
        var name: String
        var rssi: Int
        var peripheral: CBPeripheral
    }

    /// 发给页面的事件。
    var onEvent: ((BridgeEvent) -> Void)?
    /// 协商到的 MTU 变了。
    var onMtu: ((Int) -> Void)?

    private var central: CBCentralManager?
    private var found: [String: Found] = [:]
    private var foundOrder: [String] = []
    private var scanning = false
    private var wantScan = false

    private var peripheral: CBPeripheral?
    private var notifyChar: CBCharacteristic?
    private var writeChar: CBCharacteristic?
    private var servicesLeft = 0
    private var notifySet = false
    private var linkUp = false
    private var connectSeq = 0

    private var parser = FrameParser()
    private var writes = WriteQueue()
    private var writing = false
    private var notReadyTries = 0
    private var mtu = LinkMtu.base

    private var statSeen = false
    private var statusTries = 0
    private var heartbeatTime = false
    private var heartbeatTimer: Timer?
    private var flushTimer: Timer?

    // MARK: 页面调过来的

    /// 正在扫就停，否则开始扫。
    func toggleScan() {
        if scanning {
            stopScan()
        } else {
            // 还在等权限框或者蓝牙状态时再点一次：接着等，状态来了就开始扫。
            beginScan()
        }
    }

    func stopScan() {
        scanning = false
        wantScan = false
        if let central = central, central.state == .poweredOn {
            central.stopScan()
        }
        emit(.scan(false))
    }

    func connect(_ address: String) {
        stopScan()
        guard let item = found[address] else {
            note("这个充电桩已经不在附近")
            emit(.page("scan"))
            return
        }
        closeLink()
        connectSeq += 1
        let seq = connectSeq
        emit(.page("charge"))
        note("正在连接 " + item.name)
        let target = item.peripheral
        // Android 上扫描没停稳就连会等很久，那边等 200 ms，这里照做。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self = self, seq == self.connectSeq else {
                return
            }
            guard let central = self.central, central.state == .poweredOn else {
                self.note("请先打开手机蓝牙")
                self.emit(.page("scan"))
                return
            }
            self.peripheral = target
            target.delegate = self
            central.connect(target, options: nil)
        }
    }

    /// 页面点了断开。
    func disconnect() {
        linkUp = false
        closeLink()
        emit(.page("scan"))
        note("蓝牙已断开")
    }

    func send(_ command: String) {
        writes.enqueue(command: command)
        pumpWrite()
    }

    func setHeartbeatTime(_ on: Bool) {
        heartbeatTime = on
    }

    /// Android 这里是 requestConnectionPriority(HIGH / BALANCED)。iOS 没有让 App 改连接间隔的接口，
    /// 间隔由系统和外设商定，所以这里什么也不做。升级期间不让屏幕自动锁在 MainViewController 里处理。
    func setLinkFast(_ on: Bool) {
    }

    /// 重启界面之前：停扫、断开，不发事件之外的东西。
    func shutdown() {
        stopScan()
        linkUp = false
        closeLink()
    }

    // MARK: 扫描

    private func ensureCentral() -> CBCentralManager {
        if let central = central {
            return central
        }
        // 第一次建会弹系统的蓝牙权限框，所以拖到第一次扫描时才建。
        let made = CBCentralManager(delegate: self, queue: .main)
        central = made
        return made
    }

    private func beginScan() {
        let central = ensureCentral()
        switch central.state {
        case .poweredOn:
            break
        case .unknown, .resetting:
            // 刚建好或者用户还在看权限框。等 centralManagerDidUpdateState 再来。
            wantScan = true
            return
        case .unauthorized:
            emit(.scan(false))
            note("需要蓝牙权限才能查找充电桩")
            return
        case .poweredOff:
            emit(.scan(false))
            note("请先打开手机蓝牙")
            return
        default:
            emit(.scan(false))
            note("这台手机不能扫描蓝牙")
            return
        }
        found.removeAll()
        foundOrder.removeAll()
        emitDevices()
        scanning = true
        emit(.scan(true))
        note("正在扫描")
        // 允许重复上报，信号强度才会跟着变，和 Android 的 SCAN_MODE_LOW_LATENCY 一样。
        central.scanForPeripherals(withServices: nil,
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .unknown || central.state == .resetting {
            return
        }
        if wantScan {
            wantScan = false
            beginScan()
            return
        }
        if central.state != .poweredOn {
            // 用户在控制中心关了蓝牙，或者在设置里收回了权限。
            if scanning {
                scanning = false
                emit(.scan(false))
            }
            if peripheral != nil {
                let wasUp = linkUp
                linkUp = false
                closeLink()
                emit(.page("scan"))
                note(wasUp ? "蓝牙已断开" : "请先打开手机蓝牙")
            }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard scanning else {
            return
        }
        let advertised = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        guard let name = advertised ?? peripheral.name,
              name.uppercased().hasPrefix(Self.namePrefix) else {
            return
        }
        let address = peripheral.identifier.uuidString
        if found[address] == nil {
            foundOrder.append(address)
        }
        found[address] = Found(name: name, rssi: RSSI.intValue, peripheral: peripheral)
        emitDevices()
    }

    // MARK: 连接

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === self.peripheral else {
            return
        }
        linkUp = true
        emit(.page("charge"))
        note("已连接，正在发现服务")
        notifySet = false
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        // Android 连不上时（linkUp 还是 false）什么也不报，界面停在「正在连接」，用户点返回。这里一样。
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        guard peripheral === self.peripheral, linkUp else {
            return
        }
        linkUp = false
        closeLink()
        emit(.page("scan"))
        note("蓝牙已断开")
    }

    private func closeLink() {
        connectSeq += 1
        heartbeatTime = false
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        flushTimer?.invalidate()
        flushTimer = nil
        parser.reset()
        writes.clear()
        writing = false
        notReadyTries = 0
        notifySet = false
        notifyChar = nil
        writeChar = nil
        servicesLeft = 0
        if let old = peripheral {
            old.delegate = nil
            central?.cancelPeripheralConnection(old)
            peripheral = nil
        }
    }

    // MARK: 服务和特征值

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard peripheral === self.peripheral else {
            return
        }
        if error != nil {
            note("发现服务失败")
            return
        }
        let services = peripheral.services ?? []
        if services.isEmpty {
            note("没有找到可收发的特征值")
            return
        }
        servicesLeft = services.count
        for service in services {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        guard peripheral === self.peripheral, servicesLeft > 0 else {
            return
        }
        servicesLeft -= 1
        if servicesLeft > 0 {
            return
        }
        pickCharacteristics(peripheral)
        guard let notifyChar = notifyChar, writeChar != nil else {
            note("没有找到可收发的特征值")
            return
        }
        refreshMtu()
        startHeartbeat()
        // 先开通知并读状态，和 Android 的顺序一样。
        enableNotify(peripheral, notifyChar)
    }

    private func pickCharacteristics(_ peripheral: CBPeripheral) {
        let services = peripheral.services ?? []
        if let known = services.first(where: { $0.uuid == Self.serviceID }) {
            let list = known.characteristics ?? []
            notifyChar = list.first(where: { $0.uuid == Self.txID })
            writeChar = list.first(where: { $0.uuid == Self.rxID })
        }
        if notifyChar != nil && writeChar != nil {
            return
        }
        // 没有认识的服务：随便找一个能通知的、一个能写的。
        for service in services {
            for characteristic in service.characteristics ?? [] {
                let properties = characteristic.properties
                if notifyChar == nil && properties.contains(.notify) {
                    notifyChar = characteristic
                }
                if writeChar == nil && (properties.contains(.write) || properties.contains(.writeWithoutResponse)) {
                    writeChar = characteristic
                }
            }
        }
    }

    private func enableNotify(_ peripheral: CBPeripheral, _ characteristic: CBCharacteristic) {
        if notifySet {
            return
        }
        notifySet = true
        if characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) {
            peripheral.setNotifyValue(true, for: characteristic)
        } else {
            beginStatus()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard peripheral === self.peripheral, characteristic === notifyChar else {
            return
        }
        // Android 的 onDescriptorWrite 不看成不成功都往下走，这里一样。
        beginStatus()
    }

    private func beginStatus() {
        note("已连上，正在读取充电桩状态")
        statusTries = 0
        statSeen = false
        requestStatus()
    }

    /// 没收到 STAT 就每 700 ms 再问一次，最多 5 次。
    private func requestStatus() {
        if statSeen || peripheral == nil || statusTries >= 5 {
            return
        }
        statusTries += 1
        send("STATUS")
        let seq = connectSeq
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            guard let self = self, seq == self.connectSeq else {
                return
            }
            self.requestStatus()
        }
    }

    // MARK: 心跳

    private func startHeartbeat() {
        heartbeatTimer?.invalidate()
        let timer = Timer(timeInterval: Heartbeat.interval, repeats: true) { [weak self] _ in
            self?.beat()
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeatTimer = timer
        beat()
    }

    private func beat() {
        guard peripheral != nil, writeChar != nil else {
            return
        }
        let now = Date()
        let line = Heartbeat.line(timeEnabled: heartbeatTime,
                                  busy: writing || !writes.isEmpty,
                                  nowMs: Int64(now.timeIntervalSince1970 * 1000),
                                  tzOffsetMs: TimeZone.current.secondsFromGMT(for: now) * 1000)
        send(line)
    }

    // MARK: 写

    private func refreshMtu() {
        guard let peripheral = peripheral else {
            return
        }
        let value = LinkMtu.fromMaxWrite(peripheral.maximumWriteValueLength(for: .withoutResponse))
        if value != mtu {
            mtu = value
            onMtu?(value)
        }
    }

    /// 一次写一包。带应答的写等 didWriteValueFor；不带应答的写看 canSendWriteWithoutResponse，
    /// 系统缓冲满了就等 peripheralIsReady(toSendWriteWithoutResponse:)。
    private func pumpWrite() {
        guard !writing, let peripheral = peripheral, let writeChar = writeChar else {
            return
        }
        refreshMtu()
        let noResponse = writeChar.properties.contains(.writeWithoutResponse)
        let type: CBCharacteristicWriteType = noResponse ? .withoutResponse : .withResponse
        let payload = min(LinkMtu.payload(mtu: mtu), peripheral.maximumWriteValueLength(for: type))
        while !writes.isEmpty {
            if noResponse && !peripheral.canSendWriteWithoutResponse && notReadyTries < 5 {
                // 正常由 peripheralIsReady 接着发。那个回调偶尔不来，所以 200 ms 后自己再看一次，
                // 连着 5 次都没好就直接写。
                notReadyTries += 1
                let seq = connectSeq
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    guard let self = self, seq == self.connectSeq else {
                        return
                    }
                    self.pumpWrite()
                }
                return
            }
            notReadyTries = 0
            guard let bytes = writes.next(payload: payload) else {
                return
            }
            peripheral.writeValue(Data(bytes), for: writeChar, type: type)
            if !noResponse {
                writing = true
                return
            }
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        guard peripheral === self.peripheral else {
            return
        }
        notReadyTries = 0
        pumpWrite()
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard peripheral === self.peripheral else {
            return
        }
        writing = false
        pumpWrite()
    }

    // MARK: 收

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard peripheral === self.peripheral, characteristic === notifyChar,
              let value = characteristic.value, !value.isEmpty else {
            return
        }
        deliver(parser.append([UInt8](value)))
        // 一行可能拆在两个通知里。停 120 ms 还凑不齐就按现有的试一次，然后清掉。
        flushTimer?.invalidate()
        flushTimer = nil
        if parser.hasPending {
            let timer = Timer(timeInterval: FrameParser.flushDelay, repeats: false) { [weak self] _ in
                guard let self = self else {
                    return
                }
                self.flushTimer = nil
                self.deliver(self.parser.flush())
            }
            RunLoop.main.add(timer, forMode: .common)
            flushTimer = timer
        }
    }

    private func deliver(_ lines: [String]) {
        for line in lines {
            if line.hasPrefix("STAT ") {
                statSeen = true
            }
            emit(.line(line))
        }
    }

    // MARK: 发事件

    private func emit(_ event: BridgeEvent) {
        onEvent?(event)
    }

    private func note(_ text: String) {
        emit(.note(text))
    }

    private func emitDevices() {
        let list = foundOrder.compactMap { address -> BridgeDevice? in
            guard let item = found[address] else {
                return nil
            }
            return BridgeDevice(name: item.name, addr: address, rssi: item.rssi)
        }
        emit(.devs(list))
    }
}
