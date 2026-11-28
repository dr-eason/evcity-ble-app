import Compression
import CryptoKit
import EVCCore
import Foundation

/// 界面热更新（H5 热更新）：页面的 `EVC.h5Check()` / `h5Download(file)` / `h5Cancel()` / `h5Ready()` 落到这里，
/// `h5Apply()` 由 MainViewController 重新加载页面。对应 Android 的 H5Updater.java；规则（文件名、latest.json、
/// zip 的目录、h5/ 目录里选哪一份、切换、报到、退回）在 EVCCore 的 H5UpdateRules / H5Zip / H5Store。
///
/// - 存在 Application Support 的 `h5/` 里（不参加备份），不放缓存目录。
/// - 查询：先 GET `…/Android%20APP/V<App 版本>/latest.json`，合格就用它；404 / 内容不合格再读目录列表做后备，
///   并取那个包的 `.zip.sha256`；连不上、别的状态码算没查成。每个地址先过 `CloudRules.url`，不跟随重定向，
///   单个请求超时 8 秒。除了这几样不读服务器上别的文件。
/// - 下载到 `h5/staging/<包名>.part`（`Accept-Encoding: identity`，上限 8 MB），边下边算 SHA-256，和查到的
///   SHA-256、大小核对后才解压。只核 SHA-256，不验签名。
/// - 解压：只认 zip 里正好两个条目 index.html、manifest.json（H5Zip），deflate 用系统的 Compression；
///   写到 `staging/new/` 下固定的两个文件名，核对 manifest.json 和 index.html 开头的标记，再改名切换：
///   previous ← current ← staging/new。任何一步失败都不碰 current/。
/// - 结果回页面：`window.__evcH5.onCheck / onProgress / onDone / onError`。
///
/// 明文 HTTP 靠 Info.plist 里对 ftp.evcity.cc 这一个地址的 ATS 例外，这里不扩大。
/// 所有状态都只在主线程上动：方法由主线程调，URLSession 的回调队列也设成主队列。
final class H5Updater: NSObject, URLSessionDataDelegate {
    private static let progressInterval: TimeInterval = 0.1

    private let run: (String) -> Void
    /// 壳的 App 版本原文（CFBundleShortVersionString），例如 "3.04"。
    let shellBase: String
    /// 安装包内置的那份界面的修订号（Web/manifest.json），按约定是 0。
    let builtinRev: Int
    /// Application Support 的 h5/。建不出来是 nil：没有热更新，只用内置的界面。
    private let root: URL?

    /// 现在屏幕上这一页的修订号、是不是热更新出来的。
    private(set) var loadedRev: Int
    private(set) var loadedHot = false
    /// h5/current/ 里那一份的修订号；没有是 -1。
    private var diskRev = -1
    /// 最近一次查到的、可以下载的包。h5Download 只收它的名字。
    private var known: H5Latest?
    private var checking = false

    private var session: URLSession?
    /// 正在下载的那一个任务和它的状态。
    private var task: URLSessionDataTask?
    private var target: H5Latest?
    private var part: URL?
    private var handle: FileHandle?
    private var hasher = SHA256()
    private var received = 0
    private var total = 0
    private var failed: String?
    private var lastProgress: TimeInterval = 0
    private var lastPercent = -1

    /// run：在主线程上把一句 JavaScript 交给页面执行。
    init(run: @escaping (String) -> Void) {
        self.run = run
        let base = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        shellBase = base
        var rev = 0
        if let url = Bundle.main.url(forResource: "manifest", withExtension: "json", subdirectory: "Web"),
           let data = try? Data(contentsOf: url), data.count <= H5UpdateRules.manifestMaxBytes,
           let text = String(data: data, encoding: .utf8),
           let manifest = H5UpdateRules.parseManifest(text), manifest.base == base {
            rev = manifest.rev
        }
        builtinRev = rev
        loadedRev = rev
        root = H5Updater.makeRoot()
        super.init()
    }

