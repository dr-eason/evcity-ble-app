import XCTest
@testable import EVCCore

final class WriteQueueTests: XCTestCase {
    func testCommandGetsNewline() {
        var queue = WriteQueue()
        queue.enqueue(command: "STATUS")
        XCTAssertEqual(queue.next(payload: 20), Array("STATUS\n".utf8))
        XCTAssertTrue(queue.isEmpty)
        XCTAssertNil(queue.next(payload: 20))
    }

    func testLongCommandIsSplitInOrder() {
        var queue = WriteQueue()
        let command = String(repeating: "a", count: 45)
        queue.enqueue(command: command)
        queue.enqueue(command: "HB")
        var parts: [[UInt8]] = []
        while let part = queue.next(payload: 20) {
            parts.append(part)
        }
        XCTAssertEqual(parts.map { $0.count }, [20, 20, 6, 3])
        XCTAssertEqual(parts.flatMap { $0 }, Array((command + "\nHB\n").utf8))
    }

    func testPutBackGoesFirst() {
        var queue = WriteQueue()
        queue.enqueue(command: "A")
        queue.enqueue(command: "B")
        let first = queue.next(payload: 20)!
        queue.putBack(first)
        XCTAssertEqual(queue.next(payload: 20), Array("A\n".utf8))
        XCTAssertEqual(queue.next(payload: 20), Array("B\n".utf8))
    }

    func testClear() {
        var queue = WriteQueue()
        queue.enqueue(command: "A")
        queue.clear()
        XCTAssertTrue(queue.isEmpty)
    }

    func testMtuAndPayload() {
        XCTAssertEqual(LinkMtu.fromMaxWrite(20), 23)
        XCTAssertEqual(LinkMtu.fromMaxWrite(182), 185)
        XCTAssertEqual(LinkMtu.fromMaxWrite(244), 247)
        XCTAssertEqual(LinkMtu.fromMaxWrite(512), 247)
        XCTAssertEqual(LinkMtu.fromMaxWrite(0), 23)
        XCTAssertEqual(LinkMtu.payload(mtu: 23), 20)
        XCTAssertEqual(LinkMtu.payload(mtu: 247), 244)
        XCTAssertEqual(LinkMtu.payload(mtu: 10), 20)
    }
}

final class HeartbeatTests: XCTestCase {
    private let now: Int64 = 1_795_000_000_500

    func testPlainWhenOffOrBusy() {
        XCTAssertEqual(Heartbeat.line(timeEnabled: false, busy: false, nowMs: now, tzOffsetMs: 0), "HB")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: true, nowMs: now, tzOffsetMs: 0), "HB")
    }

    func testCarriesTimeAndZone() {
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: now, tzOffsetMs: 8 * 3_600_000),
                       "HB\t1795000000\t480")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: now, tzOffsetMs: -(5 * 3_600_000 + 1_800_000)),
                       "HB\t1795000000\t-330")
    }

    func testClockOutOfRangeIsPlain() {
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: 1_577_836_799_000, tzOffsetMs: 0), "HB")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: 2_145_916_800_000, tzOffsetMs: 0), "HB")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: 1_577_836_800_000, tzOffsetMs: 0),
                       "HB\t1577836800\t0")
    }

    func testZoneOutOfRangeDropsZone() {
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: now, tzOffsetMs: 841 * 60_000),
                       "HB\t1795000000")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: now, tzOffsetMs: -721 * 60_000),
                       "HB\t1795000000")
        XCTAssertEqual(Heartbeat.line(timeEnabled: true, busy: false, nowMs: now, tzOffsetMs: 840 * 60_000),
                       "HB\t1795000000\t840")
    }
}

final class BridgeCallTests: XCTestCase {
    private func call(_ name: String, _ args: [Any] = []) -> BridgeCall? {
        return BridgeCall.parse(["m": name, "a": args] as [String: Any])
    }

