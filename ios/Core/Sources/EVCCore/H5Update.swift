import Foundation

/// 界面热更新（H5 热更新）里不依赖 UIKit / 网络 / 系统压缩库的规则，Mac 和 Linux 上都能测。和 Android 的
/// H5Updater.java、界面的 ui/src/h5-update.js 是同一套；联网、下载、解 deflate 在 App 的 H5Updater.swift。
///
/// - 更新的是 APP/ui 编出来的那份单文件 index.html，原生壳和 evc-shim.js 不在范围里。每个 App 版本（基座，
///   就是 CFBundleShortVersionString 原文，例如 3.04）下面有自己的修订号 rN，安装包内置的那份是 r0。
///   包只给同一个基座的壳用（字符串完全相同，不做 3.4 = 3.04 的换算），修订号只往上走。
/// - 服务器：OTA 文件站上每个基座一个文件夹 `http://ftp.evcity.cc:8088/files/Android%20APP/V<基座>/`
///   （文件夹名是历史原因，iOS 也读这里），里面是
///     `EVCITY-AC_H5_V<基座>.r<N>.zip`（正则 `^EVCITY-AC_H5_V(\d+\.\d+)\.r(\d+)\.zip$`）：根目录正好
///       index.html + manifest.json 两个文件；
///     `EVCITY-AC_H5_V<基座>.r<N>.zip.sha256`：一行「<64 位小写十六进制>  <包名>\n」；
///     `latest.json`：`{"kind":"evcity-ac-h5","base":"3.04","rev":3,"file":…,"sha256":…,"size":…}`。
///   先读 latest.json，合格就用它（它说了算）；404 或内容不合格才读目录列表做后备、再取那个包的旁文件。
///   除了这几样不读服务器上别的文件：没有开关或配置文件。完整性只核 SHA-256 和大小，不验签名。
/// - 每个地址先过 `CloudRules.url`，不跟随重定向。ATS 例外不变。
/// - 结果回页面：`window.__evcH5.onCheck / onProgress / onDone / onError`。
public enum H5UpdateRules {
    public static let rootURL = "http://ftp.evcity.cc:8088/files/Android%20APP/"
    public static let latestName = "latest.json"
    public static let namePrefix = "EVCITY-AC_H5_V"
    public static let nameSuffix = ".zip"
    public static let kind = "evcity-ac-h5"
    public static let indexName = "index.html"
    public static let manifestName = "manifest.json"
    public static let revMax = 999999
    public static let zipMaxBytes = 8 * 1024 * 1024
    public static let indexMaxBytes = 16 * 1024 * 1024
    public static let manifestMaxBytes = 4096
    public static let latestMaxBytes = 4096
    public static let listMaxBytes = 512 * 1024
    public static let shaMaxBytes = 1024
    public static let metaHeadBytes = 4096
    /// 查询的单个请求超时（秒），和 Android 一样。
    public static let timeout: TimeInterval = 8
    public static let downloadTimeout: TimeInterval = 15
    /// 加载了热更新的界面之后，在前台等这么久没等到 h5Ready() 就退回。
    public static let readyTimeout: TimeInterval = 10
    /// 同一个没报到的修订号连着这么多次启动都没报到，下一次启动直接退回。
    public static let unconfirmedBootsMax = 2

    static func isDigits(_ text: Substring) -> Bool {
        if text.isEmpty {
            return false
        }
        for scalar in text.unicodeScalars where scalar.value < 0x30 || scalar.value > 0x39 {
            return false
        }
        return true
    }

    /// 基座的写法：两段 ASCII 数字，例如 "3.04"。
    public static func baseOk(_ base: String) -> Bool {
        let parts = base.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 2 && isDigits(parts[0]) && isDigits(parts[1])
    }

    /// "3.04" → "http://ftp.evcity.cc:8088/files/Android%20APP/V3.04/"；基座不像样返回 nil。
    public static func folderURL(_ base: String) -> String? {
        return baseOk(base) ? rootURL + "V" + base + "/" : nil
    }

    public static func fileName(base: String, rev: Int) -> String {
        return namePrefix + base + ".r" + String(rev) + nameSuffix
    }

