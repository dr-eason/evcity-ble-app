import Foundation

/// App 自己的更新检查（AC-34）里不依赖 UIKit / 网络的规则。和 Android 的 AppUpdater.java、
/// 界面的 ui/src/app-update.js 是同一套：
///
/// - 服务器：OTA 文件站上和 AC06/、M01/ 同级的文件夹「Android APP/」，每个版本一个文件，名字固定
///   `EVCITY-AC_V<版本>.apk`（正则 `^EVCITY-AC_V(\d+(?:\.\d+)*)\.apk$`，数字只认 ASCII 的 0-9），没有清单文件。
/// - 读目录列表那张 HTML 表，名字不合规矩的文件和子目录（大小一栏是「目录」）不看，版本号按数字
///   逐段比，取最大的，和装着的版本（CFBundleShortVersionString）比。
/// - iOS 只查不下载：有新版本时界面弹「有软件更新，请前往 App Store 更新」。iOS 和 Android 的
///   版本号同步发布，所以拿 APK 文件夹里的最高版本当「最新版本」，这是约定。
/// - 结果回页面：`window.__evcUpd.onCheck({ok:true, latest, current, hasNew, file})`
///   或 `{ok:false, reason:"offline"|"http"|"parse"}`。文件夹还不存在（HTTP 404 / 410）和空文件夹一样回
///   `ok:true`、`latest ""`、`hasNew false`（手动查显示「已是最新版本」）；`"http"` 只指别的状态码。
public enum AppUpdateRules {
    public static let listURL = "http://8.210.219.113:8088/files/Android%20APP/"
    public static let apkPrefix = "EVCITY-AC_V"
    public static let apkSuffix = ".apk"
    /// 查询超时（秒），和 Android 一样。
    public static let timeout: TimeInterval = 8
    public static let maxListBytes = 512 * 1024

    /// 页面发来的是不是 `EVC.updCheck()`（evc-shim.js 转成 `{m: "updCheck", a: []}`）。
    public static func isCheckCall(_ body: Any?) -> Bool {
        guard let dict = body as? [String: Any], let name = dict["m"] as? String else {
            return false
        }
        return name == "updCheck"
    }

    /// "3.0.9" 这种：一段或多段 ASCII 数字，用 . 隔开，没有空段。
    static func isDottedDigits(_ text: Substring) -> Bool {
        if text.isEmpty {
            return false
        }
        for part in text.split(separator: ".", omittingEmptySubsequences: false) {
            if part.isEmpty {
                return false
            }
            for scalar in part.unicodeScalars where scalar.value < 0x30 || scalar.value > 0x39 {
                return false
            }
        }
        return true
    }

    /// "EVCITY-AC_V3.0.9.apk" → "3.0.9"；不是这种名字返回 nil。
    public static func apkVersion(_ fileName: String) -> String? {
        guard fileName.hasPrefix(apkPrefix), fileName.hasSuffix(apkSuffix),
              fileName.count > apkPrefix.count + apkSuffix.count else {
            return nil
        }
        let middle = fileName.dropFirst(apkPrefix.count).dropLast(apkSuffix.count)
        return isDottedDigits(middle) ? String(middle) : nil
    }

    /// 版本号开头的数字段："3.0.8" / "V3.0.8" / "3.0.8-beta" → "3.0.8"；没有数字开头 → "0"。
    public static func versionCore(_ text: String) -> String {
        var scalars = Array(text.unicodeScalars)
        while let first = scalars.first, first == " " || first == "\t" || first == "\n" || first == "\r" {
            scalars.removeFirst()
        }
        if let first = scalars.first, first == "V" || first == "v" {
            scalars.removeFirst()
        }
        var out = ""
        var lastWasDot = true
        for scalar in scalars {
            if scalar.value >= 0x30 && scalar.value <= 0x39 {
                out.unicodeScalars.append(scalar)
                lastWasDot = false
            } else if scalar == "." && !lastWasDot {
                out.unicodeScalars.append(scalar)
                lastWasDot = true
            } else {
                break
            }
        }
        if out.hasSuffix(".") {
            out.removeLast()
        }
        return out.isEmpty ? "0" : out
    }

