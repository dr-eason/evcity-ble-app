import XCTest
@testable import EVCCore

final class FrameParserTests: XCTestCase {
    private func bytes(_ text: String) -> [UInt8] {
        return Array(text.utf8)
    }

    func testWholeLine() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("ACK AUTH OK\n")), ["ACK AUTH OK"])
        XCTAssertFalse(parser.hasPending)
    }

    func testCrLfAndBlankLines() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("\r\n\r\nTEL 1\r\nIMAX 32\r\n")), ["TEL 1", "IMAX 32"])
        XCTAssertFalse(parser.hasPending)
    }

    func testLineSplitAcrossNotifications() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("STAT CHARGING NONE 12 230.1 ")), [])
        XCTAssertTrue(parser.hasPending)
        XCTAssertEqual(parser.append(bytes("0.0 0.0 6.00 0.00 0.00 NONE UP OFF\n")),
                       ["STAT CHARGING NONE 12 230.1 0.0 0.0 6.00 0.00 0.00 NONE UP OFF"])
        XCTAssertFalse(parser.hasPending)
    }

    func testTwoLinesGluedWithoutNewline() {
        var parser = FrameParser()
        // 第二行的帧头把第一行切出来；第二行没有换行，先留在缓冲里。
        XCTAssertEqual(parser.append(bytes("FLT NONELIVE 0.4 11.98 -")), ["FLT NONE"])
        XCTAssertTrue(parser.hasPending)
        XCTAssertEqual(parser.flush(), ["LIVE 0.4 11.98 -"])
        XCTAssertFalse(parser.hasPending)
    }

    func testWcfgIsNotCutAtCfg() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("LIVE 0.4 11.98 -WCFG UP home\n")),
                       ["LIVE 0.4 11.98 -", "WCFG UP home"])
    }

    func testAckWithTabsKept() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("ACK APN 0\tcmnet\t\t\n")), ["ACK APN 0\tcmnet"])
    }

    func testUnknownLineDropped() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("+DATA:1,5,hello\nOK\nTEL 0\n")), ["TEL 0"])
    }

    func testOrderLineWithPlugIsNotCut() {
        var parser = FrameParser()
        let line = "ORD 0 1790000000 1790003600 7200 3200 USER 3600 PLUG - -"
        XCTAssertEqual(parser.append(bytes(line + "\n")), [line])
    }

    func testOldFirmwarePlugAndWpass() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("PLUG 1\nWPASS\tabc\nWPASS\nCARD\nCARD\t1\t2\n")),
                       ["PLUG 1", "WPASS\tabc", "WPASS", "CARD", "CARD\t1\t2"])
    }

    func testControlCharacterDropped() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append([0x41, 0x43, 0x4B, 0x20, 0x01, 0x4F, 0x4B, 0x0A]), [])
    }

    func testInvalidUtf8Dropped() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append([0x41, 0x43, 0x4B, 0x20, 0xFF, 0xFE, 0x0A]), [])
    }

    func testUtf8SsidKept() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("WCFG UP 家里\n")), ["WCFG UP 家里"])
    }

    func testTooLongLineDropped() {
        var parser = FrameParser()
        let long = "ACK " + String(repeating: "x", count: 380)
        XCTAssertEqual(parser.append(bytes(long + "\n")), [])
        let fits = "ACK " + String(repeating: "x", count: 376)
        XCTAssertEqual(parser.append(bytes(fits + "\n")), [fits])
    }

    func testOverflowResetsBuffer() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append([UInt8](repeating: 0x78, count: 2000)), [])
        XCTAssertTrue(parser.hasPending)
        // 再来 100 字节放不下：旧的丢掉，新的照常收。
        XCTAssertEqual(parser.append(bytes(String(repeating: "y", count: 90) + "\nTEL 1\n")), ["TEL 1"])
        XCTAssertFalse(parser.hasPending)
    }

    func testOversizeNotificationIgnored() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append([UInt8](repeating: 0x78, count: 2049)), [])
        XCTAssertFalse(parser.hasPending)
    }

    func testFlushOfGarbageGivesNothing() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("half a li")), [])
        XCTAssertEqual(parser.flush(), [])
        XCTAssertFalse(parser.hasPending)
    }

    func testFlushOfCompleteLineWithoutNewline() {
        var parser = FrameParser()
        XCTAssertEqual(parser.append(bytes("APDONE")), [])
        XCTAssertEqual(parser.flush(), ["APDONE"])
    }

    func testResetClears() {
        var parser = FrameParser()
        _ = parser.append(bytes("STAT A"))
        parser.reset()
        XCTAssertFalse(parser.hasPending)
        XCTAssertEqual(parser.append(bytes("TEL 1\n")), ["TEL 1"])
    }

    func testKnownLineTable() {
        for line in ["STAT x", "WCFG x", "FLT x", "LIVE x", "ACK x", "AP x", "APDONE", "OCPP x",
                     "CFG x", "IMAX x", "SCHED x", "ORD x", "ORDDONE", "TEL x", "WIFISW x",
                     "OCPPSW x", "NETSTOP x", "CARD\tx", "CARD", "QR x", "PHASE x", "OCFW x",
                     "PLUG x", "WPASS\tx", "WPASS"] {
            XCTAssertTrue(FrameParser.knownLine(line), line)
        }
        for line in ["", "OK", "STAT", "ACK", "APDONE x", "ORDDONE 1", "CARD x", "WPASS x", "stat x", "HB"] {
            XCTAssertFalse(FrameParser.knownLine(line), line)
        }
    }
}
