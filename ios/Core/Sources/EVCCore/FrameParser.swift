import Foundation

/// 把蓝牙通知里的字节拼成一行一行的文本。
/// 逐句对应 Android `MainActivity.java` 的 appendPending / takeFrames / frameEnd / nextHead /
/// insideLongerHead / acceptFrame / printableLine / knownLine，改这里之前先对照那边。
public struct FrameParser {
    /// 和 Java 的 FRAME_HEADS 同一张表、同一个顺序。
    public static let frameHeads: [[UInt8]] = [
        "STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "APDONE", "OCPP ", "CFG ",
        "IMAX ", "SCHED ", "ORD ", "ORDDONE", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "OCFW ",
    ].map { Array($0.utf8) }

    /// Java 的 rxBuf 大小。
    public static let capacity = 2048
    /// 一行最多这么多字节，再长就丢。
    public static let maxLineBytes = 380
    /// 半行在缓冲里最多等这么久（秒），到时调 `flush()`。
    public static let flushDelay: TimeInterval = 0.120

    private var buf: [UInt8] = []

    public init() {}

    /// 缓冲里还有没凑成一行的字节。为 true 时调用方要起一个 `flushDelay` 的定时器。
    public var hasPending: Bool { !buf.isEmpty }

    public mutating func reset() {
        buf.removeAll(keepingCapacity: true)
    }

    /// 收到一个通知。返回这次能送给界面的行（已经过滤）。
    public mutating func append(_ value: [UInt8]) -> [String] {
        if value.isEmpty {
            return []
        }
        if buf.count + value.count > Self.capacity {
            buf.removeAll(keepingCapacity: true)
        }
        if value.count <= Self.capacity {
            buf.append(contentsOf: value)
        }
        return takeFrames()
    }

    /// 定时器到点：把剩下的半行当成一行试一次，然后清空。
    public mutating func flush() -> [String] {
        let rest = buf
        buf.removeAll(keepingCapacity: true)
        if let line = Self.cleanLine(rest) {
            return [line]
        }
        return []
    }

    private static func isBreak(_ byte: UInt8) -> Bool {
        return byte == 0x0A || byte == 0x0D
    }

    private mutating func dropLeading() {
        var count = 0
        while count < buf.count && (Self.isBreak(buf[count]) || buf[count] == 0) {
            count += 1
        }
        if count > 0 {
            buf.removeFirst(count)
        }
    }

    private mutating func takeFrames() -> [String] {
        var lines: [String] = []
        dropLeading()
        while !buf.isEmpty {
            let end = frameEnd()
            if end <= 0 {
                break
            }
            var consume = end
            if Self.isBreak(buf[end]) {
                consume = end + 1
            }
            let frame = Array(buf[0..<end])
            buf.removeFirst(consume)
            if let line = Self.cleanLine(frame) {
                lines.append(line)
            }
            dropLeading()
        }
        return lines
    }

    /// 这一行在哪里结束：换行，或者下一个帧头（两行粘在一起没有换行时）。没有就是 -1。
    private func frameEnd() -> Int {
        var newline = -1
        for i in 0..<buf.count where Self.isBreak(buf[i]) {
            newline = i
            break
        }
        let head = nextHead(from: 1)
        if head > 0 && (newline < 0 || head < newline) {
            return head
        }
        return newline
    }

    private func nextHead(from start: Int) -> Int {
        let from = max(start, 1)
        var best = -1
        for head in Self.frameHeads {
            var search = from
            while search < buf.count {
                let at = indexOf(head, from: search)
                if at < 0 {
                    break
                }
                // WCFG 从第 2 字节起就是 CFG。短帧头落在更长帧头里面时不能切开。
                if !insideLongerHead(at) {
                    if best < 0 || at < best {
                        best = at
                    }
                    break
                }
                search = at + 1
            }
        }
        return best
    }

    private func insideLongerHead(_ at: Int) -> Bool {
        for head in Self.frameHeads {
            var i = max(at - head.count + 1, 0)
            while i < at {
                if i + head.count > at && matches(head, at: i) {
                    return true
                }
                i += 1
            }
        }
        return false
    }

    private func matches(_ needle: [UInt8], at index: Int) -> Bool {
        if index < 0 || index + needle.count > buf.count {
            return false
        }
        for j in 0..<needle.count where buf[index + j] != needle[j] {
            return false
        }
        return true
    }

    private func indexOf(_ needle: [UInt8], from start: Int) -> Int {
        let last = buf.count - needle.count
        var i = max(start, 0)
        while i <= last {
            if matches(needle, at: i) {
                return i
            }
            i += 1
        }
        return -1
    }

    /// 去掉两头的空白，太长、有不可见字符、行首不认识的都返回 nil。
    public static func cleanLine(_ raw: [UInt8]) -> String? {
        var start = 0
        var end = raw.count
        while start < end && (raw[start] == 0x20 || raw[start] == 0x09) {
            start += 1
        }
        while end > start && (raw[end - 1] == 0x20 || raw[end - 1] == 0x09
            || raw[end - 1] == 0x0D || raw[end - 1] == 0x0A) {
            end -= 1
        }
        if end <= start || end - start > maxLineBytes {
            return nil
        }
        // 不合法的 UTF-8 会变成 U+FFFD，下面的 printableLine 再把它挡掉，和 Java 一样。
        let line = String(decoding: raw[start..<end], as: UTF8.self)
        if !printableLine(line) || !knownLine(line) {
            return nil
        }
        return line
    }

    public static func printableLine(_ line: String) -> Bool {
        for scalar in line.unicodeScalars {
            let value = scalar.value
            if value == 0x09 {
                continue
            }
            if value < 0x20 || value == 0x7F || value == 0xFFFD {
                return false
            }
        }
        return true
    }

    /// 只放行认识的行首。新的蓝牙应答一律以 "ACK " 开头（见仓库 CLAUDE.md）。
    public static func knownLine(_ line: String) -> Bool {
        let prefixes = [
            "STAT ", "WCFG ", "FLT ", "LIVE ", "ACK ", "AP ", "OCPP ", "CFG ", "IMAX ",
            "SCHED ", "ORD ", "TEL ", "WIFISW ", "OCPPSW ", "NETSTOP ", "CARD\t", "QR ",
            "PHASE ", "OCFW ", "PLUG ", "WPASS\t",
        ]
        let exact = ["APDONE", "ORDDONE", "CARD", "WPASS"]
        if exact.contains(line) {
            return true
        }
        for prefix in prefixes where line.hasPrefix(prefix) {
            return true
        }
        return false
    }
}