    /// "EVCITY-AC_H5_V3.04.r3.zip" → (3.04, 3)；不是这种名字、修订号补了零（r03）、超过 999999 → nil。
    public static func parseName(_ file: String) -> H5Name? {
        let scalars = Array(file.unicodeScalars)
        let prefix = Array(namePrefix.unicodeScalars)
        let suffix = Array(nameSuffix.unicodeScalars)
        guard scalars.count > prefix.count + suffix.count,
              Array(scalars[0..<prefix.count]) == prefix,
              Array(scalars[(scalars.count - suffix.count)...]) == suffix else {
            return nil
        }
        let middle = scalars[prefix.count..<(scalars.count - suffix.count)]     // "3.04.r3"
        // 从后往前找 ".r"
        var mark: Int?
        var index = middle.endIndex - 2
        while index >= middle.startIndex {
            if middle[index] == "." && middle[index + 1] == "r" {
                mark = index
                break
            }
            index -= 1
        }
        guard let split = mark else {
            return nil
        }
        var base = ""
        base.unicodeScalars.append(contentsOf: middle[middle.startIndex..<split])
        var digits = ""
        digits.unicodeScalars.append(contentsOf: middle[(split + 2)...])
        guard baseOk(base), isDigits(Substring(digits)), digits.unicodeScalars.count <= 6,
              !(digits.unicodeScalars.count > 1 && digits.unicodeScalars.first == "0"),
              let rev = Int(digits) else {
            return nil
        }
        return H5Name(base: base, rev: rev)
    }

    /// index.html 开头要有的标记。
    public static func metaTag(base: String, rev: Int) -> String {
        return "<meta name=\"evc-h5\" content=\"" + base + ".r" + String(rev) + "\">"
    }

    /// index.html 的前 4 KB 里有没有对得上的标记。
    public static func metaMatches(head: Data, base: String, rev: Int) -> Bool {
        let text = String(decoding: head.prefix(metaHeadBytes), as: UTF8.self)
        return text.contains(metaTag(base: base, rev: rev))
    }

    /// 修订号：0–999999 的整数；别的（字符串、小数、布尔、负数）→ nil。
    static func rev(_ value: H5JSON?) -> Int? {
        guard case .int(let number)? = value, number >= 0, number <= revMax else {
            return nil
        }
        return number
    }

    /// manifest.json：{"kind":"evcity-ac-h5","base":"3.04","rev":3} → (base, rev)；不对 → nil。
    public static func parseManifest(_ text: String) -> H5Name? {
        guard case .object(let object)? = H5JSON.parse(text),
              case .string(let kindText)? = object["kind"], kindText == kind,
              case .string(let base)? = object["base"], baseOk(base),
              let number = rev(object["rev"]) else {
            return nil
        }
        return H5Name(base: base, rev: number)
    }

    static func isSha(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        if bytes.count != 64 {
            return false
        }
        for byte in bytes where !((byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66)) {
            return false
        }
        return true
    }

    /// latest.json：六个字段都要有、类型要对，多出来的不看。base 必须等于壳的 App 版本，file 必须正好是
    /// EVCITY-AC_H5_V<base>.r<rev>.zip，sha256 是 64 位小写十六进制，size 是 1 到 8 MB 的整数。不合格 → nil。
    public static func parseLatest(_ text: String, shellBase: String) -> H5Latest? {
        guard case .object(let object)? = H5JSON.parse(text),
              case .string(let kindText)? = object["kind"], kindText == kind,
              case .string(let base)? = object["base"], baseOk(base), base == shellBase,
              let number = rev(object["rev"]),
              case .string(let file)? = object["file"], file == fileName(base: base, rev: number),
              case .string(let sha)? = object["sha256"], isSha(sha),
              case .int(let size)? = object["size"], size >= 1, size <= zipMaxBytes else {
            return nil
        }
        return H5Latest(base: base, rev: number, file: file, sha256: sha, size: size)
    }

    /// .zip.sha256 那一行：「<64 位小写十六进制>  <包名>\n」（两个空格）→ 十六进制；不对 → nil。
    public static func parseShaLine(_ text: String, file: String) -> String? {
        var bytes = Array(text.utf8)
        if bytes.last == 0x0A {
            bytes.removeLast()
        }
        if bytes.last == 0x0D {
            bytes.removeLast()
        }
        let want = Array(file.utf8)
        guard !want.isEmpty, bytes.count == 66 + want.count, bytes[64] == 0x20, bytes[65] == 0x20,
              Array(bytes[66...]) == want else {
            return nil
        }
        let sha = String(decoding: bytes[0..<64], as: UTF8.self)
        return isSha(sha) ? sha : nil
    }

