/* 蓝牙协议的能力位：固件告诉手机 App 自己有哪些协议功能。
 *
 * 放在每秒推送（和 STATUS 的应答）ACK SYS 的第 11 个字段，大写十六进制，最低位是 bit 0
 * （文档/04-协议/M01蓝牙协议.md 4.3 节）。App 的兼容框架（tools/ble-finder/ui/src/fw-compat.js）
 * 收到能力位就只看能力位；1.3.4 以前的固件（1.3.3 及更早）没有这个字段，App 按 ACK SYS 第 1 个字段的版本号查
 * 自己的能力表。规则和登记步骤见 文档/04-协议/App固件兼容框架.md。
 *
 * 位号和 App 能力表（fw-compat.js 的 CAPS）一一对应，App 的 node 测试逐个核对：
 *   - 分配了就不改、不复用；
 *   - 去掉某项功能时把它从 BLE_CAPS 里拿掉，位号留空，App 自动按"没有"处理；
 *   - 新功能占下一个位号，同时在 App 的能力表加一行（since 写这次的版本号）。 */
#ifndef BLE_CAPS_H
#define BLE_CAPS_H

#define BLE_CAP_PORTS_X         0u   /* 1.1.0 每秒推送 ACK PORTX */
#define BLE_CAP_PAY_INFO        1u   /* 1.1.0 ACK PORT、ACK ORD 行尾的离线刷卡金额 */
#define BLE_CAP_PAY_RULES       2u   /* 1.1.0 PAYGET / PAYSET */
#define BLE_CAP_PARALLEL        3u   /* 1.2.0 PARGET / PARSET（含只保存不重启） */
#define BLE_CAP_ORDER_PAGING    4u   /* 1.2.0 ACK ORDN、带参数的 ORDGET */
#define BLE_CAP_AUTH_GATE       5u   /* 1.3.0 通过 AUTH 才收命令 */
#define BLE_CAP_WRITE_QUOTA     6u   /* 1.3.0 写用户页的命令有额度 */
#define BLE_CAP_OCPP_WSS        7u   /* 1.3.0 OCPPSET 认 wss:// */
#define BLE_CAP_ADV_DIAG        8u   /* 1.3.0 ADVGET */
#define BLE_CAP_PAY_HOLD        9u   /* 1.3.2 PAYSET 第 3 个参数（低载多久停止） */
#define BLE_CAP_SNAPSHOT        10u  /* 1.3.2 SNAPGET / ACK SNAP */
#define BLE_CAP_WSCAN_ANYTIME   11u  /* 1.3.2 WiFi 开关关着也能 WSCAN，先回 ACK 再扫 */
#define BLE_CAP_AP_HEX          12u  /* 1.3.2 AP <信号>⇥<热点名十六进制> */

/* 这一版固件有的全部能力。 */
#define BLE_CAPS  ((1uL << BLE_CAP_PORTS_X) | (1uL << BLE_CAP_PAY_INFO) | (1uL << BLE_CAP_PAY_RULES) | \
                   (1uL << BLE_CAP_PARALLEL) | (1uL << BLE_CAP_ORDER_PAGING) |                       \
                   (1uL << BLE_CAP_AUTH_GATE) | (1uL << BLE_CAP_WRITE_QUOTA) |                       \
                   (1uL << BLE_CAP_OCPP_WSS) | (1uL << BLE_CAP_ADV_DIAG) |                           \
                   (1uL << BLE_CAP_PAY_HOLD) | (1uL << BLE_CAP_SNAPSHOT) |                           \
                   (1uL << BLE_CAP_WSCAN_ANYTIME) | (1uL << BLE_CAP_AP_HEX))

#endif /* BLE_CAPS_H */
