import XCTest
@testable import EVCCore

/// 界面热更新的规则（H5Update.swift）。样例和 ui/test/h5-update.test.mjs、APP/android/tests/H5UpdaterTest.java
/// 是同一批。Mac 和 Linux 都能跑：swift test --package-path Core
final class H5UpdateRulesTests: XCTestCase {
    private let sha = String(repeating: "9f2c", count: 16)

    func testNames() {
        XCTAssertEqual(H5UpdateRules.parseName("EVCITY-AC_H5_V3.04.r3.zip"), H5Name(base: "3.04", rev: 3))
        XCTAssertEqual(H5UpdateRules.parseName("EVCITY-AC_H5_V3.03.r0.zip"), H5Name(base: "3.03", rev: 0))
        XCTAssertEqual(H5UpdateRules.parseName("EVCITY-AC_H5_V10.00.r999999.zip"), H5Name(base: "10.00", rev: 999999))
        // 基座原样，不换算：3.4 和 3.04 是两个名字。
        XCTAssertEqual(H5UpdateRules.parseName("EVCITY-AC_H5_V3.4.r1.zip"), H5Name(base: "3.4", rev: 1))
        for bad in [
            "EVCITY-AC_H5_V3.04.r03.zip", "EVCITY-AC_H5_V3.04.r00.zip", "EVCITY-AC_H5_V3.04.r-1.zip",
            "EVCITY-AC_H5_V3.04.r1000000.zip", "EVCITY-AC_H5_V3.4.0.r1.zip", "EVCITY-AC_H5_V3.r1.zip",
            "EVCITY-AC_H5_V3.04.r3.apk", "EVCITY-AC_H5_V3.04.r3.zip.sha256", "EVCITY-AC_H5_V3.04.r3.1.zip",
            "EVCITY-AC_H5_V3.04.3.zip", "EVCITY-AC_H5_V3.04.R3.zip", "evcity-ac_h5_v3.04.r3.zip",
            "EVCITY-AC_H5_V3.04.r3.ZIP", "EVCITY-AC_V3.04.apk", "EVCITY-AC_H5_V3.04.r.zip",
            " EVCITY-AC_H5_V3.04.r3.zip", "../EVCITY-AC_H5_V3.04.r3.zip", "x/EVCITY-AC_H5_V3.04.r3.zip",
            "EVCITY-AC_H5_V3.04.r3.zip/", "EVCITY-AC_H5_V3.04.r3.zip\n", "EVCITY-AC_H5_V３.04.r3.zip", "",
        ] {
            XCTAssertNil(H5UpdateRules.parseName(bad), bad)
        }
        XCTAssertEqual(H5UpdateRules.fileName(base: "3.04", rev: 3), "EVCITY-AC_H5_V3.04.r3.zip")
        XCTAssertEqual(H5UpdateRules.folderURL("3.04"), "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/")
        XCTAssertNil(H5UpdateRules.folderURL("3.4.0"))
        XCTAssertNil(H5UpdateRules.folderURL("../x"))
        XCTAssertEqual(H5UpdateRules.metaTag(base: "3.04", rev: 3), "<meta name=\"evc-h5\" content=\"3.04.r3\">")
        XCTAssertEqual(H5UpdateRules.zipMaxBytes, 8 * 1024 * 1024)
        XCTAssertEqual(H5UpdateRules.kind, "evcity-ac-h5")
    }

    func testFolderAddressesPassCloudRules() {
        let folder = H5UpdateRules.folderURL("3.04")!
        XCTAssertEqual(CloudRules.url(folder + H5UpdateRules.latestName)?.absoluteString,
                       "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/latest.json")
        XCTAssertNotNil(CloudRules.url(folder))
        XCTAssertNotNil(CloudRules.url(folder + "EVCITY-AC_H5_V3.04.r3.zip"))
        XCTAssertNotNil(CloudRules.url(folder + "EVCITY-AC_H5_V3.04.r3.zip.sha256"))
        XCTAssertNil(CloudRules.url(folder + "../../x"))
        XCTAssertNil(CloudRules.url("https://ftp.evcity.cc:8088/files/Android%20APP/V3.04/latest.json"))
        XCTAssertNil(CloudRules.url("http://evil.example:8088/files/Android%20APP/V3.04/latest.json"))
    }