    /// 目录列表 HTML → 名字合规矩的热更新包（子目录不要，重复的只留一个）。不是列表页返回 nil。
    /// 和 AppUpdateRules.parseListing 读的是同一种页面。
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
            if size == "目录" || parseName(name) == nil || names.contains(name) {
                continue
            }
            names.append(name)
        }
        if rows == 0 && !html.contains("<table") && !html.contains("文件列表") && !html.contains("当前目录") {
            return nil
        }
        return names
    }

    /// 这个基座修订号最大的那个文件名；一个都没有返回 nil。别的基座的包不看。
    public static func latestName(_ names: [String], shellBase: String) -> String? {
        var best: String?
        var bestRev = -1
        for name in names {
            guard let parsed = parseName(name), parsed.base == shellBase, parsed.rev > bestRev else {
                continue
            }
            best = name
            bestRev = parsed.rev
        }
        return best
    }

    public static func hex(_ bytes: [UInt8]) -> String {
        let digits = Array("0123456789abcdef".utf8)
        var out: [UInt8] = []
        out.reserveCapacity(bytes.count * 2)
        for byte in bytes {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 15)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    // MARK: 回页面

    public static func failure(_ reason: String) -> [String: Any] {
        return ["ok": false, "reason": reason]
    }

    /// 查询结果 → 回给页面的对象。found：服务器上这个基座最新的包（没有是 nil）；current：屏幕上这一页的
    /// 修订号；staged：磁盘上已经切换好、页面还没重新加载的修订号（没有是 -1）。
    public static func checkResult(base: String, found: H5Latest?, current: Int, staged: Int, hasNew: Bool) -> [String: Any] {
        return [
            "ok": true,
            "base": base,
            "latest": found?.rev ?? -1,
            "current": current,
            "staged": staged,
            "hasNew": hasNew,
            "file": found?.file ?? "",
            "size": found?.size ?? 0,
        ]
    }

    /// 交给 evaluateJavaScript 的那一句：window.__evcH5.<name>(参数…)。页面没注册时什么也不做。
    public static func script(_ name: String, _ arguments: [Any]) -> String {
        return "window.__evcH5&&window.__evcH5." + name + "&&window.__evcH5." + name + ".apply(null,"
            + JSONText.encode(arguments) + ")"
    }
}

public struct H5Name: Equatable {
    public let base: String
    public let rev: Int

    public init(base: String, rev: Int) {
        self.base = base
        self.rev = rev
    }
}

public struct H5Latest: Equatable {
    public let base: String
    public let rev: Int
    public let file: String
    /// 64 位小写十六进制；从目录列表来、还不用下载时是 ""。
    public let sha256: String
    /// zip 的字节数；从目录列表来的不知道，是 0。
    public let size: Int

    public init(base: String, rev: Int, file: String, sha256: String, size: Int) {
        self.base = base
        self.rev = rev
        self.file = file
        self.sha256 = sha256
        self.size = size
    }
}

// MARK: - 很小的 JSON 读法

/// 类型分得清的 JSON 值：整数是 `.int`，"3" 是 `.string`，3.0 是 `.double`，true 是 `.bool`。
/// 不用 JSONSerialization：它在 Mac 和 Linux 上把数字、布尔交回来的类型不一样，"rev":"3"、"rev":true
/// 这种要拒绝的写法容易被当成 3 / 1。
public enum H5JSON: Equatable {
    case object([String: H5JSON])
    case array([H5JSON])
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null

    /// 整段文字是一个 JSON 值才算数；看不懂返回 nil。
    public static func parse(_ text: String) -> H5JSON? {
        var reader = H5JSONReader(text)
        guard let value = reader.value(0) else {
            return nil
        }
        return reader.atEnd() ? value : nil
    }
}

struct H5JSONReader {
    private let bytes: [UInt8]
    private var index = 0

    init(_ text: String) {
        bytes = Array(text.utf8)
    }

    private mutating func skipSpace() {
        while index < bytes.count {
            let byte = bytes[index]
            if byte != 0x20 && byte != 0x09 && byte != 0x0A && byte != 0x0D {
                break
            }
            index += 1
        }
    }

    mutating func atEnd() -> Bool {
        skipSpace()
        return index == bytes.count
    }

    private func peek() -> UInt8? {
        return index < bytes.count ? bytes[index] : nil
    }

    private mutating func take(_ byte: UInt8) -> Bool {
        if index < bytes.count && bytes[index] == byte {
            index += 1
            return true
        }
        return false
    }

    private mutating func literal(_ word: String) -> Bool {
        let want = Array(word.utf8)
        if index + want.count <= bytes.count && Array(bytes[index..<(index + want.count)]) == want {
            index += want.count
            return true
        }
        return false
    }

    private func isDigit(_ byte: UInt8?) -> Bool {
        guard let byte = byte else {
            return false
        }
        return byte >= 0x30 && byte <= 0x39
    }