    private func decode(_ json: String) -> [String: Any] {
        let data = json.data(using: .utf8)!
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    func testPlainCalls() {
        XCTAssertEqual(call("scan"), .scan)
        XCTAssertEqual(call("stopScan"), .stopScan)
        XCTAssertEqual(call("disconnect"), .disconnect)
        XCTAssertEqual(call("restart"), .restart)
        XCTAssertEqual(call("pickFile"), .pickFile)
        XCTAssertEqual(call("connect", ["ABCD"]), .connect("ABCD"))
        XCTAssertEqual(call("linkFast", [true]), .linkFast(true))
        XCTAssertEqual(call("linkFast", [false]), .linkFast(false))
        XCTAssertEqual(call("heartbeatTime", [true]), .heartbeatTime(true))
        XCTAssertEqual(call("heartbeatTime"), .heartbeatTime(false))
    }

    func testSendFilter() {
        XCTAssertEqual(call("send", ["AUTH\t123456"]), .send("AUTH\t123456"))
        XCTAssertNil(call("send", [""]))
        XCTAssertNil(call("send", ["A\nB"]))
        XCTAssertNil(call("send", ["A\r"]))
        XCTAssertNil(call("send"))
        XCTAssertNil(call("send", [12]))
    }

    func testSaveGate() {
        XCTAssertEqual(call("saveGate", ["ADDR", "123456"]), .saveGate(address: "ADDR", pin: "123456"))
        XCTAssertEqual(call("saveGate", ["ADDR"]), .saveGate(address: "ADDR", pin: ""))
        XCTAssertNil(call("saveGate", ["", "123456"]))
    }

    func testExportFile() {
        XCTAssertEqual(call("exportFile", ["evcity-ac06-oneclick-20261125-1430.json", "{}"]),
                       .exportFile(name: "evcity-ac06-oneclick-20261125-1430.json", text: "{}"))
        XCTAssertEqual(call("exportFile", ["../x/y", "{}"]), .exportFile(name: "y.json", text: "{}"))
        XCTAssertEqual(call("exportFile", ["", "{}"]), .exportFile(name: ExportRules.defaultName, text: "{}"))
        XCTAssertNil(call("exportFile", ["a.json", ""]))
        XCTAssertNil(call("exportFile", ["a.json"]))
        XCTAssertNil(call("exportFile", ["a.json", String(repeating: "x", count: ExportRules.maxBytes + 1)]))
    }

    func testSetProfileAndKind() {
        XCTAssertEqual(call("setProfile", ["m01"]), .setProfile(.m01))
        XCTAssertEqual(call("setProfile", ["ac06"]), .setProfile(.ac06))
        XCTAssertEqual(call("setProfile", ["x"]), .setProfile(.ac06))
        XCTAssertEqual(decode(BridgeEvent.kind("m01").json)["t"] as? String, "kind")
        XCTAssertEqual(decode(BridgeEvent.kind("m01").json)["s"] as? String, "m01")
    }

    func testExportFileName() {
        XCTAssertEqual(ExportRules.fileName("a:b*c?.txt"), "abc.txt.json")
        XCTAssertEqual(ExportRules.fileName(".hidden"), ExportRules.defaultName)
        XCTAssertEqual(ExportRules.fileName("x\\y\\z"), "z.json")
        XCTAssertEqual(ExportRules.fileName("配置.JSON"), "配置.JSON")
        XCTAssertEqual(ExportRules.fileName("a\u{0}b\nc"), "abc.json")
    }

    func testRubbish() {
        XCTAssertNil(BridgeCall.parse(nil))
        XCTAssertNil(BridgeCall.parse("scan"))
        XCTAssertNil(BridgeCall.parse(["a": []] as [String: Any]))
        XCTAssertNil(call("loadGate", ["ADDR"]))
        XCTAssertNil(call("connect"))
    }

    func testGateRules() {
        var gate: [String: String] = [:]
        GateRules.apply(&gate, address: "A", pin: "123456")
        XCTAssertEqual(gate, ["A": "123456"])
        GateRules.apply(&gate, address: "", pin: "123456")
        XCTAssertEqual(gate, ["A": "123456"])
        GateRules.apply(&gate, address: "A", pin: "12345")
        XCTAssertEqual(gate, [:])
        GateRules.apply(&gate, address: "B", pin: "")
        XCTAssertEqual(gate, [:])
    }
}

final class BridgeEventTests: XCTestCase {
    private func decode(_ json: String) -> [String: Any] {
        let data = json.data(using: .utf8)!
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private func strings(_ event: BridgeEvent) -> [String: String] {
        return decode(event.json).compactMapValues { $0 as? String }
    }

    func testNotePageLine() {
        XCTAssertEqual(strings(.note("蓝牙已断开")), ["t": "note", "s": "蓝牙已断开"])
        XCTAssertEqual(strings(.page("charge")), ["t": "page", "s": "charge"])
        XCTAssertEqual(strings(.line("ACK APN 0\t\"x\"")), ["t": "line", "s": "ACK APN 0\t\"x\""])
    }

    func testExportEvent() {
        let object = decode(BridgeEvent.export(ok: true, reason: "").json)
        XCTAssertEqual(object["t"] as? String, "export")
        XCTAssertEqual(object["ok"] as? Bool, true)
        XCTAssertEqual(object["s"] as? String, "")
        XCTAssertEqual(decode(BridgeEvent.export(ok: false, reason: "cancel").json)["s"] as? String, "cancel")
    }

    func testScanIsBoolean() {
        XCTAssertTrue(BridgeEvent.scan(true).json.contains("true"))
        XCTAssertTrue(BridgeEvent.scan(false).json.contains("false"))
    }

    func testDevices() {
        let event = BridgeEvent.devs([BridgeDevice(name: "EVC-1", addr: "U-1", rssi: -60)])
        let object = decode(event.json)
        XCTAssertEqual(object["t"] as? String, "devs")
        let list = object["list"] as? [[String: Any]] ?? []
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list.first?["name"] as? String, "EVC-1")
        XCTAssertEqual(list.first?["addr"] as? String, "U-1")
        XCTAssertEqual(list.first?["rssi"] as? Int, -60)
        XCTAssertEqual(decode(BridgeEvent.devs([]).json)["list"] as? [String], [])
    }