    private func latest(kind: String = "\"evcity-ac-h5\"", base: String = "\"3.04\"", rev: String = "3",
                        file: String = "\"EVCITY-AC_H5_V3.04.r3.zip\"", sha256: String? = nil,
                        size: String = "512345") -> String {
        let digest = sha256 ?? "\"" + sha + "\""
        return "{\"kind\":" + kind + ",\"base\":" + base + ",\"rev\":" + rev + ",\"file\":" + file
            + ",\"sha256\":" + digest + ",\"size\":" + size + "}"
    }

    func testLatestJson() {
        XCTAssertEqual(H5UpdateRules.parseLatest(latest(), shellBase: "3.04"),
                       H5Latest(base: "3.04", rev: 3, file: "EVCITY-AC_H5_V3.04.r3.zip", sha256: sha, size: 512345))
        // 多出来的字段不看（什么类型都行）。
        let tail = String(latest().dropFirst())
        let extra = " {\n \"note\": {\"a\":[1,2,{\"b\":null}]}, \"enabled\": false, " + tail
        XCTAssertNotNil(H5UpdateRules.parseLatest(extra, shellBase: "3.04"))
        // 壳的基座不同：不收；不做 3.4 = 3.04 的换算。
        XCTAssertNil(H5UpdateRules.parseLatest(latest(), shellBase: "3.05"))
        XCTAssertNil(H5UpdateRules.parseLatest(latest(), shellBase: "3.4"))
        let bad = [
            latest(kind: "\"evcity-ac-apk\""), latest(kind: "1"),
            latest(base: "3.04"), latest(base: "\"3.4.0\""),
            latest(rev: "\"3\""), latest(rev: "3.5"), latest(rev: "3.0"), latest(rev: "-1"), latest(rev: "1000000"),
            latest(rev: "null"), latest(rev: "true"), latest(rev: "4"),
            latest(file: "\"EVCITY-AC_H5_V3.04.r4.zip\""), latest(file: "\"EVCITY-AC_H5_V3.05.r3.zip\""),
            latest(file: "\"../EVCITY-AC_H5_V3.04.r3.zip\""), latest(file: "3"),
            latest(sha256: "\"" + sha.uppercased() + "\""), latest(sha256: "\"" + String(sha.dropFirst()) + "\""),
            latest(sha256: "\"" + sha + "0\""), latest(sha256: "1"),
            latest(size: "0"), latest(size: "-5"), latest(size: "\"512345\""), latest(size: "1.5"),
            latest(size: "8388609"), latest(size: "true"),
        ]
        for text in bad {
            XCTAssertNil(H5UpdateRules.parseLatest(text, shellBase: "3.04"), text)
        }
        XCTAssertNotNil(H5UpdateRules.parseLatest(latest(size: "8388608"), shellBase: "3.04"))
        // 缺一个字段
        for key in ["kind", "base", "rev", "file", "sha256", "size"] {
            let cut = latest().replacingOccurrences(of: "\"" + key + "\":", with: "\"x" + key + "\":")
            XCTAssertNil(H5UpdateRules.parseLatest(cut, shellBase: "3.04"), key)
        }
        for junk in ["", "{", "[]", "3", "<html>404</html>", latest() + "x", "{\"kind\":}"] {
            XCTAssertNil(H5UpdateRules.parseLatest(junk, shellBase: "3.04"), junk)
        }
    }

    func testShaLine() {
        let file = "EVCITY-AC_H5_V3.04.r3.zip"
        XCTAssertEqual(H5UpdateRules.parseShaLine(sha + "  " + file + "\n", file: file), sha)
        XCTAssertEqual(H5UpdateRules.parseShaLine(sha + "  " + file, file: file), sha)
        XCTAssertEqual(H5UpdateRules.parseShaLine(sha + "  " + file + "\r\n", file: file), sha)
        for bad in [
            sha + " " + file + "\n", sha + "   " + file + "\n", sha + " *" + file + "\n",
            sha.uppercased() + "  " + file + "\n", String(sha.dropFirst(2)) + "  " + file + "\n",
            sha + "  EVCITY-AC_H5_V3.04.r4.zip\n", sha + "  " + file + "\n" + sha + "  " + file + "\n",
            "", "<html>404</html>",
        ] {
            XCTAssertNil(H5UpdateRules.parseShaLine(bad, file: file), bad)
        }
        XCTAssertNil(H5UpdateRules.parseShaLine(sha + "  " + file + "\n", file: ""))
    }

