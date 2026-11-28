#ifndef APP_CONFIG_H_
#define APP_CONFIG_H_

/*
 * 全部任务优先级与栈大小的唯一集中定义处（不要散落到各模块头文件）。
 * 优先级 0（空闲）~ 4（最高，configMAX_PRIORITIES-1）。
 * 约定：4 = 安全监控专用，业务任务不得使用。
 */

/* ---- M01：10 路单相输出 ---- */

/* 额定电压（V，整数）。Smart Charging 的限值单位是 A 时，按它换算成 W。 */
#define M01_RATED_VOLTAGE_V            230u
/* 过压、欠压门槛的出厂默认值，单位 0.1 V：额定电压的 1.1 倍和 0.9 倍，
 * 230 V 时是 253.0 V 和 207.0 V。用户页里没存过、或存的值不合法时用它。
 * 蓝牙 App「保护设置」里保存过的值优先（service/src/grid_limits.c）。 */
#define M01_DEFAULT_OVERVOLTAGE_X10    (M01_RATED_VOLTAGE_V * 11u)
#define M01_DEFAULT_UNDERVOLTAGE_X10   (M01_RATED_VOLTAGE_V * 9u)

/* 每路功率上限（W）。默认 800；蓝牙 App（PLIMSET）和工程口（!ENG PLIM）可以按路改，
 * 存在用户页（service/src/port_cfg.c）。充电中这一路的有功功率连续 3 秒高于上限就
 * 断开这一路，停止原因 OVERPOWER（service/src/port_protect.c）。
 * TODO(M01-SCH)：可设范围的上限和电流硬上限要按继电器、保险和线径的额定值定，
 * 现在是暂定值。 */
#define M01_POWER_LIMIT_DEFAULT_W      800u
#define M01_POWER_LIMIT_MIN_W          50u
#define M01_POWER_LIMIT_MAX_W          2000u
/* 每路电流硬上限（A），不可设。连续 500 ms 高于它立即断开这一路。 */
#define M01_PORT_CURRENT_MAX_A         12.0f

/* 充满自停：充电中这一路的有功功率低于门槛、连续设定的秒数，就停这一路，
 * 停止原因 FULL。没插车（空载）也是功率为 0，走的是同一条规则，不另做空载自停。
 * 门槛默认 10 W（1–100），低载多久默认 300 秒（10–3600）。工程口 !ENG FULLW / FULLS
 * 或蓝牙 PAYSET 可以改，存在用户页（service/src/charge_cfg.c）。 */
#define M01_FULL_STOP_DEFAULT_W        10u
#define M01_FULL_STOP_MIN_W            1u
#define M01_FULL_STOP_MAX_W            100u
#define M01_FULL_STOP_HOLD_S           300u
#define M01_FULL_STOP_HOLD_MIN_S       10u
#define M01_FULL_STOP_HOLD_MAX_S       3600u

/* 充电结束后 FINISHING 停留多久回到 PREPARING（ms）。 */
#define M01_FINISHING_MS               1000u
/* 相邻两次继电器吸合之间至少隔多久（ms）。10 路同时授权也不会同时合闸。 */
#define M01_RELAY_STAGGER_MS           100u
/* 全部停止（蓝牙 STOP⇥0、断网停充、平台 Reset、工程口 STOP 0）逐路停：在充的端口登记进
 * 停止队列，充电任务按端口号从小到大每隔这么久停一路（ms）。每停一路，wb2 要发
 * StatusNotification 和 StopTransaction（OCPP 一次只有一条没应答的 CALL，一来一回约
 * 0.2–0.5 秒），蓝牙要推状态，订单要写 flash；隔 300 ms 一路，平台报文和蓝牙应答跟得上，
 * 不会 10 路一齐涌到同一条串口上。10 路最后一路在 2.7 秒时停，再过 1 秒结束中回空闲。 */
