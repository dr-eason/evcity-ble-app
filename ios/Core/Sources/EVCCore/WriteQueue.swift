import Foundation

/// 待发命令的队列和分包。对应 Java 的 writes / sendCommand / pumpWrite。
public struct WriteQueue {
    private var items: [[UInt8]] = []

    public init() {}

    public var isEmpty: Bool { items.isEmpty }

    public mutating func clear() {
        items.removeAll()
    }

    /// 一条命令，末尾补 "\n"。
    public mutating func enqueue(command: String) {
        items.append(Array((command + "\n").utf8))
    }

    /// 取下一次要写的字节。比 `payload` 长就切开，剩下的放回队首。
    public mutating func next(payload: Int) -> [UInt8]? {
        if items.isEmpty {
            return nil
        }
        let size = max(payload, 1)
        var bytes = items.removeFirst()
        if bytes.count > size {
            items.insert(Array(bytes[size...]), at: 0)
            bytes = Array(bytes[..<size])
        }
        return bytes
    }

    /// 没写出去的放回队首。
    public mutating func putBack(_ bytes: [UInt8]) {
        items.insert(bytes, at: 0)
    }
}

/// MTU 和每次写入的字节数。
public enum LinkMtu {
    /// 没连上、没协商时的值，和 Android 的 negotiatedMtu 初值一样。
    public static let base = 23
    /// Android 用 requestMtu(247)，所以那边最大是 247。iOS 自己协商，可能更大，这里封顶到一样的值，
    /// 固件和模组只在这个范围里测过。
    public static let cap = 247

    /// iOS 的 maximumWriteValueLength(for: .withoutResponse) 等于 MTU - 3。
    public static func fromMaxWrite(_ maxWriteWithoutResponse: Int) -> Int {
        return min(max(maxWriteWithoutResponse + 3, base), cap)
    }

    /// 每次写入最多多少字节：MTU - 3，不小于 20。和 Java pumpWrite 一样。
    public static func payload(mtu: Int) -> Int {
        return max(mtu - 3, 20)
    }
}