    func testManifestAndMeta() {
        XCTAssertEqual(H5UpdateRules.parseManifest("{\"kind\":\"evcity-ac-h5\",\"base\":\"3.03\",\"rev\":0}\n"),
                       H5Name(base: "3.03", rev: 0))
        for bad in [
            "{\"kind\":\"x\",\"base\":\"3.04\",\"rev\":3}", "{\"base\":\"3.04\",\"rev\":3}",
            "{\"kind\":\"evcity-ac-h5\",\"base\":\"3.04\",\"rev\":\"3\"}", "{\"kind\":\"evcity-ac-h5\",\"base\":3.04,\"rev\":3}",
            "{\"kind\":\"evcity-ac-h5\",\"base\":\"3.04\"}", "{\"kind\":\"evcity-ac-h5\",\"base\":\"3.4.0\",\"rev\":1}",
            "{\"kind\":\"evcity-ac-h5\",\"base\":\"3.04\",\"rev\":true}", "", "{", "[]",
        ] {
            XCTAssertNil(H5UpdateRules.parseManifest(bad), bad)
        }
        let page = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head><meta name=\"evc-h5\" content=\"3.04.r3\">\n<meta charset=\"utf-8\">"
        XCTAssertTrue(H5UpdateRules.metaMatches(head: Data(page.utf8), base: "3.04", rev: 3))
        XCTAssertFalse(H5UpdateRules.metaMatches(head: Data(page.utf8), base: "3.04", rev: 2))
        XCTAssertFalse(H5UpdateRules.metaMatches(head: Data(page.utf8), base: "3.05", rev: 3))
        // 只看开头 4 KB
        let late = String(repeating: "x", count: 5000) + "<meta name=\"evc-h5\" content=\"3.04.r3\">"
        XCTAssertFalse(H5UpdateRules.metaMatches(head: Data(late.utf8), base: "3.04", rev: 3))
    }

    private func row(_ name: String, _ size: String) -> String {
        return "<tr><td><a href=\"/files/Android%20APP/V3.04/" + name + "\">" + name + "</a></td><td class=\"size\">"
            + size + "</td><td class=\"time\">2026-11-28 08:19</td></tr>"
    }

    func testListing() {
        let html = "<html><body><h1>文件列表</h1><table>\n" + row("EVCITY-AC_V3.04.apk", "4.2 MB")
            + row("EVCITY-AC_H5_V3.04.r0.zip", "438 KB") + row("EVCITY-AC_H5_V3.04.r0.zip.sha256", "92 B")
            + row("EVCITY-AC_H5_V3.04.r10.zip", "438 KB") + row("EVCITY-AC_H5_V3.04.r9.zip", "438 KB")
            + row("EVCITY-AC_H5_V3.05.r99.zip", "438 KB") + row("EVCITY-AC_H5_V3.04.r03.zip", "438 KB")
            + row("latest.json", "1 KB") + row("EVCITY-AC_H5_V3.04.r77.zip", "目录")
            + row("EVCITY-AC_H5_V3.04.r10.zip", "438 KB") + "\n</table></body></html>"
        let names = H5UpdateRules.parseListing(html)
        XCTAssertEqual(names, ["EVCITY-AC_H5_V3.04.r0.zip", "EVCITY-AC_H5_V3.04.r10.zip", "EVCITY-AC_H5_V3.04.r9.zip",
                               "EVCITY-AC_H5_V3.05.r99.zip"])
        // 按数字比（r10 > r9）；别的基座的包不看。
        XCTAssertEqual(H5UpdateRules.latestName(names ?? [], shellBase: "3.04"), "EVCITY-AC_H5_V3.04.r10.zip")
        XCTAssertEqual(H5UpdateRules.latestName(names ?? [], shellBase: "3.05"), "EVCITY-AC_H5_V3.05.r99.zip")
        XCTAssertNil(H5UpdateRules.latestName(names ?? [], shellBase: "3.06"))
        XCTAssertEqual(H5UpdateRules.parseListing("<html><body><h1>文件列表</h1><table></table></body></html>"), [])
        XCTAssertNil(H5UpdateRules.parseListing("<html>404</html>"))
    }