    private static func makeRoot() -> URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        var folder = support.appendingPathComponent("h5", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        // 不参加 iCloud / 本机备份：换手机后界面跟着安装包走。
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        return folder
    }

    // MARK: 加载哪一份、报到、退回

    private func remember(_ pick: H5Pick) -> H5Pick {
        loadedRev = pick.rev
        loadedHot = pick.hot
        diskRev = pick.hot ? pick.rev : -1
        return pick
    }

    /// 定这一次加载哪一份，并记下屏幕上将是哪一份。coldStart：进程刚起来的第一次加载。
    func pick(coldStart: Bool) -> H5Pick {
        return remember(H5Store.resolve(root, shellBase: shellBase, builtinRev: builtinRev, coldStart: coldStart))
    }

    /// 屏幕上这一页是热更新出来的、并且还没报到过：要等 h5Ready()。
    var awaitingReady: Bool {
        guard loadedHot, let root = root else {
            return false
        }
        return H5Store.readState(root).pending == loadedRev
    }

    /// 页面报到了。内置的界面也会报到，不理会。
    func ready() {
        guard loadedHot, let root = root else {
            return
        }
        H5Store.confirm(root, rev: loadedRev)
    }

    /// 屏幕上这一份 10 秒没报到：记进坏名单、退回。返回退回之后要加载的那一份；屏幕上不是热更新的界面时 nil。
    func rollbackLoaded() -> H5Pick? {
        guard loadedHot, let root = root else {
            return nil
        }
        cancel()
        return remember(H5Store.rollback(root, shellBase: shellBase, builtinRev: builtinRev, rev: loadedRev))
    }

    /// 页面跳转的放行：解析掉符号链接之后正好是 h5/current/index.html 这一个文件。
    func isCurrentIndex(_ url: URL) -> Bool {
        guard url.isFileURL, let root = root else {
            return false
        }
        let index = root.appendingPathComponent("current", isDirectory: true)
            .appendingPathComponent(H5UpdateRules.indexName)
        return url.resolvingSymlinksInPath().path == index.resolvingSymlinksInPath().path
    }

    private func send(_ name: String, _ arguments: [Any]) {
        run(H5UpdateRules.script(name, arguments))
    }

    // MARK: 联网

    private func activeSession() -> URLSession {
        if let existing = session {
            return existing
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = H5UpdateRules.timeout
        configuration.timeoutIntervalForResource = 300
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.waitsForConnectivity = false
        // URLSession 会一直强引用 delegate，直到 invalidate。这个对象跟着唯一的页面活到 App 退出，不用管。
        let made = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue.main)
        session = made
        return made
    }

    /// 不跟随重定向：把 3xx 那个响应原样当结果（查询里按「别的状态码」算没查成）。
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    /// GET 一个小文件。地址先过 CloudRules.url。done(状态码, 内容)：连不上时状态码是 nil；超过 limit 时内容是 nil。
    private func get(_ address: String, limit: Int, done: @escaping (Int?, Data?) -> Void) {
        guard let url = CloudRules.url(address) else {
            done(nil, nil)
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: H5UpdateRules.timeout)
        request.httpMethod = "GET"
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let made = activeSession().dataTask(with: request) { data, response, error in
            let status = error == nil ? (response as? HTTPURLResponse)?.statusCode : nil
            let body = (data != nil && data!.count <= limit) ? data : nil
            DispatchQueue.main.async {
                done(status, body)
            }
        }
        made.resume()
    }

    // MARK: 查询