#define M01_STOP_ALL_GAP_MS            300u
/* 继电器粘连锁存后，这一路线圈快闪，和线圈并联的红灯（LED10–LED19）跟着闪。
 * 亮、灭各这么多毫秒，和升级时 LED7 / LED9 的快闪一样。逻辑上这一路仍是断开。 */
#define M01_WELD_BLINK_MS              125u
/* 锁存的板级故障（板温过高、温度传感器坏）原因消失后，每隔多久自动解除一次（ms）。
 * 0 = 不自动解除，只能工程口 !ENG SAFETY RESET 或断电。 */
#define M01_FAULT_RETRY_MS             30000u

/* 选枪（触摸板按键或 App 的 PORTSEL）之后多久之内刷卡有效（秒）。 */
#define M01_PORT_SELECT_S              30u
/* 特权卡、在线模式的平台卡：1 = 刷卡前必须先选枪；0 = 没选时在编号最小的
 * 空闲端口起充。离线刷卡不看这个开关，一律要先选枪。 */
#define M01_CARD_NEEDS_SELECT          0

/* 安全监控任务：最高优先级，唯一允许驱动主功率继电器的上层任务 */
#define TASK_SAFETY_PRIO        4
#define TASK_SAFETY_STACK       384

/* 充电主状态机 */
#define TASK_CHARGE_PRIO        3
#define TASK_CHARGE_STACK       768     /* 单位：word。订单写日志时栈上有两份 80 字节的记录 */

/* 板载计量服务 */
#define TASK_METER_PRIO         2
#define TASK_METER_STACK        384

/* Engineering command console (debug UART). */
#define TASK_ENG_PRIO           1
#define TASK_ENG_STACK          448     /* 单位：word。模拟刷卡走完整的离线刷卡流程 */

/* 刷卡板 CX522（J3，9600 8N1）。0 = 完全不编译刷卡代码。
 * BRD_WB2_ON_J3 为 1 时任务不启动（模组临时占用 J3），这里仍保持 1。
 * 读头只有一个，10 路共用：刷卡作用在哪一路见 app/src/card_reader.c 和
 * service/inc/port_select.h。 */
#define M01_CARD_READER_ENABLE  1

/* 内置特权卡：1 扇区 0 块（绝对块 4）里的可打印内容等于这个字符串，就允许起充。
 * 编译期写死，卡内容不匹配一律不授权。块内的 0x00/0xFF 填充不参与比较 ——
 * 实测这张卡的块 4 是 00×13 + "T01"，右对齐、左侧用 0x00 补齐。 */
#define M01_CARD_PRIVILEGED_TEXT "T01"
#define TASK_CARD_PRIO          1
#define TASK_CARD_STACK         448     /* 单位：word；含 snprintf、离线刷卡的读写卡和订单查找 */

/* 心跳/遥测任务 */
#define TASK_HEARTBEAT_PRIO     1
#define TASK_HEARTBEAT_STACK    1024    /* 单位：word。$STAT 行缓冲在 BSS，栈上只留 printf 浮点 */

/* RGB 状态灯刷新任务 */
#define TASK_LED_PRIO           1
#define TASK_LED_STACK          192

/* 遥测/调试串口（J5，USART1，PA2/PA3）波特率。USART1 挂在 APB1 = AHB/2 = 60 MHz：
 * 230400 时 USARTDIV=16.25，实际 230769 baud，误差 +0.16%，在 8N1 容差内。
 * PC 侧 telemetry 的 --baud 必须也是 230400。 */
#define M01_DBG_UART_BAUD      230400u
#define M01_TELEMETRY_ENABLE   1u

/* 遥测怎么发（service/src/telemetry.c、telem_sched.c），说明见 M01/文档/03-方案/M01-遥测.md 第 1 节。
 * 心跳任务 0.5 秒一拍。整帧 $STAT 只在关键帧发，平时发增量 $STD：整桩的读数每帧都带，
 * 整桩的状态和配置变了才带，端口只带变了的。 */