    func testJsonTypesAreKeptApart() {
        XCTAssertEqual(H5JSON.parse("3"), .int(3))
        XCTAssertEqual(H5JSON.parse("\"3\""), .string("3"))
        XCTAssertEqual(H5JSON.parse("3.0"), .double(3.0))
        XCTAssertEqual(H5JSON.parse("true"), .bool(true))
        XCTAssertEqual(H5JSON.parse("null"), .null)
        XCTAssertEqual(H5JSON.parse(" [1, \"a\", {\"b\": [] }] "), .array([.int(1), .string("a"), .object(["b": .array([])])]))
        XCTAssertEqual(H5JSON.parse("\"a\\n\\u0041\\\"\""), .string("a\nA\""))
        for bad in ["", "{", "[1,]", "{\"a\":}", "01", "1 2", "'a'", "{\"a\" 1}", "\"abc", "nul", "-", "1."] {
            XCTAssertNil(H5JSON.parse(bad), bad)
        }
    }

    func testCheckResultAndScripts() {
        let found = H5Latest(base: "3.04", rev: 3, file: "EVCITY-AC_H5_V3.04.r3.zip", sha256: sha, size: 512345)
        let result = H5UpdateRules.checkResult(base: "3.04", found: found, current: 0, staged: -1, hasNew: true)
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual(result["base"] as? String, "3.04")
        XCTAssertEqual(result["latest"] as? Int, 3)
        XCTAssertEqual(result["current"] as? Int, 0)
        XCTAssertEqual(result["staged"] as? Int, -1)
        XCTAssertEqual(result["hasNew"] as? Bool, true)
        XCTAssertEqual(result["file"] as? String, "EVCITY-AC_H5_V3.04.r3.zip")
        XCTAssertEqual(result["size"] as? Int, 512345)
        let none = H5UpdateRules.checkResult(base: "3.04", found: nil, current: 2, staged: 3, hasNew: false)
        XCTAssertEqual(none["latest"] as? Int, -1)
        XCTAssertEqual(none["file"] as? String, "")
        XCTAssertEqual(none["size"] as? Int, 0)
        XCTAssertEqual(H5UpdateRules.failure("offline")["reason"] as? String, "offline")
        XCTAssertEqual(H5UpdateRules.script("onDone", [3]),
                       "window.__evcH5&&window.__evcH5.onDone&&window.__evcH5.onDone.apply(null,[3])")
        XCTAssertEqual(H5UpdateRules.script("onError", ["sha"]),
                       "window.__evcH5&&window.__evcH5.onError&&window.__evcH5.onError.apply(null,[\"sha\"])")
        XCTAssertEqual(H5UpdateRules.script("onProgress", [42, 219801, 512345]),
                       "window.__evcH5&&window.__evcH5.onProgress&&window.__evcH5.onProgress.apply(null,[42,219801,512345])")
        XCTAssertEqual(H5UpdateRules.hex([0x00, 0x9f, 0x2c, 0xff]), "009f2cff")
    }

    func testState() {
        let state = H5State.parse("{\"rev\":3,\"size\":1600152,\"pending\":3,\"boots\":1,\"bad\":[2,2,\"x\",5]}")
        XCTAssertEqual(state.rev, 3)
        XCTAssertEqual(state.size, 1600152)
        XCTAssertEqual(state.pending, 3)
        XCTAssertEqual(state.boots, 1)
        XCTAssertEqual(state.bad, [2, 5])
        XCTAssertEqual(H5State.parse(state.json), state)
        XCTAssertEqual(H5State.parse("garbage"), H5State())
    }
}

/// 按固定写法拼一个 zip（条目用「存储」），给目录解析和 h5/ 目录的用例用。
private func le16(_ value: Int) -> [UInt8] {
    return [UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF)]
}

private func le32(_ value: Int) -> [UInt8] {
    return [UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF), UInt8((value >> 16) & 0xFF), UInt8((value >> 24) & 0xFF)]
}

private struct ZipItem {
    var name: String
    var body: [UInt8]
    var flags = 0
    var method = 0
}

private func put(_ out: inout [UInt8], _ parts: [[UInt8]]) {
    for part in parts {
        out.append(contentsOf: part)
    }
}

