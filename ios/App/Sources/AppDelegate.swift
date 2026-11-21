import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else {
            return
        }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = .black
        window.rootViewController = MainViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

enum AppMode {
    /// Mock BLE：蓝牙调用不去 CoreBluetooth，由页面里的假充电桩（mock-evc.js）应答。
    /// - 模拟器：总是 Mock（模拟器没有真蓝牙）。
    /// - 编译时带 EVC_MOCK_BLE=1：总是 Mock，真机上也是。
    /// - Debug 版在 Xcode 的 Scheme 里设环境变量 EVC_MOCK_BLE=1：Mock。
    /// - 其余（真机发布版）：真蓝牙。
    static var mockBle: Bool {
        #if EVC_MOCK_BLE
        return true
        #elseif targetEnvironment(simulator)
        return true
        #elseif DEBUG
        return ProcessInfo.processInfo.environment["EVC_MOCK_BLE"] == "1"
        #else
        return false
        #endif
    }

    /// Info.plist 的 EVCNativeFilePicker。打开后固件升级选文件不用 WKWebView 自带的菜单，
    /// 直接开「文件」选择器。
    static var nativeFilePicker: Bool {
        let value = Bundle.main.object(forInfoDictionaryKey: "EVCNativeFilePicker")
        if let flag = value as? Bool {
            return flag
        }
        if let text = value as? String {
            return ["YES", "TRUE", "1"].contains(text.uppercased())
        }
        return false
    }
}