#define M01_TELEM_IDLE_MS       5000u   /* 没有端口在充：$STD 至少这么久一行（当心跳） */
#define M01_TELEM_BUSY_MS       2000u   /* 有端口在充 */
#define M01_TELEM_PORT_MS       5000u   /* 在充的端口：读数至少这么久带一次 */
#define M01_TELEM_PORT_MIN_MS   1000u   /* 同一端口的读数两次之间至少隔这么久（状态变了不受限） */
#define M01_TELEM_DB_W          10u     /* 功率变化超过 max(这么多瓦, M01_TELEM_DB_PCT %) 就提前带 */
#define M01_TELEM_DB_PCT        10u
#define M01_TELEM_DB_V          5u      /* 电压变化到这么多伏就提前带 */
#define M01_TELEM_KEY_MS        30000u  /* 整帧 $STAT（关键帧） */
#define M01_TELEM_HW_MS         10000u  /* $HW；继电器、输出检测变了提前发，工程直驱继电器时 1 秒一行 */
#define M01_TELEM_HW_MIN_MS     1000u   /* $HW 两行之间至少隔这么久 */
/* 调试口的字节预算：J5 上所有输出（日志、遥测、命令应答）平均每秒不超过 BPS 字节，
 * 突发不超过 BURST 字节。超了遥测先停，攒够了再发；日志不受预算管，靠 log.c 的同类合并。 */
#define M01_TELEM_BUDGET_BPS    900u
#define M01_TELEM_BUDGET_BURST  4096u
/* !ENG TEL FAST [秒]：临时回到 1 秒一行整帧（$STAT、$HW 轮流），不看预算。不带秒数是
 * 默认值，最长 MAX。重启恢复正常。 */
#define M01_TELEM_FAST_S        300u
#define M01_TELEM_FAST_MAX_S    3600u

/* 日志限流（service/src/log_limit.c）：同一处日志（同一个格式串）一个窗口里最多打 BURST 行，
 * 多的只计数，窗口结束时补一行 "log: N more like ..."。工程命令台的应答不限。 */
#define M01_LOG_RL_WINDOW_MS    10000u
#define M01_LOG_RL_BURST        8u

/* 安信可 Ai-WB2（WiFi + BLE，J6，115200）。 */
#define M01_WB2_ENABLE         1
#define TASK_WB2_PRIO           1
#define TASK_WB2_STACK          1024    /* 单位：word。状态帧里的浮点格式化会吃很多栈 */

/* 触摸板（J7），协议见 M01/文档/04-协议/触摸板通讯协议.md，app/src/touch_panel.c。
 * 0 = 不建任务、不初始化串口（引脚保持复位后的浮空输入）。 */
#define M01_TOUCH_PANEL_ENABLE  1
/* 协议里没有"选路"命令。1 = 触摸板用 0x01 查询某一路，就当作用户选中了这一路
 * （之后 M01_PORT_SELECT_S 秒内刷卡作用在它上面）。这是推断，待和触摸板厂家确认。 */
#define M01_TOUCH_QUERY_SELECTS 1
/* 刷卡没成（余额不足、这一路不能用、读写卡失败）时，选中的那一路在 0x03 的应答里报成
 * "故障"这么久，让桩前的人看到是这一路没成。协议里没有显示刷卡结果的命令，这是借用端口
 * 状态；触摸板怎么显示"故障"要和厂家确认。0 = 不借用。 */
#define M01_TOUCH_REJECT_MS    3000u
#define TASK_TOUCH_PRIO         1
#define TASK_TOUCH_STACK        320

/* 任务超期没有报到时：0 只记录（日志和故障记录），照常喂狗；
 * 1 停止喂狗，等独立看门狗复位。先用 0 跑一段时间确认期限没有定紧。 */
#define M01_TASK_WDG_RESET     0

/* FreeRTOS 内核断言。默认只在 standalone（台架）镜像里打开。 */
#ifndef M01_RTOS_ASSERT
#ifdef M01_STANDALONE_BUILD
#define M01_RTOS_ASSERT        1
#else
#define M01_RTOS_ASSERT        0
#endif
#endif