    mutating func value(_ depth: Int) -> H5JSON? {
        if depth > 16 {
            return nil
        }
        skipSpace()
        guard let first = peek() else {
            return nil
        }
        if first == 0x7B {          // {
            index += 1
            var map: [String: H5JSON] = [:]
            skipSpace()
            if take(0x7D) {
                return .object(map)
            }
            while true {
                skipSpace()
                guard let key = string() else {
                    return nil
                }
                skipSpace()
                if !take(0x3A) {
                    return nil
                }
                guard let item = value(depth + 1) else {
                    return nil
                }
                map[key] = item
                skipSpace()
                if take(0x2C) {
                    continue
                }
                return take(0x7D) ? .object(map) : nil
            }
        }
        if first == 0x5B {          // [
            index += 1
            var list: [H5JSON] = []
            skipSpace()
            if take(0x5D) {
                return .array(list)
            }
            while true {
                guard let item = value(depth + 1) else {
                    return nil
                }
                list.append(item)
                skipSpace()
                if take(0x2C) {
                    continue
                }
                return take(0x5D) ? .array(list) : nil
            }
        }
        if first == 0x22 {
            guard let text = string() else {
                return nil
            }
            return .string(text)
        }
        if literal("true") {
            return .bool(true)
        }
        if literal("false") {
            return .bool(false)
        }
        if literal("null") {
            return .null
        }
        return number()
    }

    private mutating func string() -> String? {
        if !take(0x22) {
            return nil
        }
        var out: [UInt8] = []
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 0x22 {
                return String(decoding: out, as: UTF8.self)
            }
            if byte < 0x20 {
                return nil
            }
            if byte != 0x5C {
                out.append(byte)
                continue
            }
            guard index < bytes.count else {
                return nil
            }
            let escape = bytes[index]
            index += 1
            switch escape {
            case 0x22: out.append(0x22)
            case 0x5C: out.append(0x5C)
            case 0x2F: out.append(0x2F)
            case 0x62: out.append(0x08)
            case 0x66: out.append(0x0C)
            case 0x6E: out.append(0x0A)
            case 0x72: out.append(0x0D)
            case 0x74: out.append(0x09)
            case 0x75:
                guard index + 4 <= bytes.count else {
                    return nil
                }
                let digits = String(decoding: bytes[index..<(index + 4)], as: UTF8.self)
                guard digits.utf8.count == 4, let code = UInt32(digits, radix: 16) else {
                    return nil
                }
                index += 4
                let fallback: Unicode.Scalar = "\u{FFFD}"
                let scalar = Unicode.Scalar(code) ?? fallback
                out.append(contentsOf: Array(String(Character(scalar)).utf8))
            default:
                return nil
            }
        }
        return nil
    }

    private mutating func number() -> H5JSON? {
        let start = index
        if peek() == 0x2D {
            index += 1
        }
        let digits = index
        while isDigit(peek()) {
            index += 1
        }
        if index == digits || (bytes[digits] == 0x30 && index - digits > 1) {
            return nil
        }
        var whole = true
        if peek() == 0x2E {
            whole = false
            index += 1
            let fraction = index
            while isDigit(peek()) {
                index += 1
            }
            if index == fraction {
                return nil
            }
        }
        if peek() == 0x65 || peek() == 0x45 {
            whole = false
            index += 1
            if peek() == 0x2B || peek() == 0x2D {
                index += 1
            }
            let exponent = index
            while isDigit(peek()) {
                index += 1
            }
            if index == exponent {
                return nil
            }
        }
        let text = String(decoding: bytes[start..<index], as: UTF8.self)
        if whole && index - start <= 18, let number = Int(text) {
            return .int(number)
        }
        guard let number = Double(text) else {
            return nil
        }
        return .double(number)
    }
}

// MARK: - zip 的目录

public struct H5ZipEntry: Equatable {
    public let name: String
    /// 0 = 存储，8 = deflate。
    public let method: Int
    public let crc32: UInt32
    public let compressedSize: Int
    public let size: Int
    /// 压缩数据在 zip 里的起点。
    public let dataOffset: Int
}

/// 只读固定写法的热更新包：根目录正好两个条目 index.html、manifest.json，「存储」或 deflate，不加密、
/// 不用 zip64、不带数据描述符。这里只读目录、查条目；解 deflate 用系统的 Compression，在 App 里做。
public enum H5Zip {
    private static func u16(_ bytes: [UInt8], _ at: Int) -> Int {
        return Int(bytes[at]) | (Int(bytes[at + 1]) << 8)
    }

    private static func u32(_ bytes: [UInt8], _ at: Int) -> Int {
        return Int(bytes[at]) | (Int(bytes[at + 1]) << 8) | (Int(bytes[at + 2]) << 16) | (Int(bytes[at + 3]) << 24)
    }

