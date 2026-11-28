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

    func testCloudGet() {
        let url = "http://8.210.219.113:8088/files/AC06/"
        XCTAssertEqual(call("cloudGet", ["c1", url, "text"]), .cloudGet(id: "c1", url: url, kind: "text"))
        XCTAssertEqual(call("cloudGet", ["c2", url + "V3.0.9/a.bin", "bin"]),
                       .cloudGet(id: "c2", url: url + "V3.0.9/a.bin", kind: "bin"))
        // 地址不合格也照样解析出来：要回页面一个 blocked，由 CloudRules 在处理时拦。
        XCTAssertEqual(call("cloudGet", ["c3", "https://example.com/", "text"]),
                       .cloudGet(id: "c3", url: "https://example.com/", kind: "text"))
        XCTAssertNil(call("cloudGet"))
        XCTAssertNil(call("cloudGet", ["c1"]))
        XCTAssertNil(call("cloudGet", ["c1", url]))
        XCTAssertNil(call("cloudGet", ["c1", 5, "text"]))
        XCTAssertNil(call("cloudGet", [1, url, "text"]))
    }

    func testCloudRulesAllowed() {
        XCTAssertTrue(CloudRules.allowed(url: "http://8.210.219.113:8088/files/AC06/"))
        XCTAssertTrue(CloudRules.allowed(url: "http://8.210.219.113:8088/files/M01/V1.0.0/"))
        XCTAssertTrue(CloudRules.allowed(url: "http://8.210.219.113:8088/files/AC06/V3.0.9/V3.0.9_0093E971.bin"))
        XCTAssertTrue(CloudRules.allowed(
            url: "http://8.210.219.113:8088/files/AC06/V3.0.9/%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E8%AF%B4%E6%98%8E.html"))
        XCTAssertEqual(CloudRules.url("http://8.210.219.113:8088/files/AC06/V3.0.9/a.bin")?.absoluteString,
                       "http://8.210.219.113:8088/files/AC06/V3.0.9/a.bin")
    }

    func testCloudRulesBlocked() {
        let bad = [
            "",
            "https://8.210.219.113:8088/files/AC06/",
            "HTTP://8.210.219.113:8088/files/AC06/",
            "ftp://8.210.219.113:8088/files/AC06/",
            "file:///files/AC06/",
            "http://8.210.219.113/files/AC06/",
            "http://8.210.219.113:80/files/AC06/",
            "http://8.210.219.113:8089/files/AC06/",
            "http://example.com:8088/files/AC06/",
            "http://8.210.219.113.example.com:8088/files/AC06/",
            "http://8.210.219.113:8088@example.com/files/AC06/",
            "http://user:pass@8.210.219.113:8088/files/AC06/",
            "http://user@8.210.219.113:8088/files/AC06/",
            "http://8.210.219.113:8088",
            "http://8.210.219.113:8088/",
            "http://8.210.219.113:8088/files",
            "http://8.210.219.113:8088/file/AC06/",
            "http://8.210.219.113:8088/upload/files/",
            "http://8.210.219.113:8088/files/../etc/passwd",
            "http://8.210.219.113:8088/files/AC06/..",
            "http://8.210.219.113:8088/files/%2e%2e/secret",
            "http://8.210.219.113:8088/files/AC06/%2E./x",
            "http://8.210.219.113:8088/files/AC06/..%2Fx",
            "http://8.210.219.113:8088\\@example.com/files/",
            "http://8.210.219.113:8088/files/a\\..\\b",
            "http://8.210.219.113:8088/files/a b",
            "http://8.210.219.113:8088/files/a\nb",
            " http://8.210.219.113:8088/files/AC06/",
            "8.210.219.113:8088/files/AC06/",
            "/files/AC06/",
        ]
        for text in bad {
            XCTAssertFalse(CloudRules.allowed(url: text), text)
            XCTAssertNil(CloudRules.url(text), text)
        }
        XCTAssertFalse(CloudRules.allowed(url: "http://8.210.219.113:8088/files/" + String(repeating: "a", count: 2048)))
    }

    func testCloudScripts() {
        XCTAssertEqual(CloudRules.maxBytes, 1024 * 1024)
        XCTAssertEqual(CloudRules.doneScript(id: "c1", status: 200, base64: "QUI=", error: ""),
                       "window.__evcCloud&&window.__evcCloud.done&&window.__evcCloud.done.apply(null,"
                           + "[\"c1\",200,\"QUI=\",\"\"])")
        XCTAssertEqual(CloudRules.progScript(id: "c1", done: 10, total: 0),
                       "window.__evcCloud&&window.__evcCloud.prog&&window.__evcCloud.prog.apply(null,[\"c1\",10,0])")
        // id 是页面给的，引号、反斜杠、换行都要转义，不能从字符串里跑出来。
        let script = CloudRules.doneScript(id: "a\");alert(1);(\"\n\u{2028}", status: 0, base64: "", error: "blocked")
        XCTAssertTrue(script.contains("[\"a\\\");alert(1);(\\\"\\n\\u2028\",0,\"\",\"blocked\"])"))
        XCTAssertFalse(script.contains("\n"))
        XCTAssertFalse(script.contains("\u{2028}"))
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
                              appVersion: "3.02", appBuild: "30200").script
        let body = String(script.dropFirst("window.__evcInit = ".count).dropLast(2))
        let object = decode(body)
        XCTAssertEqual(object["appVersion"] as? String, "3.02")
        XCTAssertEqual(object["appBuild"] as? String, "30200")
    }
}