/* OCPP ConnectionTimeOut，秒。M01 没有"等用户插枪"的过程，这个值只在
 * GetConfiguration / ChangeConfiguration 里读写，不参与任何判断。 */
#define M01_CONNECTION_TIMEOUT_S   90u

/* OCPP 远程升级最终失败（DownloadFailed / InstallationFailed）之后要不要复位。
 * 1：失败状态报出去（或报不出去超时）并收尾之后复位，正在充电时不复位。
 *    这是线上 1492679 的行为。
 * 0：不复位，收尾后照常轮询。这是 ca1c17a 的行为。 */
#define M01_OCPP_FW_FAIL_RESET 1

/* 蓝牙广播看护：手机没连着时，每隔这么多秒把广播关掉再打开一次（AT+BLEMODE=9、
 * 设广播名、AT+BLEMODE=0，一秒以内），防模组内部自己停了广播而查询看不出来。
 * 0 = 不做定时重开；WiFi 状态变化、模组重启、AT 无应答这几种仍然会处理。 */
#define M01_BLE_ADV_REFRESH_S  600u

/* ---- WiFi / OCPP 断线检测与重连（app/src/wb2.c；退避的算法在 service/src/net_backoff.c） ----
 * 蓝牙广播看护自己的节拍（ADV_*）没有放到这里，仍在 wb2.c 开头那一段，各自带着理由。 */

/* WiFi 重连（AT+WJAP）。一次 AT+WJAP 最多占住模组 20 秒，这段时间里模组多半不广播，结束后
 * 还要由广播看护重开一次广播，所以不能连得太勤：
 *   - 刚掉线后的第一次 5 秒后就连：路由器闪断、信道切换多半几秒就回来。
 *   - 之后从 30 秒起翻倍：30、60、120、240、480 秒，到 10 分钟封顶。热点一两分钟回不来时
 *     （路由器重启）前几分钟里还有几次机会；长时间不在（热点关了、密码改了）就 10 分钟
 *     一次，和 2.7.1 起的上限一样，模组十分钟里最多被占 20 秒。
 *   - 抖动 20 %：实际等待在名义值的 80 %–100 % 之间随机，同一个热点下的几台桩不在同一秒
 *     一起连。
 * 连上了、人重新配了热点、打开了 WiFi 开关，从头算。开机那一次连接也算一次。 */
#define M01_WIFI_RETRY_FIRST_MS     5000u
#define M01_WIFI_RETRY_BASE_MS      30000u
#define M01_WIFI_RETRY_MAX_MS       600000u
#define M01_WIFI_RETRY_JITTER_PCT   20u
/* WiFi 断线的兜底查询：模组的 +EVENT:WIFI_DISCONNECT 可能丢（串口丢字节、模组正忙），每隔
 * 这么久发一次 AT+WJAP? 核对。5 秒：断线最迟 5 秒看出来（串口被占着时顺延）。 */
#define M01_WIFI_QUERY_MS           5000u
/* AT+WJAP 发出去之后，或者模组自己报"正在连"之后，这么久还没拿到 IP 就算这一次没成。
 * 模组手册里 AT+WJAP 的超时是 20 秒。 */
#define M01_WIFI_JOIN_LIMIT_MS      20000u
/* 手机蓝牙连着的时候，到点的自动重连（不是手机让连的那种）往后推，最多推这么久。
 * AT+WJAP 会占住射频十几秒，手机那边的数据会卡住，甚至断开；人一般几分钟就用完 App 走开，
 * 推 5 分钟够用，手机一直连着也不至于让 WiFi 永远不重连。手机发的 WJOIN / WSAVE 不推。 */
#define M01_NET_LINKED_DEFER_MS     300000u

