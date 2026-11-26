import Foundation

/// 合并后（AC06 + M01）一个 App 连两种桩。行首表和可显示行按这次连的是哪种选，不合成一张：
/// AC06 的 "ORD "、"STAT "、"PLUG " 放到 M01 的行里会把一行从中间切开。
public enum ChargerKind: String {
    case ac06
    case m01
}

/// 把蓝牙通知里的字节拼成一行一行的文本。
/// 逐句对应 Android `MainActivity.java` 的 appendPending / takeFrames / frameEnd / nextHead /
/// insideLongerHead / acceptFrame / printableLine / knownLine，改这里之前先对照那边。
public struct FrameParser {
    /// 和 Java 的 FRAME_HEADS_AC06 同一张表、同一个顺序。
    public static let frameHeadsAC06: [[UInt8]] = [
        "STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ",
        "IMAX ", "SCHED ", "ORD ", "ORDDONE", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "OCFW ",
    ].map { Array($0.utf8) }
    /// 和 Java 的 FRAME_HEADS_M01 同一张表、同一个顺序（M01 的状态行、应答、订单都以 "ACK " 开头）。
    public static let frameHeadsM01: [[UInt8]] = [
        "WCFG ", "FLT ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ", "ORDDONE", "TEL ",
        "WIFISW ", "OCPPSW ", "NETSTOP ", "OCFW ",
    ].map { Array($0.utf8) }
    /// 以前只有 AC06 一张表，留着这个名字。
    public static let frameHeads: [[UInt8]] = frameHeadsAC06

    /// 这次连接用哪张表。连接前由页面的 EVC.setProfile 设；第一行状态和它不一样时自己换。
    public var profile: ChargerKind = .ac06
    /// 这次连接认出来的类型（第一行状态：STAT 是 AC06，ACK SYS 是 M01）。
    public private(set) var kind: ChargerKind?
    private var kindFresh = false

    private var heads: [[UInt8]] {
        return profile == .m01 ? Self.frameHeadsM01 : Self.frameHeadsAC06
    }

    /// Java 的 rxBuf 大小。
    public static let capacity = 2048
    /// 一行最多这么多字节，再长就丢。
    public static let maxLineBytes = 380
    /// 半行在缓冲里最多等这么久（秒），到时调 `flush()`。
    public static let flushDelay: TimeInterval = 0.120

    private var buf: [UInt8] = []

    public init() {}

    /// 缓冲里还有没凑成一行的字节。为 true 时调用方要起一个 `flushDelay` 的定时器。
    public var hasPending: Bool { !buf.isEmpty }

    /// 断开、重新连接时调：缓冲和认出来的类型都清掉，行首表（profile）留着。
    public mutating func reset() {
        buf.removeAll(keepingCapacity: true)
        kind = nil
        kindFresh = false
    }

    /// 刚认出来的类型，只返回一次（BleLink 拿它发 {t:"kind"}）。
    public mutating func takeKind() -> ChargerKind? {
        if !kindFresh {
            return nil
        }
        kindFresh = false
        return kind
    }

    /// 一行状态是哪种桩的。不是状态行返回 nil。
    public static func kindOfStatus(_ line: String) -> ChargerKind? {
        if line.hasPrefix("STAT ") {
            return .ac06
        }
        if line.hasPrefix("ACK SYS\t") || line.hasPrefix("ACK PORTS\t") {
            return .m01
        }
        return nil
    }

    /// 一帧变成一行：先看是不是状态行（认类型、换表），再按这次的表过滤。
    private mutating func accept(_ raw: [UInt8]) -> String? {
        guard let line = Self.decode(raw) else {
            return nil
        }
        if kind == nil, let found = Self.kindOfStatus(line) {
            kind = found
            kindFresh = true
            profile = found
        }
        if !Self.printableLine(line) || !Self.knownLine(line, profile: profile) {
            return nil
        }
        return line
    }

    /// 收到一个通知。返回这次能送给界面的行（已经过滤）。
    public mutating func append(_ value: [UInt8]) -> [String] {
        if value.isEmpty {
            return []
        }
        if buf.count + value.count > Self.capacity {
            buf.removeAll(keepingCapacity: true)
        }
        if value.count <= Self.capacity {
            buf.append(contentsOf: value)
        }
        return takeFrames()
    }

    /// 定时器到点：把剩下的半行当成一行试一次，然后清空。
    public mutating func flush() -> [String] {
        let rest = buf
        buf.removeAll(keepingCapacity: true)
        if let line = accept(rest) {
            return [line]
        }
        return []
    }

    private static func isBreak(_ byte: UInt8) -> Bool {
        return byte == 0x0A || byte == 0x0D
    }

    private mutating func dropLeading() {
        var count = 0
        while count < buf.count && (Self.isBreak(buf[count]) || buf[count] == 0) {
            count += 1
        }
        if count > 0 {
            buf.removeFirst(count)
        }
    }

    private mutating func takeFrames() -> [String] {
        var lines: [String] = []
        dropLeading()
        while !buf.isEmpty {
            let end = frameEnd()
            if end <= 0 {
                break
            }
            var consume = end
            if Self.isBreak(buf[end]) {
                consume = end + 1
            }
            let frame = Array(buf[0..<end])
            buf.removeFirst(consume)
            if let line = accept(frame) {
                lines.append(line)
            }
            dropLeading()
        }
        return lines
    }