    func check() {
        if checking {
            // 上一次的结果马上就回，页面只等一个 onCheck。
            return
        }
        guard let folder = H5UpdateRules.folderURL(shellBase), root != nil else {
            send("onCheck", [H5UpdateRules.failure("parse")])
            return
        }
        checking = true
        let base = shellBase
        let applied = max(loadedRev, diskRev)
        // 1. latest.json：合格就用它。404 / 410、内容不合格才走后备；别的状态码是没查成。
        get(folder + H5UpdateRules.latestName, limit: H5UpdateRules.latestMaxBytes) { [weak self] status, data in
            guard let self = self else {
                return
            }
            guard let status = status else {
                self.finishCheck(failure: "offline")
                return
            }
            if status == 200, let data = data, let text = String(data: data, encoding: .utf8),
               let latest = H5UpdateRules.parseLatest(text, shellBase: base) {
                self.finishCheck(found: latest)
                return
            }
            if status != 200 && status != 404 && status != 410 {
                self.finishCheck(failure: "http")
                return
            }
            // 2. 后备：目录列表。404 / 410 是这个基座还没有版本文件夹，等于没有热更新。
            self.get(folder, limit: H5UpdateRules.listMaxBytes) { [weak self] status, data in
                guard let self = self else {
                    return
                }
                guard let status = status else {
                    self.finishCheck(failure: "offline")
                    return
                }
                if status == 404 || status == 410 {
                    self.finishCheck(found: nil)
                    return
                }
                if status != 200 {
                    self.finishCheck(failure: "http")
                    return
                }
                guard let data = data, let html = String(data: data, encoding: .utf8),
                      let names = H5UpdateRules.parseListing(html) else {
                    self.finishCheck(failure: "parse")
                    return
                }
                guard let best = H5UpdateRules.latestName(names, shellBase: base),
                      let name = H5UpdateRules.parseName(best) else {
                    self.finishCheck(found: nil)
                    return
                }
                if name.rev <= applied {
                    self.finishCheck(found: H5Latest(base: base, rev: name.rev, file: best, sha256: "", size: 0))
                    return
                }
                // 没有校验值的包不装。
                self.get(folder + best + ".sha256", limit: H5UpdateRules.shaMaxBytes) { [weak self] status, data in
                    guard let self = self else {
                        return
                    }
                    guard let status = status else {
                        self.finishCheck(failure: "offline")
                        return
                    }
                    guard status == 200, let data = data, let text = String(data: data, encoding: .utf8),
                          let sha = H5UpdateRules.parseShaLine(text, file: best) else {
                        self.finishCheck(failure: "parse")
                        return
                    }
                    self.finishCheck(found: H5Latest(base: base, rev: name.rev, file: best, sha256: sha, size: 0))
                }
            }
        }
    }

    private func finishCheck(failure reason: String) {
        checking = false
        send("onCheck", [H5UpdateRules.failure(reason)])
    }

    private func finishCheck(found candidate: H5Latest?) {
        checking = false
        var found = candidate
        // 3. 坏名单里的修订号：当作没有热更新。
        if let item = found, let root = root, H5Store.readState(root).bad.contains(item.rev) {
            found = nil
        }
        let applied = max(loadedRev, diskRev)
        let hasNew = found != nil && found!.rev > applied && found!.sha256.utf8.count == 64
        known = hasNew ? found : nil
        send("onCheck", [H5UpdateRules.checkResult(base: shellBase, found: found, current: loadedRev,
                                                   staged: diskRev > loadedRev ? diskRev : -1, hasNew: hasNew)])
    }

    // MARK: 下载、核对、解压、切换

