import EVCCore
import Foundation

/// App 自己的更新检查（AC-34）：页面的 `EVC.updCheck()` 落到这里。对应 Android 的 AppUpdater.check()。
///
/// 去读 OTA 文件站「Android APP/」文件夹的目录列表（8 秒超时），按 AppUpdateRules 找出版本最高的
/// APK，和装着的版本（CFBundleShortVersionString）比，把结果用一句 JavaScript 回给页面：
/// `window.__evcUpd.onCheck({...})`。iOS 只查不下载、不安装：有新版本时页面弹
/// 「有软件更新，请前往 App Store 更新」。明文 HTTP 靠 Info.plist 里对这一个地址的 ATS 例外。
///
/// `check` 由主线程调；回调也回到主线程。
final class AppUpdateCheck {
    private let run: (String) -> Void
    private var task: URLSessionDataTask?

    /// run：在主线程上把一句 JavaScript 交给页面执行。
    init(run: @escaping (String) -> Void) {
        self.run = run
    }

    func check() {
        if task != nil {
            // 上一次的结果马上就回，页面只等一个 onCheck。
            return
        }
        guard let url = URL(string: AppUpdateRules.listURL) else {
            run(AppUpdateRules.script(AppUpdateRules.failure("parse")))
            return
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = AppUpdateRules.timeout
        configuration.timeoutIntervalForResource = AppUpdateRules.timeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration)
        var request = URLRequest(url: url)
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let made = session.dataTask(with: request) { [weak self] data, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode
            let result = AppUpdateRules.evaluate(data: data, status: status, failed: error != nil, current: current)
            let script = AppUpdateRules.script(result)
            DispatchQueue.main.async {
                guard let self = self else {
                    return
                }
                self.task = nil
                self.run(script)
            }
        }
        task = made
        made.resume()
        // 这一个请求跑完就放掉会话。
        session.finishTasksAndInvalidate()
    }
}