    private static func stripZeros(_ digits: Substring) -> Substring {
        var rest = digits
        while rest.count > 1, rest.first == "0" {
            rest = rest.dropFirst()
        }
        return rest
    }

    /// 按数字逐段比：3.0.10 > 3.0.9，3.1 > 3.0.9，3.1 = 3.1.0。段数不够的当 0。返回 -1 / 0 / 1。
    /// 不转成整数，位数再多也不溢出。
    public static func compare(_ a: String, _ b: String) -> Int {
        let x = versionCore(a).split(separator: ".")
        let y = versionCore(b).split(separator: ".")
        let zero: Substring = "0"
        for index in 0..<max(x.count, y.count) {
            let p = stripZeros(index < x.count ? x[index] : zero)
            let q = stripZeros(index < y.count ? y[index] : zero)
            if p.count != q.count {
                return p.count < q.count ? -1 : 1
            }
            if p != q {
                return p < q ? -1 : 1
            }
        }
        return 0
    }

    /// 目录列表 HTML → 名字合规矩的 APK 文件名（子目录不要，重复的只留一个）。不是列表页返回 nil。
    /// 一行形如 `<tr><td><a href="/files/Android%20APP/名字">名字</a></td><td class="size">大小</td>…`。
    public static func parseListing(_ html: String) -> [String]? {
        var names: [String] = []
        var rows = 0
        for chunk in html.components(separatedBy: "<tr>").dropFirst() {
            let end = chunk.endIndex
            guard let anchor = chunk.range(of: "<a "),
                  let open = chunk.range(of: ">", range: anchor.upperBound..<end),
                  let close = chunk.range(of: "</a>", range: open.upperBound..<end),
                  let sizeAttr = chunk.range(of: "class=\"size\"", range: close.upperBound..<end),
                  let sizeOpen = chunk.range(of: ">", range: sizeAttr.upperBound..<end),
                  let sizeClose = chunk.range(of: "<", range: sizeOpen.upperBound..<end) else {
                continue
            }
            rows += 1
            let name = String(chunk[open.upperBound..<close.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            let size = String(chunk[sizeOpen.upperBound..<sizeClose.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            if size == "目录" || apkVersion(name) == nil || names.contains(name) {
                continue
            }
            names.append(name)
        }
        if rows == 0 && !html.contains("<table") && !html.contains("文件列表") && !html.contains("当前目录") {
            return nil
        }
        return names
    }

    /// 版本最大的那个文件名；一个合规矩的都没有返回 nil。
    public static func latest(_ names: [String]) -> String? {
        var best: String?
        var bestVersion = ""
        for name in names {
            guard let version = apkVersion(name) else {
                continue
            }
            if best == nil || compare(version, bestVersion) > 0 {
                best = name
                bestVersion = version
            }
        }
        return best
    }

    public static func failure(_ reason: String) -> [String: Any] {
        return ["ok": false, "reason": reason]
    }

    /// 一次请求的结果 → 回给页面的对象。failed：请求本身失败（没网、超时）；status：HTTP 状态码。
    /// 404 / 410（文件夹还不存在）算成功、没有更新；别的非 200 是 "http"。
    public static func evaluate(data: Data?, status: Int?, failed: Bool, current: String) -> [String: Any] {
        guard !failed, let status = status else {
            return failure("offline")
        }
        if status == 404 || status == 410 {
            // 文件夹还不存在：和空文件夹一样，算「没有更新的版本」，不算失败。
            return ["ok": true, "latest": "", "current": versionCore(current), "hasNew": false, "file": ""]
        }
        if status != 200 {
            return failure("http")
        }
        guard let data = data, data.count <= maxListBytes, let html = String(data: data, encoding: .utf8),
              let names = parseListing(html) else {
            return failure("parse")
        }
        let now = versionCore(current)
        let file = latest(names) ?? ""
        let newest = apkVersion(file) ?? ""
        let hasNew = !newest.isEmpty && compare(newest, now) > 0
        return ["ok": true, "latest": newest, "current": now, "hasNew": hasNew, "file": file]
    }

    /// 交给 evaluateJavaScript 的那一句。
    public static func script(_ result: [String: Any]) -> String {
        return "window.__evcUpd&&window.__evcUpd.onCheck&&window.__evcUpd.onCheck(" + JSONText.encode(result) + ")"
    }
}