    func download(_ file: String) {
        guard let wanted = known, wanted.file == file, H5UpdateRules.parseName(file) != nil else {
            send("onError", ["badfile"])
            return
        }
        if task != nil {
            send("onError", ["busy"])
            return
        }
        guard let root = root else {
            send("onError", ["storage"])
            return
        }
        // 地址由这里拼（版本文件夹 + 查到的文件名），再过一遍 CloudRules.url。
        guard let folder = H5UpdateRules.folderURL(shellBase), let url = CloudRules.url(folder + file) else {
            send("onError", ["badfile"])
            return
        }
        let staging = root.appendingPathComponent("staging", isDirectory: true)
        H5Store.remove(staging)
        let fresh = staging.appendingPathComponent("new", isDirectory: true)
        let partURL = staging.appendingPathComponent(file + ".part")
        do {
            try FileManager.default.createDirectory(at: fresh, withIntermediateDirectories: true)
        } catch {
            send("onError", ["storage"])
            return
        }
        guard FileManager.default.createFile(atPath: partURL.path, contents: nil),
              let writer = try? FileHandle(forWritingTo: partURL) else {
            H5Store.remove(staging)
            send("onError", ["storage"])
            return
        }
        target = wanted
        part = partURL
        handle = writer
        hasher = SHA256()
        received = 0
        total = 0
        failed = nil
        lastProgress = 0
        lastPercent = -1
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: H5UpdateRules.downloadTimeout)
        request.httpMethod = "GET"
        // 不要压缩：这样 Content-Length 就是真实的字节数，进度和大小核对才对得上。
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let made = activeSession().dataTask(with: request)
        task = made
        made.resume()
    }

    /// 取消下载：不再回调，删掉 .part。
    func cancel() {
        let running = task
        cleanup()
        running?.cancel()
    }

    /// 收掉这一次下载的状态，清空 staging/（成功时 new/ 已经改名走了，这里只剩 .part）。
    private func cleanup() {
        task = nil
        target = nil
        part = nil
        if let writer = handle {
            try? writer.close()
        }
        handle = nil
        failed = nil
        if let root = root {
            H5Store.remove(root.appendingPathComponent("staging", isDirectory: true))
        }
    }

    private func fail(_ reason: String) {
        cleanup()
        send("onError", [reason])
    }

    private func progress(_ percent: Int, force: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        if !force && percent == lastPercent && now - lastProgress < Self.progressInterval {
            return
        }
        lastProgress = now
        lastPercent = percent
        send("onProgress", [percent, received, total])
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard dataTask === task, let wanted = target else {
            completionHandler(.cancel)
            return
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status != 200 {
            failed = "http"
            completionHandler(.cancel)
            return
        }
        let expected = Int(response.expectedContentLength)
        if expected > H5UpdateRules.zipMaxBytes || (expected >= 0 && wanted.size > 0 && expected != wanted.size) {
            failed = "size"
            completionHandler(.cancel)
            return
        }
        total = expected > 0 ? expected : wanted.size
        progress(0, force: true)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard dataTask === task, failed == nil, let writer = handle else {
            return
        }
        received += data.count
        if received > H5UpdateRules.zipMaxBytes || (total > 0 && received > total) {
            failed = "size"
            dataTask.cancel()
            return
        }
        hasher.update(data: data)
        do {
            try writer.write(contentsOf: data)
        } catch {
            failed = "storage"
            dataTask.cancel()
            return
        }
        // 100% 留到下完再报：页面看到 100 就进「正在校验并解压」。
        progress(total > 0 ? min(99, received * 100 / total) : 0, force: false)
    }

    func urlSession(_ session: URLSession, task finished: URLSessionTask, didCompleteWithError error: Error?) {
        // 取消掉的、查询用的任务不认。
        guard finished === task else {
            return
        }
        if let reason = failed {
            fail(reason)
            return
        }
        if error != nil {
            fail("offline")
            return
        }
        guard let wanted = target, let partURL = part, let root = root else {
            fail("storage")
            return
        }
        if let writer = handle {
            try? writer.close()
        }
        handle = nil
        // 核对：字节数、SHA-256。对了才解压。
        if received == 0 || (wanted.size > 0 && received != wanted.size) || (total > 0 && received != total) {
            fail("size")
            return
        }
        if H5UpdateRules.hex(Array(hasher.finalize())) != wanted.sha256 {
            fail("sha")
            return
        }
        progress(100, force: true)
        let fresh = root.appendingPathComponent("staging", isDirectory: true)
            .appendingPathComponent("new", isDirectory: true)
        if let reason = unpack(partURL, into: fresh, rev: wanted.rev) {
            fail(reason)
            return
        }
        // 修订号只往上走：必须比屏幕上的、也比磁盘上已经切换好的都大。
        if wanted.rev <= max(loadedRev, diskRev) {
            fail("rev")
            return
        }
        // 切换：previous ← current ← staging/new。
        if !H5Store.commit(root, fresh: fresh, rev: wanted.rev) {
            fail("storage")
            return
        }
        diskRev = wanted.rev
        known = nil
        cleanup()
        send("onDone", [wanted.rev])
    }

    /// 解压热更新包到 fresh（staging/new/）。只认正好两个条目 index.html、manifest.json；写到哪里由这里定
    /// （fresh 下固定的两个文件名），不拿包里的名字拼路径；解出来的长度和 CRC-32 要对得上，不信包头里写的大小
    /// （输出缓冲只比写着的大小多 1 字节，多了就不认）。解完核对 manifest.json（kind、基座等于壳的 App 版本、
    /// 修订号等于文件名里的）和 index.html 开头的标记。成功返回 nil；失败返回原因 "zip" / "base" / "rev"。
    private func unpack(_ zip: URL, into fresh: URL, rev: Int) -> String? {
        guard let data = try? Data(contentsOf: zip), data.count <= H5UpdateRules.zipMaxBytes else {
            return "zip"
        }
        let bytes = [UInt8](data)
        guard let entries = H5Zip.entries(bytes) else {
            return "zip"
        }
        var index: [UInt8]?
        var manifest: [UInt8]?
        for entry in entries {
            let packed = H5Zip.packed(entry, in: bytes)
            let content: [UInt8]?
            if entry.method == 0 {
                content = packed
            } else {
                content = H5Updater.inflate(packed, size: entry.size)
            }
            guard let plain = content, H5Zip.verify(entry, content: plain) else {
                return "zip"
            }
            if entry.name == H5UpdateRules.indexName {
                index = plain
            } else if entry.name == H5UpdateRules.manifestName {
                manifest = plain
            } else {
                return "zip"
            }
        }
        guard let page = index, let info = manifest,
              let found = H5UpdateRules.parseManifest(String(decoding: info, as: UTF8.self)) else {
            return "zip"
        }
        if found.base != shellBase {
            return "base"
        }
        if found.rev != rev {
            return "rev"
        }
        if !H5UpdateRules.metaMatches(head: Data(page.prefix(H5UpdateRules.metaHeadBytes)), base: found.base, rev: found.rev) {
            return "zip"
        }
        do {
            try Data(page).write(to: fresh.appendingPathComponent(H5UpdateRules.indexName), options: .atomic)
            try Data(info).write(to: fresh.appendingPathComponent(H5UpdateRules.manifestName), options: .atomic)
        } catch {
            return "zip"
        }
        return nil
    }

    /// 解 zip 里的 deflate（没有 zlib 头的原始 deflate，对应 Compression 的 COMPRESSION_ZLIB）。
    /// 解出来不是正好 size 字节就不认。
    private static func inflate(_ packed: [UInt8], size: Int) -> [UInt8]? {
        if packed.isEmpty || size < 1 || size > H5UpdateRules.indexMaxBytes {
            return nil
        }
        var output = [UInt8](repeating: 0, count: size + 1)
        let capacity = output.count
        let written = output.withUnsafeMutableBufferPointer { destination -> Int in
            packed.withUnsafeBufferPointer { source -> Int in
                guard let to = destination.baseAddress, let from = source.baseAddress else {
                    return 0
                }
                return compression_decode_buffer(to, capacity, from, source.count, nil, COMPRESSION_ZLIB)
            }
        }
        if written != size {
            return nil
        }
        output.removeLast()
        return output
    }
}
