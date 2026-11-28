import XCTest
@testable import EVCCore

/// App 更新检查的规则（AC-34）。同一批例子在 ui/test/app-update.test.mjs 里对着 JS 那一份也跑一遍。
final class AppUpdateTests: XCTestCase {
    private func row(_ name: String, size: String = "438 KB", dir: Bool = false) -> String {
        return "<tr><td><a href=\"/files/Android%20APP/\(name)\(dir ? "/" : "")\">\(name)</a></td>"
            + "<td class=\"size\">\(size)</td><td class=\"time\">2026-11-28 08:19</td></tr>"
    }

    private func page(_ rows: [String]) -> String {
        return "<html><body><h1>文件列表</h1><p><a href=\"/files/\">返回上一级</a></p><table>\n"
            + rows.joined(separator: "\n") + "\n</table></body></html>"
    }

    func testCompareVersions() {
        XCTAssertEqual(AppUpdateRules.compare("3.0.10", "3.0.9"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.0.9", "3.0.10"), -1)
        XCTAssertEqual(AppUpdateRules.compare("3.0.8", "3.0.8"), 0)
        XCTAssertEqual(AppUpdateRules.compare("3.1", "3.0.9"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.1", "3.1.0"), 0)
        XCTAssertEqual(AppUpdateRules.compare("10.0.0", "9.9.9"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.00.08", "3.0.8"), 0)
        // 版本号是 大版本.APP版本.固件版本：App 只有前两段（3.01）。历史的三段写法照样对得上。
        XCTAssertEqual(AppUpdateRules.compare("3.01", "3.1.0"), 0)
        XCTAssertEqual(AppUpdateRules.compare("3.1.0", "3.01"), 0)
        XCTAssertEqual(AppUpdateRules.compare("3.02", "3.1.0"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.02", "3.01"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.0.9", "3.01"), -1)
        XCTAssertEqual(AppUpdateRules.compare("4.00", "3.99"), 1)
        XCTAssertEqual(AppUpdateRules.apkVersion("EVCITY-AC_V3.02.apk"), "3.02")
        XCTAssertEqual(AppUpdateRules.latest(["EVCITY-AC_V3.0.9.apk", "EVCITY-AC_V3.02.apk", "EVCITY-AC_V3.1.0.apk"]),
                       "EVCITY-AC_V3.02.apk")
        XCTAssertEqual(AppUpdateRules.compare("V3.0.9", "3.0.8"), 1)
        XCTAssertEqual(AppUpdateRules.compare("3.0.8-beta", "3.0.8"), 0)
        XCTAssertEqual(AppUpdateRules.compare("1.90071992547409931", "1.90071992547409930"), 1)
        XCTAssertEqual(AppUpdateRules.compare("", "0"), 0)
        XCTAssertEqual(AppUpdateRules.compare("$(MARKETING_VERSION)", "0.0.1"), -1)
        XCTAssertEqual(AppUpdateRules.versionCore(" v3.0.8 (3008)"), "3.0.8")
        XCTAssertEqual(AppUpdateRules.versionCore("3.0."), "3.0")
    }

    func testApkName() {
        XCTAssertEqual(AppUpdateRules.apkVersion("EVCITY-AC_V3.0.9.apk"), "3.0.9")
        XCTAssertEqual(AppUpdateRules.apkVersion("EVCITY-AC_V3.apk"), "3")
        let bad = [
            "EVCITY-AC_V0.0.0-test.apk", "EVCITY-AC_V3.0.9.apk.part", "evcity-ac_v3.0.9.apk", "EVCITY-AC_3.0.9.apk",
            "EVCITY-AC_V3..9.apk", "EVCITY-AC_V3.0.9.APK", "EVCITY-AC_V.apk", "EVCITY-AC_V3.0.9.apk/",
            "../EVCITY-AC_V3.0.9.apk", " EVCITY-AC_V3.0.9.apk", "EVCITY-AC_V3.0.٩.apk", "evc-ble.apk", "",
        ]
        for name in bad {
            XCTAssertNil(AppUpdateRules.apkVersion(name), name)
        }
    }

    func testListing() {
        let html = page([
            row("EVCITY-AC_V3.0.9.apk"),
            row("EVCITY-AC_V3.0.10.apk"),
            row("EVCITY-AC_V3.0.8.apk"),
            row("EVCITY-AC_V0.0.0-test.apk", size: "6 B"),
            row("readme.txt", size: "1 KB"),
            row("EVCITY-AC_V9.9.9.apk", size: "目录", dir: true),
            row("old", size: "目录", dir: true),
            row("EVCITY-AC_V3.0.10.apk"),
        ])
        let names = AppUpdateRules.parseListing(html)
        XCTAssertEqual(names, ["EVCITY-AC_V3.0.9.apk", "EVCITY-AC_V3.0.10.apk", "EVCITY-AC_V3.0.8.apk"])
        XCTAssertEqual(AppUpdateRules.latest(names ?? []), "EVCITY-AC_V3.0.10.apk")
        XCTAssertEqual(AppUpdateRules.parseListing(page([])), [])
        XCTAssertNil(AppUpdateRules.parseListing("<html>oops</html>"))
        XCTAssertNil(AppUpdateRules.latest([]))
    }

    func testEvaluate() {
        let html = page([row("EVCITY-AC_V3.0.8.apk"), row("EVCITY-AC_V3.0.9.apk")])
        let newer = AppUpdateRules.evaluate(data: Data(html.utf8), status: 200, failed: false, current: "3.0.8")
        XCTAssertEqual(newer["ok"] as? Bool, true)
        XCTAssertEqual(newer["hasNew"] as? Bool, true)
        XCTAssertEqual(newer["latest"] as? String, "3.0.9")
        XCTAssertEqual(newer["current"] as? String, "3.0.8")
        XCTAssertEqual(newer["file"] as? String, "EVCITY-AC_V3.0.9.apk")
        let same = AppUpdateRules.evaluate(data: Data(html.utf8), status: 200, failed: false, current: "3.0.9")
        XCTAssertEqual(same["hasNew"] as? Bool, false)
        let ahead = AppUpdateRules.evaluate(data: Data(html.utf8), status: 200, failed: false, current: "3.1.0")
        XCTAssertEqual(ahead["hasNew"] as? Bool, false)
        let empty = AppUpdateRules.evaluate(data: Data(page([]).utf8), status: 200, failed: false, current: "3.0.8")
        XCTAssertEqual(empty["ok"] as? Bool, true)
        XCTAssertEqual(empty["hasNew"] as? Bool, false)
        XCTAssertEqual(empty["file"] as? String, "")
        XCTAssertEqual(AppUpdateRules.evaluate(data: nil, status: nil, failed: true, current: "3.0.8")["reason"] as? String, "offline")
        // 文件夹还不存在（404 / 410）：和空文件夹一样，成功、没有更新。
        for gone in [404, 410] {
            let missing = AppUpdateRules.evaluate(data: Data("文件不存在".utf8), status: gone, failed: false, current: "V3.0.8")
            XCTAssertEqual(missing["ok"] as? Bool, true)
            XCTAssertEqual(missing["hasNew"] as? Bool, false)
            XCTAssertEqual(missing["latest"] as? String, "")
            XCTAssertEqual(missing["current"] as? String, "3.0.8")
            XCTAssertEqual(missing["file"] as? String, "")
            XCTAssertNil(missing["reason"])
        }
        // 别的状态码仍是失败。
        for bad in [500, 503, 403, 401, 302, 204] {
            let failed = AppUpdateRules.evaluate(data: Data(), status: bad, failed: false, current: "3.0.8")
            XCTAssertEqual(failed["ok"] as? Bool, false)
            XCTAssertEqual(failed["reason"] as? String, "http")
        }
        XCTAssertEqual(AppUpdateRules.evaluate(data: Data("<html>oops</html>".utf8), status: 200, failed: false, current: "3.0.8")["reason"] as? String, "parse")
        XCTAssertEqual(AppUpdateRules.evaluate(data: nil, status: 200, failed: false, current: "3.0.8")["reason"] as? String, "parse")
    }

    func testBridge() {
        XCTAssertTrue(AppUpdateRules.isCheckCall(["m": "updCheck", "a": [Any]()] as [String: Any]))
        XCTAssertFalse(AppUpdateRules.isCheckCall(["m": "updDownload", "a": ["x"]] as [String: Any]))
        XCTAssertFalse(AppUpdateRules.isCheckCall("updCheck"))
        XCTAssertFalse(AppUpdateRules.isCheckCall(nil))
        // 页面那头只有 updCheck；别的 upd 开头的消息 BridgeCall 也不认。
        XCTAssertNil(BridgeCall.parse(["m": "updDownload", "a": ["EVCITY-AC_V3.0.9.apk"]] as [String: Any]))
        let script = AppUpdateRules.script(AppUpdateRules.failure("offline"))
        XCTAssertTrue(script.hasPrefix("window.__evcUpd&&window.__evcUpd.onCheck&&window.__evcUpd.onCheck({"))
        XCTAssertTrue(script.contains("\"reason\":\"offline\""))
        XCTAssertEqual(AppUpdateRules.listURL, "http://8.210.219.113:8088/files/Android%20APP/")
    }
}