    /// 这一行在哪里结束：换行，或者下一个帧头（两行粘在一起没有换行时）。没有就是 -1。
    private func frameEnd() -> Int {
        var newline = -1
        for i in 0..<buf.count where Self.isBreak(buf[i]) {
            newline = i
            break
        }
        let head = nextHead(from: 1)
        if head > 0 && (newline < 0 || head < newline) {
            return head
        }
        return newline
    }

    private func nextHead(from start: Int) -> Int {
        let from = max(start, 1)
        var best = -1
        for head in heads {
            var search = from
            while search < buf.count {
                let at = indexOf(head, from: search)
                if at < 0 {
                    break
                }
                // WCFG 从第 2 字节起就是 CFG。短帧头落在更长帧头里面时不能切开。
                if !insideLongerHead(at) {
                    if best < 0 || at < best {
                        best = at
                    }
                    break
                }
                search = at + 1
            }
        }
        return best
    }

    private func insideLongerHead(_ at: Int) -> Bool {
        for head in heads {
            var i = max(at - head.count + 1, 0)
            while i < at {
                if i + head.count > at && matches(head, at: i) {
                    return true
                }
                i += 1
            }
        }
        return false
    }

    private func matches(_ needle: [UInt8], at index: Int) -> Bool {
        if index < 0 || index + needle.count > buf.count {
            return false
        }
        for j in 0..<needle.count where buf[index + j] != needle[j] {
            return false
        }
        return true
    }

    private func indexOf(_ needle: [UInt8], from start: Int) -> Int {
        let last = buf.count - needle.count
        var i = max(start, 0)
        while i <= last {
            if matches(needle, at: i) {
                return i
            }
            i += 1
        }
        return -1
    }

    /// 去掉两头的空白，太长、有不可见字符、行首不认识的都返回 nil。
    public static func cleanLine(_ raw: [UInt8], profile: ChargerKind = .ac06) -> String? {
        guard let line = decode(raw) else {
            return nil
        }
        if !printableLine(line) || !knownLine(line, profile: profile) {
            return nil
        }
        return line
    }

    /// 去掉两头的空白，0x00 换回逗号，太长返回 nil。不过滤行首。
    static func decode(_ input: [UInt8]) -> String? {
        var raw = input
        var start = 0
        var end = raw.count
        while start < end && (raw[start] == 0x20 || raw[start] == 0x09) {
            start += 1
        }
        while end > start && (raw[end - 1] == 0x20 || raw[end - 1] == 0x09
            || raw[end - 1] == 0x0D || raw[end - 1] == 0x0A) {
            end -= 1
        }
        if end <= start || end - start > maxLineBytes {
            return nil
        }
        // AT 模式下模组把正文里的每个逗号换成 0x00 再发（长度不变）。行里本来不会有 0x00，
        // 原样换回逗号（M01 App 先修的，同一个模组，AC06 也一样）。
        for i in start..<end where raw[i] == 0 {
            raw[i] = 0x2C
        }
        // 不合法的 UTF-8 会变成 U+FFFD，printableLine 再把它挡掉，和 Java 一样。
        return String(decoding: raw[start..<end], as: UTF8.self)
    }

    public static func printableLine(_ line: String) -> Bool {
        for scalar in line.unicodeScalars {
            let value = scalar.value
            if value == 0x09 {
                continue
            }
            if value < 0x20 || value == 0x7F || value == 0xFFFD {
                return false
            }
        }
        return true
    }

    /// 只放行认识的行首，按这次连的是哪种桩选（Java 的 knownLine(line, which)）。
    public static func knownLine(_ line: String, profile: ChargerKind = .ac06) -> Bool {
        return profile == .m01 ? knownLineM01(line) : knownLineAC06(line)
    }

    /// M01：和 Java 的 knownLineM01 一样。
    public static func knownLineM01(_ line: String) -> Bool {
        let prefixes = [
            "ACK ", "FLT ", "WCFG ", "AP ", "OCPP ", "CFG ", "TEL ", "WIFISW ", "OCPPSW ",
            "NETSTOP ", "OCFW ",
        ]
        let exact = ["APDONE", "ORDDONE"]
        if exact.contains(line) {
            return true
        }
        for prefix in prefixes where line.hasPrefix(prefix) {
            return true
        }
        return false
    }

    /// AC06。新的蓝牙应答一律以 "ACK " 开头（见仓库 CLAUDE.md）。
    public static func knownLineAC06(_ line: String) -> Bool {
        let prefixes = [
            "STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "OCPP ", "CFG ", "IMAX ",
            "SCHED ", "ORD ", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "CARD\t", "QR ",
            "PHASE ", "OCFW ", "PLUG ", "WPASS\t",
        ]
        let exact = ["APDONE", "ORDDONE", "CARD", "WPASS"]
        if exact.contains(line) {
            return true
        }
        for prefix in prefixes where line.hasPrefix(prefix) {
            return true
        }
        return false
    }
}