private func makeZip(_ items: [ZipItem], declaredCount: Int? = nil) -> [UInt8] {
    var out: [UInt8] = []
    var directory: [UInt8] = []
    for item in items {
        let name = Array(item.name.utf8)
        let crc = Int(H5Zip.crc32(item.body))
        let size = item.body.count
        let offset = out.count
        // 本地文件头（30 字节）+ 名字 + 内容
        put(&out, [le32(0x04034B50), le16(20), le16(item.flags), le16(item.method), le16(0), le16(0x21)])
        put(&out, [le32(crc), le32(size), le32(size), le16(name.count), le16(0)])
        put(&out, [name, item.body])
        // 目录里的文件头（46 字节）+ 名字
        put(&directory, [le32(0x02014B50), le16(0x0314), le16(20), le16(item.flags), le16(item.method), le16(0), le16(0x21)])
        put(&directory, [le32(crc), le32(size), le32(size), le16(name.count), le16(0), le16(0)])
        put(&directory, [le16(0), le16(0), le32(0), le32(offset), name])
    }
    let start = out.count
    let count = declaredCount ?? items.count
    let directorySize = directory.count
    put(&out, [directory])
    // 目录结束记录（22 字节）
    put(&out, [le32(0x06054B50), le16(0), le16(0), le16(count), le16(count), le32(directorySize), le32(start), le16(0)])
    return out
}

private func pageText(_ base: String, _ rev: Int) -> String {
    return "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>" + H5UpdateRules.metaTag(base: base, rev: rev)
        + "\n<meta charset=\"utf-8\"></head><body>r" + String(rev) + "</body></html>\n"
}

private func manifestText(_ base: String, _ rev: Int) -> String {
    return "{\"kind\":\"evcity-ac-h5\",\"base\":\"" + base + "\",\"rev\":" + String(rev) + "}\n"
}

final class H5ZipTests: XCTestCase {
    private let index = Array(pageText("3.04", 3).utf8)
    private let manifest = Array(manifestText("3.04", 3).utf8)

    func testCrc32() {
        XCTAssertEqual(H5Zip.crc32(Array("123456789".utf8)), 0xCBF43926)
        XCTAssertEqual(H5Zip.crc32([]), 0)
    }

    func testGoodPackage() {
        let bytes = makeZip([ZipItem(name: "index.html", body: index), ZipItem(name: "manifest.json", body: manifest)])
        guard let entries = H5Zip.entries(bytes) else {
            XCTFail("正常的包应当读得出")
            return
        }
        XCTAssertEqual(entries.map { $0.name }, ["index.html", "manifest.json"])
        XCTAssertEqual(entries.map { $0.method }, [0, 0])
        XCTAssertEqual(entries.map { $0.size }, [index.count, manifest.count])
        XCTAssertEqual(H5Zip.packed(entries[0], in: bytes), index)
        XCTAssertEqual(H5Zip.packed(entries[1], in: bytes), manifest)
        XCTAssertTrue(H5Zip.verify(entries[0], content: index))
        XCTAssertFalse(H5Zip.verify(entries[0], content: index + [0x20]))
        XCTAssertFalse(H5Zip.verify(entries[0], content: Array(index.dropLast()) + [0x21]))
        // 条目顺序无所谓
        let swapped = makeZip([ZipItem(name: "manifest.json", body: manifest), ZipItem(name: "index.html", body: index)])
        XCTAssertEqual(H5Zip.entries(swapped)?.map { $0.name }, ["manifest.json", "index.html"])
    }

