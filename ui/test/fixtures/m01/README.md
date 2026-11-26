# M01 测试用的拷贝

合并进 AC06 App 的 M01 模块（`ui/src/m01/`）的主机测试要对照 M01 固件的几个文件。这里是从 M01 仓库
分支 `m01-evcm-adv`（基于 main 435d3cb，固件 1.3.6）拷来的快照，不是这里维护的。`M01蓝牙协议.md`
在广播名改成 `EVCM_` 加 6 位（11 个字符）之后重新拷过，另外三个文件那次没有变：

- `ble_caps.h`：`M01/app/inc/ble_caps.h`，能力位（`fw-compat.js` 的 CAPS 和它一一对应）
- `app_config.h`：`M01/user/inc/app_config.h`，固件版本 `M01_FW_VERSION`
- `M01蓝牙协议.md`：`文档/04-协议/M01蓝牙协议.md`
- `App固件兼容框架.md`：`文档/04-协议/App固件兼容框架.md`

M01 固件改了协议或能力位，要把这几个文件重新拷一份，再跑 `node --test`。和 `wb2.c` 对照的那些测试
（命令表、格式串）留在 M01 仓库里跑，这里没有拷 `wb2.c`。
