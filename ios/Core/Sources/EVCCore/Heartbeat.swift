import Foundation

/// 每秒一条的心跳。对应 Java 的 heartbeatLine，格式见那边的注释：
/// `HB\t<UTC Unix 秒>\t<手机时区，相对 UTC 的分钟数>`，旧固件只认纯 "HB"。
public enum Heartbeat {
    public static let interval: TimeInterval = 1.0

    /// - Parameters:
    ///   - timeEnabled: 界面用 EVC.heartbeatTime(true) 打开过。
    ///   - busy: 正在写或者队列里还有别的数据（比如固件升级）。
    ///   - nowMs: 当前时间，Unix 毫秒。
    ///   - tzOffsetMs: 手机时区相对 UTC 的毫秒数。
    public static func line(timeEnabled: Bool, busy: Bool, nowMs: Int64, tzOffsetMs: Int) -> String {
        if !timeEnabled || busy {
            return "HB"
        }
        let unix = nowMs / 1000
        if unix < 1_577_836_800 || unix >= 2_145_916_800 {
            return "HB"
        }
        let tz = tzOffsetMs / 60000
        if tz < -720 || tz > 840 {
            return "HB\t\(unix)"
        }
        return "HB\t\(unix)\t\(tz)"
    }
}