    private static func flagsOk(_ flags: Int) -> Bool {
        // 第 0 位：加密；第 3 位：数据描述符。只放过压缩选项（1、2 位）和 UTF-8 文件名（11 位）。
        return flags & ~0x0806 == 0
    }

    /// zip 的两个条目（顺序按目录里的）。不是上面那种固定写法 → nil：多一个、少一个、名字带路径、是目录、
    /// 是别的文件、加密、zip64、带数据描述符、偏移越界、被截断，整个包拒绝。
    public static func entries(_ bytes: [UInt8]) -> [H5ZipEntry]? {
        let count = bytes.count
        if count < 22 || count > H5UpdateRules.zipMaxBytes {
            return nil
        }
        // 目录结束记录：从后往前找签名 50 4B 05 06。
        var eocd = -1
        var at = count - 22
        let lowest = max(0, count - 22 - 65535)
        while at >= lowest {
            if bytes[at] == 0x50 && bytes[at + 1] == 0x4B && bytes[at + 2] == 0x05 && bytes[at + 3] == 0x06
                && at + 22 + u16(bytes, at + 20) == count {
                eocd = at
                break
            }
            at -= 1
        }
        if eocd < 0 {
            return nil
        }
        let disk = u16(bytes, eocd + 4)
        let startDisk = u16(bytes, eocd + 6)
        let here = u16(bytes, eocd + 8)
        let total = u16(bytes, eocd + 10)
        let dirSize = u32(bytes, eocd + 12)
        let dirOffset = u32(bytes, eocd + 16)
        if disk != 0 || startDisk != 0 || here != 2 || total != 2 || dirSize == 0xFFFFFFFF || dirOffset == 0xFFFFFFFF
            || dirOffset + dirSize > eocd {
            return nil
        }
        // zip64 的定位记录（50 4B 06 07）紧贴在前面：不认。
        if eocd >= 20 && bytes[eocd - 20] == 0x50 && bytes[eocd - 19] == 0x4B && bytes[eocd - 18] == 0x06
            && bytes[eocd - 17] == 0x07 {
            return nil
        }
        var out: [H5ZipEntry] = []
        var position = dirOffset
        let dirEnd = dirOffset + dirSize
        for _ in 0..<2 {
            if position + 46 > dirEnd || u32(bytes, position) != 0x02014B50 {
                return nil
            }
            let flags = u16(bytes, position + 8)
            let method = u16(bytes, position + 10)
            let crc = UInt32(truncatingIfNeeded: u32(bytes, position + 16))
            let packed = u32(bytes, position + 20)
            let size = u32(bytes, position + 24)
            let nameLength = u16(bytes, position + 28)
            let extraLength = u16(bytes, position + 30)
            let commentLength = u16(bytes, position + 32)
            let entryDisk = u16(bytes, position + 34)
            let localOffset = u32(bytes, position + 42)
            let next = position + 46 + nameLength + extraLength + commentLength
            if next > dirEnd || !flagsOk(flags) || (method != 0 && method != 8) || entryDisk != 0
                || packed == 0xFFFFFFFF || size == 0xFFFFFFFF || localOffset == 0xFFFFFFFF {
                return nil
            }
            let nameBytes = Array(bytes[(position + 46)..<(position + 46 + nameLength)])
            let name: String
            let limit: Int
            if nameBytes == Array(H5UpdateRules.indexName.utf8) {
                name = H5UpdateRules.indexName
                limit = H5UpdateRules.indexMaxBytes
            } else if nameBytes == Array(H5UpdateRules.manifestName.utf8) {
                name = H5UpdateRules.manifestName
                limit = H5UpdateRules.manifestMaxBytes
            } else {
                return nil
            }
            if size < 1 || size > limit || (method == 0 && packed != size) || out.contains(where: { $0.name == name }) {
                return nil
            }
            // 本地文件头：签名、标志、压缩方法、名字都要和目录里的一致，数据不能伸到目录里。
            if localOffset + 30 > dirOffset || u32(bytes, localOffset) != 0x04034B50 {
                return nil
            }
            let localFlags = u16(bytes, localOffset + 6)
            let localMethod = u16(bytes, localOffset + 8)
            let localNameLength = u16(bytes, localOffset + 26)
            let localExtraLength = u16(bytes, localOffset + 28)
            let dataOffset = localOffset + 30 + localNameLength + localExtraLength
            if !flagsOk(localFlags) || localMethod != method || localNameLength != nameLength
                || dataOffset + packed > dirOffset
                || Array(bytes[(localOffset + 30)..<(localOffset + 30 + localNameLength)]) != nameBytes {
                return nil
            }
            out.append(H5ZipEntry(name: name, method: method, crc32: crc, compressedSize: packed, size: size,
                                  dataOffset: dataOffset))
            position = next
        }
        if position != dirEnd {
            return nil
        }
        return out
    }

