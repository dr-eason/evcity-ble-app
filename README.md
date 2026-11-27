# EVCITY AC 蓝牙 App（公开镜像）

这个仓库是 EVCITY AC 充电桩蓝牙 App 的**单向镜像**，用来在 GitHub Actions 的 macOS 机器上编 iOS 版。

- 主源码不在这里。这里的内容由主仓库的脚本整份生成，每次同步都会覆盖。
- **不要在这里直接改代码或提 PR**：下一次同步会把改动冲掉。要改请改主仓库，再同步过来。
- 每次同步是一个提交，提交说明是 `sync from AC-V2 <主仓库的提交号>`。根目录的 `.evc-mirror` 记着同一个提交号。

This repository is a one-way mirror used to build the iOS app on GitHub-hosted macOS runners.
It is generated from a private source repository and is overwritten on every sync, so please do
not edit it here.

## 目录

| 目录 | 内容 |
|---|---|
| `ui/` | App 的界面（Vue 3 + Vite）。Android 和 iOS 用同一份。 |
| `ios/` | iOS 工程（Swift，WKWebView + CoreBluetooth，XcodeGen）。只支持 iPhone，不支持 iPad。说明见 `ios/说明.md`。 |
| `.github/workflows/ios.yml` | iOS 的构建工作流。 |

## 构建

工作流 **iOS** 在 `ios/` 或 `ui/` 有改动时自动跑，也可以在 Actions 页面手动触发（Run workflow）。

- 默认的任务编 iOS 模拟器版（不签名，Mock BLE），跑单元测试，产物 `EVCITYAC-simulator` 在该次运行页面底部的 Artifacts 里下载。
- 签名的真机包（`.ipa`）要手动触发并勾选 `build_ipa`，还要先在仓库的 Secrets 里配好证书和描述文件。步骤见 `ios/说明.md`。

在自己的 Mac 上编：

```bash
bash ios/build_ui.sh          # 编界面并拷进 iOS 工程，顺便生成图标
brew install xcodegen
cd ios && xcodegen generate
open EVCITYAC.xcodeproj
```

## 许可

见 [LICENSE](LICENSE)。许可方式待定。
