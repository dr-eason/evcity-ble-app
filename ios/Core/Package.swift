// swift-tools-version:5.7
import PackageDescription

// 不依赖 UIKit / CoreBluetooth 的逻辑：收包拆行、行过滤、写分包、心跳、桥消息解析。
// Mac 和 Linux 都能跑：swift test --package-path Core
let package = Package(
    name: "EVCCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "EVCCore", targets: ["EVCCore"]),
    ],
    targets: [
        .target(name: "EVCCore", path: "Sources/EVCCore"),
        .testTarget(name: "EVCCoreTests", dependencies: ["EVCCore"], path: "Tests/EVCCoreTests"),
    ]
)
