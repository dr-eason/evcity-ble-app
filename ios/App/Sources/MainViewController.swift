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

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        gate = (UserDefaults.standard.dictionary(forKey: Self.gateKey) as? [String: String]) ?? [:]

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
        var source = initScript + text("evc-shim", "js", in: "Bridge")
        if mock {
            source += "\n" + text("mock-evc", "js", in: "Bridge")
        }
        return source
    }

    private func loadPage() {
        pageReady = false
        let controller = web.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: bootScript(),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        if let index = resource("index", "html", in: "Web") {
            web.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
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
            // 只放行包里的界面文件。
            let path = url.resolvingSymlinksInPath().path
            let inside = path.hasPrefix(Bundle.main.bundleURL.resolvingSymlinksInPath().path)
                || path.hasSuffix("/Web/index.html")
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
            restart()
        case .pickFile:
            pickFile()
        case .exportFile(let name, let text):
            exportFile(name: name, text: text)
        }
    }

    /// Android 的 restart() 是杀进程再拉起来。iOS 不能自己重启，等价的做法：
    /// 停扫、断开蓝牙、丢掉没送出去的事件、把页面重新加载一遍（页面一加载就会回到扫描页并开始扫）。
    private func restart() {
        link?.shutdown()
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
        // 二级及更深的页面由页面自己回上一级。扫描页、充电页返回 false：Android 这时退出到桌面，
        // iOS 的 App 不自己退出，所以什么也不做。
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