    func testOtherLayoutsAreRefused() {
        let good = [ZipItem(name: "index.html", body: index), ZipItem(name: "manifest.json", body: manifest)]
        // 多一个、少一个、别的文件、带路径、目录、大小写不对、重复
        XCTAssertNil(H5Zip.entries(makeZip(good + [ZipItem(name: "evil.so", body: index)])))
        XCTAssertNil(H5Zip.entries(makeZip([good[0]])))
        XCTAssertNil(H5Zip.entries(makeZip([good[0], ZipItem(name: "classes.dex", body: manifest)])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "../index.html", body: index), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "/index.html", body: index), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "www/index.html", body: index), ZipItem(name: "www/manifest.json", body: manifest)])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "index.html/", body: []), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "INDEX.HTML", body: index), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([good[0], good[0]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "index.html", body: []), good[1]])), "空的 index.html")
        // 加密、数据描述符、别的压缩方法
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "index.html", body: index, flags: 0x1), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "index.html", body: index, flags: 0x8), good[1]])))
        XCTAssertNil(H5Zip.entries(makeZip([ZipItem(name: "index.html", body: index, method: 12), good[1]])))
        // manifest.json 超过 4 KB
        XCTAssertNil(H5Zip.entries(makeZip([good[0], ZipItem(name: "manifest.json", body: [UInt8](repeating: 0x20, count: 4097))])))
        // 目录结束记录里写的条目数不对（zip64 用 0xFFFF）
        XCTAssertNil(H5Zip.entries(makeZip(good, declaredCount: 0xFFFF)))
        XCTAssertNil(H5Zip.entries(makeZip(good, declaredCount: 3)))
        // 不是 zip、被截断、目录偏移越界
        XCTAssertNil(H5Zip.entries(Array("<html>404</html>".utf8)))
        XCTAssertNil(H5Zip.entries([]))
        let whole = makeZip(good)
        XCTAssertNil(H5Zip.entries(Array(whole.dropLast(30))))
        XCTAssertNil(H5Zip.entries(Array(whole.dropFirst(10))))
        var shifted = whole
        shifted[shifted.count - 6] = 0xFF           // 目录偏移的低字节
        XCTAssertNil(H5Zip.entries(shifted))
    }
}