    private static let crcTable: [UInt32] = {
        var table = [UInt32](repeating: 0, count: 256)
        for index in 0..<256 {
            var value = UInt32(index)
            for _ in 0..<8 {
                value = (value & 1) != 0 ? (0xEDB88320 ^ (value >> 1)) : (value >> 1)
            }
            table[index] = value
        }
        return table
    }()

    /// zip 用的 CRC-32。
    public static func crc32(_ bytes: [UInt8]) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        for byte in bytes {
            crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
        }
        return crc ^ 0xFFFFFFFF
    }

    /// 条目的压缩数据。
    public static func packed(_ entry: H5ZipEntry, in bytes: [UInt8]) -> [UInt8] {
        return Array(bytes[entry.dataOffset..<(entry.dataOffset + entry.compressedSize)])
    }

    /// 解出来的内容对不对：长度和 CRC-32 都要等于目录里写的。
    public static func verify(_ entry: H5ZipEntry, content: [UInt8]) -> Bool {
        return content.count == entry.size && crc32(content) == entry.crc32
    }
}

// MARK: - 手机上的 h5/ 目录

/// state.json：小状态。
public struct H5State: Equatable {
    /// current/ 的修订号（切换时记下的）。
    public var rev = -1
    /// current/index.html 的字节数（切换时记下的）。
    public var size = -1
    /// 切换了但还没报到（h5Ready）的修订号；没有是 -1。
    public var pending = -1
    /// pending 那个修订号已经启动过几次还没报到。
    public var boots = 0
    /// 起不来、退回过的修订号：不再提示、不再下载。
    public var bad: [Int] = []

    public init() {}

    public static func parse(_ text: String) -> H5State {
        var state = H5State()
        guard case .object(let object)? = H5JSON.parse(text) else {
            return state
        }
        state.rev = H5UpdateRules.rev(object["rev"]) ?? -1
        state.pending = H5UpdateRules.rev(object["pending"]) ?? -1
        if case .int(let size)? = object["size"], size >= 0 {
            state.size = size
        }
        if case .int(let boots)? = object["boots"], boots >= 0, boots < 1000 {
            state.boots = boots
        }
        if case .array(let list)? = object["bad"] {
            for item in list {
                if let rev = H5UpdateRules.rev(item), !state.bad.contains(rev), state.bad.count < 256 {
                    state.bad.append(rev)
                }
            }
        }
        return state
    }

    public var json: String {
        return "{\"rev\":\(rev),\"size\":\(size),\"pending\":\(pending),\"boots\":\(boots),\"bad\":["
            + bad.map { String($0) }.joined(separator: ",") + "]}\n"
    }
}

/// 这一次加载哪一份。
public struct H5Pick: Equatable {
    /// 要加载的 index.html；nil = 安装包内置的那一份。
    public let index: URL?
    /// 这一份的修订号（内置的就是内置的修订号）。
    public let rev: Int
    /// 这一次是把起不来的那一份退回之后选出来的。
    public let rolledBack: Bool

    public var hot: Bool {
        return index != nil
    }
}

/// h5/ 目录里的文件操作（方案 6.1、6.2、6.4、6.6）。只用 Foundation，Linux 上也能测。
///
///     h5/
///       current/   index.html manifest.json   现在生效的热更新（没热更新过就没有）
///       previous/  index.html manifest.json   上一份；只在新的一份还没报到期间留着，用来退回
///       staging/                               下载中的 .part、解压出来还没切换的 new/
///       state.json
public enum H5Store {
    public static let notOk = -1
    public static let otherBase = -2

    static func exists(_ url: URL) -> Bool {
        return FileManager.default.fileExists(atPath: url.path)
    }