/* OCPP 重连（WebSocket，走 WiFi 的 AT+SOCKET 或 4G）。
 *   - 链路好了才连：WiFi 拿到 IP（+EVENT:WIFI_GOT_IP 或 +WJAP:3），或者 4G 拨通。链路一恢复
 *     就从头算，等 M01_OCPP_RETRY_FIRST_MS 后连。广播看护在 WiFi 变化后 3 秒要重开广播，
 *     它对串口有优先权（ble_adv_claim），两件事一前一后，不会挤在一起。
 *   - 连不上（TCP 不通、握手被拒、BootNotification 一直没应答）：3 秒，再从 5 秒起翻倍：
 *     5、10、20、40、80 秒，到 2 分钟封顶，抖动 20 %。一次 AT+SOCKET 最长占住模组 45 秒
 *     （30 秒超时加 15 秒冷却），封顶 2 分钟时最坏也只占三成时间，看护和手机命令有空档；
 *     平台恢复后最迟 2 分钟连回来。1.3.5 及以前是 3、3、10、30、60 秒，没有抖动，一百台桩
 *     在平台重启后会在同一秒一起来连。
 *   - 注册成功（BootNotification Accepted）、人改了地址或开关、换了链路，从头算。 */
#define M01_OCPP_RETRY_FIRST_MS     3000u
#define M01_OCPP_RETRY_BASE_MS      5000u
#define M01_OCPP_RETRY_MAX_MS       120000u
#define M01_OCPP_RETRY_JITTER_PCT   20u
/* OCPP 断线检测。心跳间隔由平台定（常见 300–3600 秒）。只靠心跳超时的话，半开的 TCP
 * （路由器重启、运营商 NAT 收回了映射，模组不报 SocketClosed）要等到下一次心跳才发现，
 * 最长一个小时。所以另加两条：
 *   - 平台 M01_OCPP_PROBE_IDLE_MS 一个字节都没来（应答、请求、Pong 都算），发一帧
 *     WebSocket Ping（OCPP-J 1.6 第 5.3 节；配置项 WebSocketPingInterval 报这个值）。
 *     90 秒比常见的 NAT 空闲回收（120–300 秒）短，顺带给映射保活；平台空闲时一分半才一帧。
 *     Ping 之后 M01_OCPP_PONG_WAIT_MS 没有任何回音：这条连接上平台回过 Pong 的，当断线重连；
 *     没回过的（有的平台不回 Pong），改发一条 Heartbeat 去问，心跳应答超时（10 秒）再重连，
 *     这条连接以后都用 Heartbeat 探。最坏 90 + 10 + 10 秒发现断线。
 *   - 连着 M01_OCPP_CALL_MISS_MAX 条 CALL 都没有应答（各自超时），中间平台一个字节都没回：
 *     不等探测，直接重连。起充报文前 3 次超时是立即重发的，3 次都没回正好重连，重新注册后
 *     再发同一笔交易。心跳本来就是一条没回就重连。 */
#define M01_OCPP_PROBE_IDLE_MS      90000u
#define M01_OCPP_PONG_WAIT_MS       10000u
#define M01_OCPP_CALL_MISS_MAX      3u
/* 连平台各段的超时（1.3.6 之前写在 wb2.c 里，数值没有改）：AT+SOCKET 等结果 30 秒，超时后
 * 模组多半还卡在这条命令里，再空等 15 秒（冷却）才发别的；握手应答 15 秒；连接加握手一共
 * 最多 60 秒，谁把计时清掉都不管用；BootNotification 等应答 30 秒，3 次没回就重连。 */
#define M01_OCPP_CONNECT_MS         30000u
#define M01_OCPP_CONNECT_COOL_MS    15000u
#define M01_OCPP_HANDSHAKE_MS       15000u
#define M01_OCPP_OPEN_MAX_MS        60000u
#define M01_OCPP_BOOT_TIMEOUT_MS    30000u
#define M01_OCPP_BOOT_TRIES_MAX     3u