final class H5StoreTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("h5-store-tests-" + UUID().uuidString, isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    private func h5(_ name: String) -> URL {
        return root.appendingPathComponent(name, isDirectory: true).appendingPathComponent("h5", isDirectory: true)
    }

    /// 在 staging/new/ 里放好一份界面，返回这个目录。
    private func stage(_ dir: URL, _ base: String, _ rev: Int, page: String? = nil) -> URL {
        let fresh = dir.appendingPathComponent("staging", isDirectory: true).appendingPathComponent("new", isDirectory: true)
        try? FileManager.default.removeItem(at: fresh)
        try? FileManager.default.createDirectory(at: fresh, withIntermediateDirectories: true)
        try? Data((page ?? pageText(base, rev)).utf8).write(to: fresh.appendingPathComponent("index.html"))
        try? Data(manifestText(base, rev).utf8).write(to: fresh.appendingPathComponent("manifest.json"))
        return fresh
    }

    private func revIn(_ dir: URL) -> Int {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("manifest.json")),
              let text = String(data: data, encoding: .utf8) else {
            return -1
        }
        return H5UpdateRules.parseManifest(text)?.rev ?? -1
    }

    private func exists(_ url: URL) -> Bool {
        return FileManager.default.fileExists(atPath: url.path)
    }

    func testSwitchConfirmRollback() {
        let dir = h5("a")
        let current = dir.appendingPathComponent("current", isDirectory: true)
        let previous = dir.appendingPathComponent("previous", isDirectory: true)
        // 没热更新过：内置的。
        var pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true)
        XCTAssertFalse(pick.hot)
        XCTAssertEqual(pick.rev, 0)
        // 切换到 r1：还没报到。
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 1), rev: 1))
        XCTAssertEqual(revIn(current), 1)
        XCTAssertFalse(exists(previous))
        XCTAssertEqual(H5Store.readState(dir).pending, 1)
        // 同一个进程里重新加载：加载 r1，不记启动次数。
        pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: false)
        XCTAssertEqual(pick.index, current.appendingPathComponent("index.html"))
        XCTAssertEqual(pick.rev, 1)
        XCTAssertEqual(H5Store.readState(dir).boots, 0)
        H5Store.confirm(dir, rev: 1)
        XCTAssertEqual(H5Store.readState(dir).pending, -1)
        // 切换到 r2：r1 留成 previous；r2 起不来 → 进坏名单，退回 r1。
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 2), rev: 2))
        XCTAssertEqual(revIn(current), 2)
        XCTAssertEqual(revIn(previous), 1)
        pick = H5Store.rollback(dir, shellBase: "3.04", builtinRev: 0, rev: 2)
        XCTAssertTrue(pick.hot)
        XCTAssertTrue(pick.rolledBack)
        XCTAssertEqual(pick.rev, 1)
        XCTAssertEqual(revIn(current), 1)
        XCTAssertFalse(exists(previous))
        XCTAssertEqual(H5Store.readState(dir).bad, [2])
        XCTAssertEqual(H5Store.readState(dir).pending, -1)
        // 报到之后 previous 删掉。
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 3), rev: 3))
        H5Store.confirm(dir, rev: 3)
        XCTAssertFalse(exists(previous))
        // 连着两次启动没报到，第三次启动直接退回。
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 4), rev: 4))
        XCTAssertEqual(H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true).rev, 4)
        XCTAssertEqual(H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true).rev, 4)
        pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true)
        XCTAssertEqual(pick.rev, 3)
        XCTAssertTrue(pick.rolledBack)
        XCTAssertTrue(H5Store.readState(dir).bad.contains(4))
        // 选了「下次生效」（r5 没报到）又下了 r6：r5 不留，previous 还是报到过的 r3。
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 5), rev: 5))
        XCTAssertEqual(revIn(previous), 3)
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 6), rev: 6))
        XCTAssertEqual(revIn(current), 6)
        XCTAssertEqual(revIn(previous), 3)
        // 切换到一半进程没了：current/ 不在而 previous/ 在 → 把 previous/ 改名回来。
        try? FileManager.default.removeItem(at: current)
        XCTAssertEqual(H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true).rev, 3)
        // index.html 的大小和切换时记下的不一样：不用，回内置的。
        try? Data((pageText("3.04", 3) + "tampered").utf8).write(to: current.appendingPathComponent("index.html"))
        pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true)
        XCTAssertFalse(pick.hot)
        XCTAssertFalse(exists(current))
    }

    func testWhichCopyIsUsed() {
        // 修订号不大于内置的不用。
        var dir = h5("b")
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 2), rev: 2))
        H5Store.confirm(dir, rev: 2)
        var pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 2, coldStart: true)
        XCTAssertFalse(pick.hot)
        XCTAssertEqual(pick.rev, 2)
        // 基座不同（装了别的版本的安装包）：h5/ 整个清空。
        dir = h5("c")
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 3), rev: 3))
        H5Store.confirm(dir, rev: 3)
        pick = H5Store.resolve(dir, shellBase: "3.05", builtinRev: 0, coldStart: true)
        XCTAssertFalse(pick.hot)
        XCTAssertFalse(exists(dir))
        // 标记和 manifest.json 不一致：不用。
        dir = h5("d")
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 3, page: pageText("3.04", 9)), rev: 3))
        XCTAssertFalse(H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true).hot)
        // 切换完没来得及写 state.json：按「刚切换、还没报到」补上。
        dir = h5("e")
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 1), rev: 1))
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("state.json"))
        pick = H5Store.resolve(dir, shellBase: "3.04", builtinRev: 0, coldStart: true)
        XCTAssertEqual(pick.rev, 1)
        XCTAssertTrue(pick.hot)
        XCTAssertEqual(H5Store.readState(dir).pending, 1)
        // 壳的版本读不出来：不碰 h5/，用内置的。
        pick = H5Store.resolve(dir, shellBase: "", builtinRev: 0, coldStart: true)
        XCTAssertFalse(pick.hot)
        XCTAssertTrue(exists(dir.appendingPathComponent("current", isDirectory: true)))
        // 第一次热更新就起不来：退回内置的；坏名单里的修订号放回去也不用。
        dir = h5("f")
        XCTAssertTrue(H5Store.commit(dir, fresh: stage(dir, "3.04", 1), rev: 1))
        pick = H5Store.rollback(dir, shellBase: "3.04", builtinRev: 0, rev: 1)
        XCTAssertFalse(pick.hot)
        XCTAssertTrue(pick.rolledBack)
        XCTAssertEqual(pick.rev, 0)
        XCTAssertEqual(H5Store.qualify(stage(dir, "3.04", 1), shellBase: "3.04", builtinRev: 0, bad: [1], expectSize: -1),
                       H5Store.notOk)
        XCTAssertEqual(H5Store.qualify(stage(dir, "3.04", 1), shellBase: "3.04", builtinRev: 0, bad: [], expectSize: -1), 1)
        XCTAssertEqual(H5Store.qualify(stage(dir, "3.04", 1), shellBase: "3.05", builtinRev: 0, bad: [], expectSize: -1),
                       H5Store.otherBase)
        // 没有 h5/ 目录、root 是 nil：内置的。
        XCTAssertFalse(H5Store.resolve(nil, shellBase: "3.04", builtinRev: 0, coldStart: true).hot)
        XCTAssertFalse(H5Store.resolve(h5("none"), shellBase: "3.04", builtinRev: 0, coldStart: true).hot)
    }
}