    func testScriptWrapsOnBle() {
        let script = BridgeEvent.page("scan").script
        XCTAssertTrue(script.hasPrefix("onBle({"))
        XCTAssertTrue(script.hasSuffix("})"))
    }

    func testLineSeparatorsEscaped() {
        let json = BridgeEvent.note("a\u{2028}b\u{2029}c").json
        XCTAssertFalse(json.contains("\u{2028}"))
        XCTAssertFalse(json.contains("\u{2029}"))
        XCTAssertEqual(decode(json)["s"] as? String, "a\u{2028}b\u{2029}c")
    }

    func testShimInit() {
        let script = ShimInit(locale: "zh-Hans-CN", gate: ["A": "123456"], mock: true, nativeFilePicker: false).script
        XCTAssertTrue(script.hasPrefix("window.__evcInit = {"))
        XCTAssertTrue(script.hasSuffix(";\n"))
        let body = String(script.dropFirst("window.__evcInit = ".count).dropLast(2))
        let object = decode(body)
        XCTAssertEqual(object["locale"] as? String, "zh-Hans-CN")
        XCTAssertEqual(object["gate"] as? [String: String], ["A": "123456"])
        XCTAssertEqual(object["mock"] as? Bool, true)
        XCTAssertEqual(object["nativeFilePicker"] as? Bool, false)
        // 没给版本号时是空串，界面再用编译时的版本兜底。
        XCTAssertEqual(object["appVersion"] as? String, "")
        XCTAssertEqual(object["appBuild"] as? String, "")
    }

    func testShimInitAppVersion() {
        let script = ShimInit(locale: "en", gate: [:], mock: false, nativeFilePicker: false,
                              appVersion: "3.0.6", appBuild: "3006").script
        let body = String(script.dropFirst("window.__evcInit = ".count).dropLast(2))
        let object = decode(body)
        XCTAssertEqual(object["appVersion"] as? String, "3.0.6")
        XCTAssertEqual(object["appBuild"] as? String, "3006")
    }
}