    static func isDirectory(_ url: URL) -> Bool {
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) && directory.boolValue
    }

    public static func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    static func move(_ from: URL, _ to: URL) -> Bool {
        do {
            try FileManager.default.moveItem(at: from, to: to)
            return true
        } catch {
            return false
        }
    }

    static func fileSize(_ url: URL) -> Int {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return -1
        }
        if let number = attributes[.size] as? NSNumber {
            return number.intValue
        }
        if let number = attributes[.size] as? Int {
            return number
        }
        if let number = attributes[.size] as? UInt64 {
            return Int(number)
        }
        return -1
    }

    /// 读一个小文件，最多 limit 字节；不在、太大、读不了 → nil。
    static func readSmall(_ url: URL, limit: Int) -> Data? {
        let size = fileSize(url)
        guard size >= 0, size <= limit, let data = try? Data(contentsOf: url), data.count <= limit else {
            return nil
        }
        return data
    }

    /// 文件的前 count 个字节。
    static func head(_ url: URL, count: Int) -> Data? {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return nil
        }
        defer {
            handle.closeFile()
        }
        return handle.readData(ofLength: count)
    }

    static func manifest(in directory: URL) -> H5Name? {
        guard let data = readSmall(directory.appendingPathComponent(H5UpdateRules.manifestName),
                                   limit: H5UpdateRules.manifestMaxBytes),
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        return H5UpdateRules.parseManifest(text)
    }

    public static func readState(_ root: URL) -> H5State {
        guard let data = readSmall(root.appendingPathComponent("state.json"), limit: 16384),
              let text = String(data: data, encoding: .utf8) else {
            return H5State()
        }
        return H5State.parse(text)
    }

    @discardableResult
    public static func writeState(_ root: URL, _ state: H5State) -> Bool {
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            try Data(state.json.utf8).write(to: root.appendingPathComponent("state.json"), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// directory（current/ 或 previous/）里的那一份合不合格。合格返回它的修订号；基座和壳不同返回 otherBase；
    /// 别的不合格返回 notOk。合格要同时满足：manifest.json 读得出、kind 对、base 和壳的 App 版本完全相同、
    /// rev 大于内置的修订号、rev 不在坏名单里、index.html 在、开头的标记和 manifest.json 一致；
    /// expectSize >= 0 时 index.html 的大小还要等于它（切换时记下的）。
    public static func qualify(_ directory: URL, shellBase: String, builtinRev: Int, bad: [Int], expectSize: Int) -> Int {
        guard isDirectory(directory), let found = manifest(in: directory) else {
            return notOk
        }
        if found.base != shellBase {
            return otherBase
        }
        let index = directory.appendingPathComponent(H5UpdateRules.indexName)
        let size = fileSize(index)
        if found.rev <= builtinRev || bad.contains(found.rev) || size < 1 || size > H5UpdateRules.indexMaxBytes
            || (expectSize >= 0 && size != expectSize) {
            return notOk
        }
        guard let start = head(index, count: H5UpdateRules.metaHeadBytes),
              H5UpdateRules.metaMatches(head: start, base: found.base, rev: found.rev) else {
            return notOk
        }
        return found.rev
    }

    /// previous/ 合格就改名顶成 current/（它以前报到过，不算「还没报到」）。顶上了返回 true。
    private static func promotePrevious(_ root: URL, shellBase: String, builtinRev: Int, state: inout H5State) -> Bool {
        let current = root.appendingPathComponent("current", isDirectory: true)
        let previous = root.appendingPathComponent("previous", isDirectory: true)
        let rev = qualify(previous, shellBase: shellBase, builtinRev: builtinRev, bad: state.bad, expectSize: -1)
        if rev < 0 || exists(current) || !move(previous, current) {
            remove(previous)
            return false
        }
        state.rev = rev
        state.size = fileSize(current.appendingPathComponent(H5UpdateRules.indexName))
        state.pending = -1
        state.boots = 0
        return true
    }

    /// 定加载哪一份（方案 6.2）。coldStart：进程刚起来（清空 staging/、给没报到的修订号记一次启动）；
    /// 同一个进程里重新加载页面时是 false。只读写 root（h5/）里的文件。
    public static func resolve(_ root: URL?, shellBase: String, builtinRev: Int, coldStart: Bool) -> H5Pick {
        let builtin = H5Pick(index: nil, rev: builtinRev, rolledBack: false)
        guard let root = root, H5UpdateRules.baseOk(shellBase) else {
            return builtin
        }
        let current = root.appendingPathComponent("current", isDirectory: true)
        let previous = root.appendingPathComponent("previous", isDirectory: true)
        if coldStart {
            remove(root.appendingPathComponent("staging", isDirectory: true))
        }
        if !isDirectory(root) {
            return builtin
        }
        // 上次切换到一半进程没了：current/ 不在而 previous/ 在，把 previous/ 改名回来。
        if !exists(current) && isDirectory(previous) {
            _ = move(previous, current)
        }
        if !exists(current) {
            remove(previous)
            return builtin
        }
        var state = readState(root)
        // 记下的大小只对记下的那个修订号有效（切换后还没来得及写 state.json 就没了的那一下不卡大小）。
        let seen = manifest(in: current)
        let expectSize = (seen != nil && seen?.rev == state.rev) ? state.size : -1
        let rev = qualify(current, shellBase: shellBase, builtinRev: builtinRev, bad: state.bad, expectSize: expectSize)
        if rev == otherBase {
            // 装了别的版本的安装包（升级、降级都算）：旧基座的热更新对它没有意义，整个清空，坏名单也一起。
            remove(root)
            return builtin
        }
        let index = current.appendingPathComponent(H5UpdateRules.indexName)
        if rev < 0 {
            remove(current)
            if promotePrevious(root, shellBase: shellBase, builtinRev: builtinRev, state: &state) {
                writeState(root, state)
                return H5Pick(index: index, rev: state.rev, rolledBack: false)
            }
            state.rev = -1
            state.size = -1
            state.pending = -1
            state.boots = 0
            writeState(root, state)
            return builtin
        }
        if state.rev != rev {
            // state.json 没跟上（切换完没写成）：按「刚切换、还没报到」补上。
            state.rev = rev
            state.size = fileSize(index)
            state.pending = rev
            state.boots = 0
            writeState(root, state)
        }
        if state.pending == rev && coldStart {
            if state.boots >= H5UpdateRules.unconfirmedBootsMax {
                // 这一份连着几次启动都没报到：退回。
                return rollback(root, shellBase: shellBase, builtinRev: builtinRev, rev: rev)
            }
            state.boots += 1
            writeState(root, state)
        }
        return H5Pick(index: index, rev: rev, rolledBack: false)
    }

    /// 把 rev 这一份记进坏名单并退回（方案 6.6）：删掉 current/，previous/ 合格就顶上，否则用内置的。
    /// 返回退回之后要加载的那一份（rolledBack 是 true）。
    public static func rollback(_ root: URL, shellBase: String, builtinRev: Int, rev: Int) -> H5Pick {
        var state = readState(root)
        if rev >= 0 && !state.bad.contains(rev) {
            state.bad.append(rev)
        }
        let current = root.appendingPathComponent("current", isDirectory: true)
        remove(current)
        remove(root.appendingPathComponent("staging", isDirectory: true))
        let pick: H5Pick
        if promotePrevious(root, shellBase: shellBase, builtinRev: builtinRev, state: &state) {
            pick = H5Pick(index: current.appendingPathComponent(H5UpdateRules.indexName), rev: state.rev, rolledBack: true)
        } else {
            state.rev = -1
            state.size = -1
            state.pending = -1
            state.boots = 0
            pick = H5Pick(index: nil, rev: builtinRev, rolledBack: true)
        }
        writeState(root, state)
        return pick
    }

    /// 切换（方案 6.4 第 5 步）：fresh（staging/new/，两个文件已经写好、核对过）改名成 current/。
    /// 原来的 current/ 报到过就留成 previous/（新的一份起不来时退回它）；原来的 current/ 自己都还没报到
    /// （下载完选了「下次生效」又下了更新的一份）就不留它，previous/ 里那份报到过的不动。
    /// 失败返回 false，current/ 还是原来的。
    public static func commit(_ root: URL, fresh: URL, rev: Int) -> Bool {
        let current = root.appendingPathComponent("current", isDirectory: true)
        let previous = root.appendingPathComponent("previous", isDirectory: true)
        let aside = fresh.deletingLastPathComponent().appendingPathComponent("old", isDirectory: true)
        var state = readState(root)
        let size = fileSize(fresh.appendingPathComponent(H5UpdateRules.indexName))
        var undo: URL?
        if exists(current) {
            if state.pending >= 0 && state.pending == state.rev {
                remove(aside)
                if exists(aside) || !move(current, aside) {
                    return false
                }
                undo = aside
            } else {
                remove(previous)
                if exists(previous) || !move(current, previous) {
                    return false
                }
                undo = previous
            }
        } else {
            remove(previous)
        }
        if exists(current) || !move(fresh, current) {
            if !exists(current), let back = undo {
                _ = move(back, current)
            }
            return false
        }
        remove(aside)
        state.rev = rev
        state.size = size
        state.pending = rev
        state.boots = 0
        writeState(root, state)
        return true
    }

    /// 新界面报到了（h5Ready）：清掉「还没报到」的标记和启动次数，删掉 previous/。
    public static func confirm(_ root: URL, rev: Int) {
        var state = readState(root)
        if state.pending != rev {
            return
        }
        state.pending = -1
        state.boots = 0
        if writeState(root, state) {
            remove(root.appendingPathComponent("previous", isDirectory: true))
        }
    }
}