/* ---- OCPP 上行流量（10 路）和间隔下限（app/src/wb2.c；节拍算法在 service/src/ocpp_pace.c） ----
 * 估算见 M01/文档/03-方案/M01-架构.md 7.2 节。要点：桩自己发的 CALL 同一时刻只有一条没应答
 * （OCPP-J 4.1.1），一条 MeterValues 约 0.4 KB，串口 115200 上只要 30 多毫秒，真正的瓶颈是
 * 一来一回：WiFi 0.2–0.5 秒，4G 0.3–1 秒，所以这条通道每秒最多 2–5 条，4G 最坏 1 条。
 * 10 路的 MeterValues 是 10 / 间隔 条每秒，乘上 10 以后最先把这条通道占满的就是它。
 *
 * 间隔下限。平台用 ChangeConfiguration 设得比下限小（不是 0）时回 Rejected，原值不变；
 * BootNotification 应答里的 interval 不能拒绝，钳到心跳下限；用户页里存着的旧值（老固件
 * 接受过的小值）开机时钳到下限。GetConfiguration 报的都是实际在用的值。
 *   - MeterValueSampleInterval ≥ 10 秒：10 路一共每秒 1 条。WiFi 下占通道 20–50 %，留出
 *     一半给 Start / Stop / Status 和蓝牙；4G 最坏正好占满，这时 MeterValues 自己往后挪
 *     （见下面的合并），关键报文照样优先。再小就只能靠挪，平台看到的间隔也不是它设的。
 *     0 = 不发周期值（OCPP 1.6），每单开始时那一条照发。
 *   - ClockAlignedDataInterval ≥ 60 秒：对齐点上 10 路同一时刻到点，按下面的间隔排开发
 *     完要 5–10 秒；60 秒时一分钟里只占这几秒。计费常用 15 分钟、1 小时。0 = 不发。
 *   - HeartbeatInterval ≥ 30 秒：心跳只是报平安和对时，断线另有 90 秒的 Ping 探测
 *     （M01_OCPP_PROBE_IDLE_MS），它排在 MeterValues 前面，太勤就挤 MeterValues。30 秒也是
 *     出厂值。OCPP 1.6 里心跳没有"0 = 关"，0 照旧回 Rejected。 */
#define M01_OCPP_METER_SAMPLE_MIN_S     10u
#define M01_OCPP_CLOCK_ALIGNED_MIN_S    60u
#define M01_OCPP_HEARTBEAT_MIN_S        30u
/* 节流（单条在途之外再加的）：
 *   - 两条 MeterValues 之间至少隔 M01_OCPP_METER_GAP_MS（从上一条发出算）：每秒最多 2 条，
 *     对齐点、TriggerMessage 要全部、重连后 10 路一起到点时也是一条一条排开，通道总有空着
 *     的时候，新来的 Start / Stop 最多等一条 MeterValues。MeterValues 不排队：一路到点了
 *     还没轮到，发的时候取最新的读数，只发一条，不积压。
 *   - 一条 CALL 应答（或超时）以后，至少隔 M01_OCPP_CALL_GAP_MS 才发下一条：平台回得再快，
 *     WB2 的串口也有空当给蓝牙应答、WiFi 查询；重连后积压的 StopTransaction、11 条
 *     StatusNotification 每秒不超过 5–8 条。100 ms 对刷卡起充的人感觉不到。
 *   - 走 WiFi 时蓝牙应答队列里有行，桩自己的下一条 CALL 再多让 M01_OCPP_BLE_FIRST_MS（从上一条
 *     应答算）：蓝牙应答先走，手机连着时每秒 4 行状态也不至于把 OCPP 一直压着。走 4G 时 OCPP
 *     不用 WB2 的串口，不让。 */
#define M01_OCPP_METER_GAP_MS           500u
#define M01_OCPP_CALL_GAP_MS            100u
#define M01_OCPP_BLE_FIRST_MS           300u

/* 版本号 */
/* M01 的版本号从 1.0.0 起，来历见 M01/文档/08-实施报告/M01-来历与沿革.md。 */
#define M01_FW_VERSION         "3.03.00"

#endif
