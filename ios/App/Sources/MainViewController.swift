import EVCCore
import UIKit
import UniformTypeIdentifiers
import WebKit

/// 整个 App 就这一页：一个 WKWebView 装和 Android 同一份 Vue 界面，外加 window.EVC 桥。
/// 对应 Android 的 MainActivity（WebView 部分）。
final class MainViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler,
    UIGestureRecognizerDelegate, UIDocumentPickerDelegate {
    private static let handlerName = "evc"
    private static let gateKey = GateRules.storeName
    /// 后备文件选择器最多读这么大。界面自己的上限是 200 KB。
    private static let maxPickedBytes = 1024 * 1024

    private var web: WKWebView!
    private var pageReady = false
    private var pending: [String] = []
    private var backHandledAt: TimeInterval = 0
    private let mock = AppMode.mockBle
    private var link: BleLink?
    private var gate: [String: String] = [:]
    /// 一键配置导出时开着的那个导出窗口和临时文件（和固件升级的选文件窗口区分开）。
    private var exportPicker: UIDocumentPickerViewController?
    private var exportTemp: URL?
    /// 云端固件（AC-33）：EVC.cloudGet 的下载器，结果和进度是一句 JavaScript，走 run() 回页面。
    private lazy var cloud = CloudFetch { [weak self] script in
        self?.run(script)
    }

    /// App 更新检查（AC-34）：EVC.updCheck 的查询，结果是一句 JavaScript，走 run() 回页面。
    private lazy var appUpdate = AppUpdateCheck { [weak self] script in
        self?.run(script)
    }

    /// 界面热更新（H5Updater.swift）。编译期开关 EVCH5HotUpdate 关着、或者 Mock 模式时是 nil：不看
    /// Application Support 的 h5/，只加载包里的 Web/index.html，不把热更新的值写进页面（evc-shim.js 就不挂
    /// h5* 那几个方法），收到 h5* 调用一律不理。
    private lazy var h5: H5Updater? = makeH5()
    /// 进程起来之后还没加载过页面（第一次加载要清 staging/、给没报到的修订号记一次启动）。
    private var h5Cold = true
    /// 现在这一页是这次运行里重新加载出来的（热更新后、退回后） / 是退回之后加载的。写进 __evcInit.h5。
    private var h5Reloaded = false
    private var h5RolledBack = false
    /// 加载了还没报到过的热更新界面，在等 h5Ready() 的 10 秒计时；只在前台计。
    private var h5Timer: DispatchWorkItem?
    private var h5Waiting = false
    /// 现在这个 WKWebView 被允许读的目录（包里的 Web/ 或 h5/current/）。换了目录就重建 WKWebView。
    private var readRoot: URL?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        gate = (UserDefaults.standard.dictionary(forKey: Self.gateKey) as? [String: String]) ?? [:]

        installWeb()
        // 界面热更新的 10 秒报到只在前台计：切到后台就停，回来重新数。
        NotificationCenter.default.addObserver(self, selector: #selector(onBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(onResignActive),
                                               name: UIApplication.willResignActiveNotification, object: nil)

        // 从屏幕左边往里滑 = Android 的返回键 / 侧滑返回。
        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(onEdgePan(_:)))
        edge.edges = .left
        edge.delegate = self
        view.addGestureRecognizer(edge)

        if !mock {
            let made = BleLink()
            made.onEvent = { [weak self] event in
                self?.emit(event)
            }
            made.onMtu = { [weak self] value in
                self?.run("window.__evcNative&&window.__evcNative.setMtu(\(value))")
            }
            link = made
        }
        loadPage()
    }

    // MARK: 页面

    /// 建 WKWebView 并放进安全区。启动时建一次；界面热更新让页面从包里的 Web/ 换到 h5/current/（或换回来）时
    /// 重建一个：WKWebView 的本地文件读权限是按目录给的，同一个 WKWebView 上换目录在个别系统版本上有过问题。
    private func installWeb() {
        if let old = web {
            old.navigationDelegate = nil
            old.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName)
            old.removeFromSuperview()
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakHandler(self), name: Self.handlerName)
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        // 页面不处理刘海和底部横条，所以把 WebView 放在安全区里，四周露出黑底。
        // Android 那边是给外层加 padding（padForSystemBars），效果一样。
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: safe.topAnchor),
            web.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
        ])
    }

    private func makeH5() -> H5Updater? {
        if !AppMode.h5HotUpdate || mock {
            return nil
        }
        return H5Updater { [weak self] script in
            self?.run(script)
        }
    }

    private func resource(_ name: String, _ ext: String, in folder: String) -> URL? {
        return Bundle.main.url(forResource: name, withExtension: ext, subdirectory: folder)
    }

    private func text(_ name: String, _ ext: String, in folder: String) -> String {
        guard let url = resource(name, ext, in: folder), let text = try? String(contentsOf: url, encoding: .utf8) else {
            return ""
        }
        return text
    }

    /// 页面开始加载前注入的脚本：初始数据 + evc-shim.js（+ Mock 模式的 mock-evc.js）。
    private func bootScript() -> String {
        let info = Bundle.main.infoDictionary
        let initScript = ShimInit(locale: Locale.preferredLanguages.first ?? "",
                                  gate: gate,
                                  mock: mock,
                                  nativeFilePicker: AppMode.nativeFilePicker,
                                  appVersion: info?["CFBundleShortVersionString"] as? String ?? "",
                                  appBuild: info?["CFBundleVersion"] as? String ?? "").script
        var source = initScript
        // 界面热更新开着：把屏幕上这一页是第几版、从哪里来的写进 __evcInit.h5（EVC.h5Info() 同步返回它）。
        // 关着就不写，evc-shim.js 不挂 h5* 那几个方法。
        if let h5 = h5 {
            source += H5ShimInit(rev: h5.loadedRev, hot: h5.loadedHot, reloaded: h5Reloaded,
                                 rolledBack: h5RolledBack).script
        }
        source += text("evc-shim", "js", in: "Bridge")
        if mock {
            source += "\n" + text("mock-evc", "js", in: "Bridge")
        }
        return source
    }

    private func loadPage() {
        pageReady = false
        stopH5Timer()
        h5Waiting = false
        // 加载哪一份：Application Support 的 h5/current/ 里有合格的热更新界面就加载它（只给这一个目录读权限），
        // 否则加载包里的 Web/index.html。界面热更新关着（h5 == nil）时只看包里的。
        var page = resource("index", "html", in: "Web")
        if let h5 = h5 {
            let pick = h5.pick(coldStart: h5Cold)
            h5Cold = false
            if pick.rolledBack {
                h5RolledBack = true
            }
            if let hot = pick.index {
                page = hot
            }
        }
        let root = page?.deletingLastPathComponent()
        if readRoot != nil && root != readRoot {
            installWeb()
        }
        readRoot = root
        let controller = web.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: bootScript(),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        if let index = page {
            web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
            if let h5 = h5, h5.awaitingReady {
                h5Waiting = true
                startH5Timer()
            }
        } else {
            // 没跑 build_ui.sh 就编了 App。
            web.loadHTMLString("""
                <html><body style="background:#000;color:#fff;font:16px sans-serif;padding:24px">
                <p>界面文件没有打进来。</p><p>先运行 build_ui.sh，再重新编译。</p>
                </body></html>
                """, baseURL: nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let list = pending
        pending.removeAll()
        for script in list {
            web.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// 页面进程被系统回收（内存紧张时会有）：界面状态已经没了，按重启处理。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // 这一次重新加载不是热更新造成的，也不算新界面报到失败（10 秒从头数）。
        h5Reloaded = false
        h5RolledBack = false
        restart()
    }

    // MARK: 界面热更新的 10 秒报到

    private func startH5Timer() {
        stopH5Timer()
        if UIApplication.shared.applicationState != .active {
            return      // 回到前台时 onBecomeActive 再开始数
        }
        let timer = DispatchWorkItem { [weak self] in
            self?.h5ReadyTimedOut()
        }
        h5Timer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + H5UpdateRules.readyTimeout, execute: timer)
    }

    private func stopH5Timer() {
        h5Timer?.cancel()
        h5Timer = nil
    }

    @objc private func onBecomeActive() {
        if h5Waiting {
            startH5Timer()
        }
    }

    @objc private func onResignActive() {
        stopH5Timer()
    }

    /// 在前台等了 10 秒新界面还没报到：记进坏名单，退回上一份（没有就用包里的），重新加载。
    private func h5ReadyTimedOut() {
        h5Timer = nil
        guard h5Waiting, let h5 = h5 else {
            return
        }
        h5Waiting = false
        if h5.rollbackLoaded() == nil {
            return
        }
        h5Reloaded = true
        h5RolledBack = true
        restart()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if url.isFileURL {
            // 只放行包里的界面文件，和界面热更新的那一个文件：解析掉符号链接之后路径正好是
            // <Application Support>/h5/current/index.html（H5Updater.isCurrentIndex）。别的沙盒文件一律不放。
            let path = url.resolvingSymlinksInPath().path
            let inside = path.hasPrefix(Bundle.main.bundleURL.resolvingSymlinksInPath().path)
                || path.hasSuffix("/Web/index.html")
                || (h5?.isCurrentIndex(url) ?? false)
            decisionHandler(inside ? .allow : .cancel)
            return
        }
        if scheme == "mailto" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    // MARK: 原生 → 页面

    private func emit(_ event: BridgeEvent) {
        if case .page(let name) = event, name == "scan" {
            // 回到扫描页说明连接没了，升级期间关掉的自动锁屏要恢复。
            UIApplication.shared.isIdleTimerDisabled = false
        }
        run(event.script)
    }

    private func run(_ script: String) {
        if !pageReady {
            pending.append(script)
            return
        }
        web.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: 页面 → 原生

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        // App 更新检查（AC-34）：EVC.updCheck()。不进 BridgeCall，直接交给 AppUpdateCheck。
        if message.name == Self.handlerName, AppUpdateRules.isCheckCall(message.body) {
            appUpdate.check()
            return
        }
        guard message.name == Self.handlerName, let call = BridgeCall.parse(message.body) else {
            return
        }
        switch call {
        case .scan:
            link?.toggleScan()
        case .stopScan:
            link?.stopScan()
        case .connect(let address):
            link?.connect(address)
        case .disconnect:
            link?.disconnect()
        case .send(let command):
            link?.send(command)
        case .saveGate(let address, let pin):
            GateRules.apply(&gate, address: address, pin: pin)
            UserDefaults.standard.set(gate, forKey: Self.gateKey)
        case .linkFast(let on):
            // 发固件的几分钟里不让屏幕自动锁：锁屏后 App 被挂起，心跳一停桩就当手机走了。
            UIApplication.shared.isIdleTimerDisabled = on
            link?.setLinkFast(on)
        case .heartbeatTime(let on):
            link?.setHeartbeatTime(on)
        case .restart:
            h5Reloaded = false
            h5RolledBack = false
            restart()
        case .pickFile:
            pickFile()
        case .exportFile(let name, let text):
            exportFile(name: name, text: text)
        case .setProfile(let which):
            link?.setProfile(which)
        case .cloudGet(let id, let url, let kind):
            cloud.get(id: id, url: url, kind: kind)
        // 界面热更新（H5Updater.swift）。开关关着时 h5 是 nil，这几种调用一律不理。
        case .h5Check:
            h5?.check()
        case .h5Download(let file):
            h5?.download(file)
        case .h5Cancel:
            h5?.cancel()
        case .h5Ready:
            h5Waiting = false
            stopH5Timer()
            h5?.ready()
        case .h5Apply:
            // 重新加载页面，换成磁盘上已经切换好的那一份。和 restart() 一样收拾（停扫、断开蓝牙、丢掉没送出去
            // 的事件），再由 loadPage() 重新选一次加载哪一份。
            guard h5 != nil else {
                return
            }
            h5Reloaded = true
            h5RolledBack = false
            restart()
        }
    }

    /// Android 的 restart() 是杀进程再拉起来。iOS 不能自己重启，等价的做法：
    /// 停扫、断开蓝牙、丢掉没送出去的事件、把页面重新加载一遍（页面一加载就会回到扫描页并开始扫）。
    private func restart() {
        link?.shutdown()
        cloud.cancelAll()
        h5?.cancel()
        UIApplication.shared.isIdleTimerDisabled = false
        pending.removeAll()
        loadPage()
    }

    // MARK: 返回手势

    @objc private func onEdgePan(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        guard recognizer.state == .ended, recognizer.translation(in: view).x > 40 else {
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if now - backHandledAt < 0.25 || !pageReady {
            return
        }
        backHandledAt = now
        // 二级及更深的页面由页面自己回上一级；连着充电桩的首页（立即充电）由页面断开蓝牙、回扫描列表。
        // 只有停在扫描列表上返回 false：Android 这时退出到桌面，iOS 的 App 不自己退出，所以什么也不做。
        web.evaluateJavaScript(
            "(function(){try{return !!(window.evcTryBack&&window.evcTryBack());}catch(e){return false;}})()",
            completionHandler: nil)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        return true
    }

    // MARK: 后备的文件选择（EVCNativeFilePicker 打开时才用）

    private func pickFile() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true, completion: nil)
    }

    // MARK: 一键配置导出（2.8.0）

    /// 先写进 App 自己的临时目录，再用「文件」App 的导出窗口让用户选位置（相当于 Android 的
    /// ACTION_CREATE_DOCUMENT）。asCopy：拷一份过去，临时文件导出后删掉。
    private func exportFile(name: String, text: String) {
        if exportPicker != nil {
            emit(.export(ok: false, reason: "fail"))
            return
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("export", isDirectory: true)
        let url = folder.appendingPathComponent(name)
        do {
            try? FileManager.default.removeItem(at: folder)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            emit(.export(ok: false, reason: "fail"))
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        exportPicker = picker
        exportTemp = url
        present(picker, animated: true, completion: nil)
    }

    private func finishExport(ok: Bool, reason: String) {
        exportPicker = nil
        if let url = exportTemp {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        exportTemp = nil
        emit(.export(ok: ok, reason: reason))
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if controller === exportPicker {
            finishExport(ok: !urls.isEmpty, reason: urls.isEmpty ? "fail" : "")
            return
        }
        guard let url = urls.first,
              let data = try? Data(contentsOf: url),
              data.count <= Self.maxPickedBytes else {
            run("window.__evcNative&&window.__evcNative.filePicked(null,null)")
            return
        }
        let arguments = JSONText.encode([url.lastPathComponent, data.base64EncodedString()])
        run("window.__evcNative&&window.__evcNative.filePicked.apply(null," + arguments + ")")
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if controller === exportPicker {
            finishExport(ok: false, reason: "cancel")
            return
        }
        run("window.__evcNative&&window.__evcNative.filePicked(null,null)")
    }
}

/// WKUserContentController 会强引用消息处理对象，隔一层免得和控制器互相引用。
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
