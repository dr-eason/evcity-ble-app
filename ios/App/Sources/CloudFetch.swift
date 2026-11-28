import EVCCore
import Foundation

/// 云端固件（AC-33）：页面的 `EVC.cloudGet(id, url, kind)` 落到这里。对应 Android 的 MainActivity.cloudFetch。
///
/// - 只请求 CloudRules.url 放行的地址（固件服务器 /files/ 下面），别的直接回 "blocked"。
/// - 不跟随重定向；10 秒内没收到响应头、或收数据中途停了 20 秒，算超时。
/// - 响应体边收边累计，超过 1 MB 就取消，回 "too large"。
/// - 结果：`window.__evcCloud.done(id, status, bodyBase64, error)`；进度：`window.__evcCloud.prog(id, done, total)`，
///   最多每 100 ms 一次。
///
/// 所有状态都只在主线程上动：`get` / `cancelAll` 由主线程调，URLSession 的回调队列也设成主队列。
final class CloudFetch: NSObject, URLSessionDataDelegate {
    /// 同时最多跑几个请求，其余排队（排队的时间不算进超时）。
    private static let maxRunning = 2
    private static let progInterval: TimeInterval = 0.1

    private final class Job {
        let id: String
        let url: URL
        var status = 0
        var total = 0
        var body = Data()
        var gotResponse = false
        var lastProg: TimeInterval = 0
        /// 自己取消时记下原因；有原因就按 status 0 回页面。
        var reason: String?
        var connectTimer: DispatchWorkItem?

        init(id: String, url: URL) {
            self.id = id
            self.url = url
        }
    }

    private let run: (String) -> Void
    private var session: URLSession?
    private var waiting: [Job] = []
    private var running: [Int: Job] = [:]

    /// run：在主线程上把一句 JavaScript 交给页面执行。
    init(run: @escaping (String) -> Void) {
        self.run = run
        super.init()
    }

    /// kind（"text" / "bin"）两种的处理和大小上限一样，这里用不到。
    func get(id: String, url text: String, kind: String) {
        guard let url = CloudRules.url(text) else {
            done(id: id, status: 0, base64: "", error: "blocked")
            return
        }
        waiting.append(Job(id: id, url: url))
        pump()
    }

    /// 页面要重新加载了：在跑的、在排队的都丢掉，不再回调。
    func cancelAll() {
        waiting.removeAll()
        let jobs = running
        running.removeAll()
        for job in jobs.values {
            job.connectTimer?.cancel()
        }
        // 连会话一起作废，在途的请求跟着取消；旧会话之后的回调按会话对不上被忽略。下次用时再建新的。
        session?.invalidateAndCancel()
        session = nil
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = CloudRules.readTimeout
        configuration.timeoutIntervalForResource = 300
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.waitsForConnectivity = false
        // URLSession 会一直强引用 delegate，直到 invalidate。这个对象跟着唯一的页面活到 App 退出，不用管。
        return URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue.main)
    }

    private func pump() {
        while running.count < Self.maxRunning && !waiting.isEmpty {
            let job = waiting.removeFirst()
            let active: URLSession
            if let existing = session {
                active = existing
            } else {
                active = makeSession()
                session = active
            }
            var request = URLRequest(url: job.url,
                                     cachePolicy: .reloadIgnoringLocalCacheData,
                                     timeoutInterval: CloudRules.readTimeout)
            request.httpMethod = "GET"
            // 不要压缩：这样 Content-Length 就是真实的字节数，进度才对得上。
            request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            let task = active.dataTask(with: request)
            running[task.taskIdentifier] = job

            let timer = DispatchWorkItem { [weak self, weak task, weak job] in
                guard let self = self, let task = task, let job = job else {
                    return
                }
                if self.running[task.taskIdentifier] === job && !job.gotResponse && job.reason == nil {
                    job.reason = "timeout"
                    task.cancel()
                }
            }
            job.connectTimer = timer
            DispatchQueue.main.asyncAfter(deadline: .now() + CloudRules.connectTimeout, execute: timer)
            task.resume()
        }
    }

    private func done(id: String, status: Int, base64: String, error: String) {
        run(CloudRules.doneScript(id: id, status: status, base64: base64, error: error))
    }

    private func prog(_ job: Job, force: Bool) {
        let now = ProcessInfo.processInfo.systemUptime
        if !force && now - job.lastProg < Self.progInterval {
            return
        }
        job.lastProg = now
        run(CloudRules.progScript(id: job.id, done: job.body.count, total: job.total))
    }

    // MARK: URLSession 回调（主队列）

    /// 不跟随重定向：把 3xx 那个响应原样当结果。
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard session === self.session, let job = running[dataTask.taskIdentifier], job.reason == nil else {
            completionHandler(.cancel)
            return
        }
        job.gotResponse = true
        job.connectTimer?.cancel()
        job.connectTimer = nil
        job.status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let expected = response.expectedContentLength
        job.total = expected > 0 ? Int(expected) : 0
        if job.status <= 0 {
            job.reason = "network"
            completionHandler(.cancel)
            return
        }
        if job.total > CloudRules.maxBytes {
            job.reason = "too large"
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard session === self.session, let job = running[dataTask.taskIdentifier], job.reason == nil else {
            return
        }
        if job.body.count + data.count > CloudRules.maxBytes {
            job.reason = "too large"
            job.body = Data()
            dataTask.cancel()
            return
        }
        job.body.append(data)
        prog(job, force: false)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // 作废掉的旧会话的回调不认：任务编号是每个会话各自从 1 编的，会和新会话的撞上。
        guard session === self.session, let job = running.removeValue(forKey: task.taskIdentifier) else {
            return
        }
        job.connectTimer?.cancel()
        job.connectTimer = nil
        if let reason = job.reason {
            done(id: job.id, status: 0, base64: "", error: reason)
        } else if let error = error {
            let timedOut = (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorTimedOut
            done(id: job.id, status: 0, base64: "", error: timedOut ? "timeout" : "network")
        } else if job.status <= 0 {
            done(id: job.id, status: 0, base64: "", error: "network")
        } else {
            prog(job, force: true)
            done(id: job.id, status: job.status, base64: job.body.base64EncodedString(), error: "")
        }
        pump()
    }
}
