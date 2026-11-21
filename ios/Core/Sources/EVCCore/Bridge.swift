import Foundation

/// 扫描到的一台桩。iOS 拿不到蓝牙 MAC，`addr` 是系统给这台外设的 UUID 字符串。
public struct BridgeDevice: Equatable {
    public var name: String
    public var addr: String
    public var rssi: Int

    public init(name: String, addr: String, rssi: Int) {
        self.name = name
        self.addr = addr
        self.rssi = rssi
    }
}

/// 原生发给页面的事件，页面里统一由 `onBle(obj)` 接。和 Android 的五种一样。
public enum BridgeEvent: Equatable {
    case note(String)
    case page(String)
    case scan(Bool)
    case line(String)
    case devs([BridgeDevice])

    public var object: [String: Any] {
        switch self {
        case .note(let text):
            return ["t": "note", "s": text]
        case .page(let name):
            return ["t": "page", "s": name]
        case .scan(let on):
            return ["t": "scan", "on": on]
        case .line(let text):
            return ["t": "line", "s": text]
        case .devs(let list):
            let rows: [[String: Any]] = list.map { ["name": $0.name, "addr": $0.addr, "rssi": $0.rssi] }
            return ["t": "devs", "list": rows]
        }
    }

    public var json: String {
        return JSONText.encode(object)
    }

    /// 交给 evaluateJavaScript 的那一句。
    public var script: String {
        return "onBle(" + json + ")"
    }
}

public enum JSONText {
    /// 编成能直接写进 JavaScript 源码的 JSON。
    public static func encode(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: []),
              let text = String(data: data, encoding: .utf8) else {
            return "null"
        }
        // 这两个字符在旧的 JavaScript 里算换行，写在字符串里会报语法错。
        return text
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}

/// 页面调原生的方法。页面那头是 `window.EVC.xxx(...)`，由 evc-shim.js 转成 `{m: 名字, a: [参数]}`。
/// `loadGate` / `locale` / `mtu` 要同步返回，在 evc-shim.js 里直接答，不到这里。
public enum BridgeCall: Equatable {
    case scan
    case stopScan
    case connect(String)
    case disconnect
    case send(String)
    case saveGate(address: String, pin: String)
    case linkFast(Bool)
    case heartbeatTime(Bool)
    case restart
    case pickFile

    /// 一条命令能不能发：空的、带换行的不发。和 Java Bridge.send 一样。
    public static func sendable(_ text: String) -> Bool {
        if text.isEmpty {
            return false
        }
        for scalar in text.unicodeScalars where scalar.value == 0x0A || scalar.value == 0x0D {
            return false
        }
        return true
    }

    /// 解析 WKScriptMessage.body。不认识的、参数不对的返回 nil。
    public static func parse(_ body: Any?) -> BridgeCall? {
        guard let dict = body as? [String: Any], let name = dict["m"] as? String else {
            return nil
        }
        let args = dict["a"] as? [Any] ?? []
        func text(_ index: Int) -> String? {
            return index < args.count ? args[index] as? String : nil
        }
        func flag(_ index: Int) -> Bool {
            guard index < args.count else {
                return false
            }
            if let value = args[index] as? Bool {
                return value
            }
            if let value = args[index] as? NSNumber {
                return value.boolValue
            }
            return false
        }
        switch name {
        case "scan":
            return .scan
        case "stopScan":
            return .stopScan
        case "connect":
            guard let address = text(0) else {
                return nil
            }
            return .connect(address)
        case "disconnect":
            return .disconnect
        case "send":
            guard let command = text(0), sendable(command) else {
                return nil
            }
            return .send(command)
        case "saveGate":
            guard let address = text(0), !address.isEmpty else {
                return nil
            }
            return .saveGate(address: address, pin: text(1) ?? "")
        case "linkFast":
            return .linkFast(flag(0))
        case "heartbeatTime":
            return .heartbeatTime(flag(0))
        case "restart":
            return .restart
        case "pickFile":
            return .pickFile
        default:
            return nil
        }
    }
}

/// 记住的管理员密码。对应 Android 的 SharedPreferences "evc_gate"：6 位才存，否则删掉。
public enum GateRules {
    public static let storeName = "evc_gate"

    public static func apply(_ gate: inout [String: String], address: String, pin: String) {
        if address.isEmpty {
            return
        }
        if pin.count == 6 {
            gate[address] = pin
        } else {
            gate.removeValue(forKey: address)
        }
    }
}

/// 页面一开始就要同步拿到的东西。原生把它写成 `window.__evcInit = {...};` 放在 evc-shim.js 前面。
public struct ShimInit {
    public var locale: String
    public var gate: [String: String]
    public var mock: Bool
    public var nativeFilePicker: Bool

    public init(locale: String, gate: [String: String], mock: Bool, nativeFilePicker: Bool) {
        self.locale = locale
        self.gate = gate
        self.mock = mock
        self.nativeFilePicker = nativeFilePicker
    }

    public var script: String {
        let object: [String: Any] = [
            "locale": locale,
            "gate": gate,
            "mock": mock,
            "nativeFilePicker": nativeFilePicker,
        ]
        return "window.__evcInit = " + JSONText.encode(object) + ";\n"
    }
}
