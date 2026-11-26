import { fr, ja, de, es, pt, ru } from "./packs.js";
import { hi, id } from "./packs-extra.js";
import { ar } from "./packs-extra-2.js";
import { bn, ur } from "./packs-extra-3.js";
import { tzPacks } from "./packs-tz.js";
import { ltePacks } from "./packs-lte.js";
import { m01Packs } from "./packs-m01.js";
import { authPacks } from "./packs-auth.js";
import { compatPacks } from "./packs-compat.js";
import { saveBtnPacks } from "./packs-savebtn.js";

const en = {
  "返回": "Back",
  "隐私协议": "Privacy Policy",
  "选择充电桩": "Select a charger",
  "附近还没有名为 EVC 的充电桩": "No EVC charger nearby",
  "停止扫描": "Stop scan",
  "扫描充电桩": "Scan for chargers",
  "没搜到，关闭重试": "Not found. Close and retry",
  "无故障": "No fault",
  "已充电": "Charged",
  "充电功率": "Power",
  "启动": "Start",
  "停止": "Stop",
  "已配置热点": "Saved hotspot",
  "断开蓝牙": "Disconnect",
  "6 位数字": "6 digits",
  "连接": "Connect",
  "固件": "Firmware",
  "固件升级": "Firmware update",
  "选择本机上的应用固件，校验后发给充电桩": "Choose an application image on this phone and send it after the check",
  "选择固件文件": "Choose firmware file",
  "大小": "Size",
  "字节": "bytes",
  "整包 CRC": "File CRC",
  "开始升级": "Start update",
  "重新检查": "Check again",
  "确认升级": "Confirm update",
  "文件版本": "File version",
  "版本从 {from} 降低到 {to}，是否确认降级升级？": "The version will drop from {from} to {to}. Confirm this downgrade?",
  "确认降级升级": "Confirm downgrade",
  "充电已停止": "Charging is stopped",
  "充电还未停止": "Charging is still on",
  "WiFi 已关闭": "Wi-Fi is off",
  "WiFi 还未关闭": "Wi-Fi is still on",
  "OCPP 已关闭": "OCPP is off",
  "OCPP 还未关闭": "OCPP is still on",
  "还有项目没有关掉，不能开始发送": "Something is still on, so sending cannot start",
  "正在发送固件": "Sending firmware",
  "已发送 {done} / {total}": "Sent {done} / {total}",
  "{m}分{s}秒": "{m} min {s} sec",
  "传输文件错误，请靠近充电桩重试": "File transfer failed. Move closer to the charger and try again",
  "文件已校验通过，充电桩正在升级并重启": "The file checked out. The charger is updating and will restart",
  "这个文件不是本充电桩的应用固件": "This file is not an application image for this charger",
  "文件不能超过 200 KB": "The file must be 200 KB or smaller",
  "充电桩没有进入升级": "The charger did not enter update mode",
  "发送过程中充电桩亮白灯快闪": "The charger blinks white quickly while the file is sending",
  "开": "On",
  "关": "Off",
  "保护设置": "Protection",
  "OCPP 服务器": "OCPP server",
  "平台地址": "Server address",
  "WiFi 配网": "Wi-Fi setup",
  "热点": "Hotspot",
  "开启 WiFi": "Wi-Fi",
  "关闭后不再连接热点，已保存的热点还在。OCPP 若开着会一起关掉。重新打开 WiFi 不会自动打开 OCPP": "When off, the charger does not join a hotspot. The saved hotspot stays. If OCPP is on, it turns off too. Turning Wi-Fi back on does not turn OCPP on",
  "正在打开 WiFi": "Turning Wi-Fi on",
  "正在关闭 WiFi": "Turning Wi-Fi off",
  "WiFi 已打开。断电后仍然有效": "Wi-Fi is on. Kept across power loss",
  "WiFi 已关闭。已保存的热点还在": "Wi-Fi is off. The saved hotspot stays",
  "已关闭 WiFi 和 OCPP。已保存的热点还在": "Wi-Fi and OCPP are off. The saved hotspot stays",
  "WiFi 开关没有保存": "The Wi-Fi switch was not saved",
  "开启 OCPP": "OCPP server",
  "关闭后不再连接服务器，已保存的地址还在": "When off, the charger does not contact the server. The saved address stays",
  "正在打开 OCPP": "Turning the OCPP server on",
  "正在关闭 OCPP": "Turning the OCPP server off",
  "OCPP 已打开。断电后仍然有效": "The OCPP server is on. Kept across power loss",
  "OCPP 已关闭。已保存的地址还在": "The OCPP server is off. The saved address stays",
  "OCPP 开关没有保存": "The OCPP switch was not saved",
  "充电记录": "Charge history",
  "订单号": "Order number",
  "未结束": "Not finished",
  "OCPP上报版本号": "OCPP reported version",
  "跟固件版本相同": "Same as the firmware",
  "打开后，连上 OCPP 平台时 BootNotification 使用下面手填的版本号。这不改充电桩自己的固件版本。手填值和固件版本相同，或者关掉，就上报固件版本。断电后仍然有效。": "When on, BootNotification sends the version typed below. This does not change the charger firmware. If the typed value matches the firmware, or this is off, the firmware version is sent. Kept across power loss.",
  "开启上报版本号": "Report this version",
  "关掉就始终上报固件版本": "Off always sends the firmware version",
  "OCPP固件版本显示号": "OCPP firmware version",
  "没有保存。版本号最长 20 位，只能是可见英文字符": "Not saved. Up to 20 visible characters",
  "已保存。连平台时按这个版本号上报，充电桩固件版本不变": "Saved. The platform gets this version. The charger firmware version stays the same",
  "这是上报给平台的版本号，改完点保存": "This is the version sent to the platform. Save after editing",
  "遥测": "Telemetry",
  "遥测串口每秒发送状态": "The telemetry port sends status every second",
  "充电桩配置": "Charger setup",
  "填写密码": "Password",
  "管理员密码": "Admin password",
  "还没有充电记录": "No charge history yet",
  "开始": "Start",
  "结束": "End",
  "时长": "Duration",
  "停止原因": "Stop",
  "启动渠道": "Started by",
  "特权卡": "Privilege card",
  "白名单卡": "Whitelist card",
  "平台刷卡": "Platform card",
  "APP远程": "App remote",
  "蓝牙": "Bluetooth",
  "调试口": "Debug port",
  "未知": "Unknown",
  "保存": "Save",
  "当前已配置": "Currently saved",
  "（无名称）": "(no name)",
  "搜索热点": "Scan for hotspots",
  "这是充电桩里保存的热点。要换热点再点搜索": "This is the hotspot saved on the charger. Scan only when you want to change it",
  "密码": "Password",
  "连接并保存": "Connect and save",
  "正在连接热点，请稍后": "Connecting to the hotspot. Please wait",
  "没有连上，可以再输入密码并连接": "Not connected. Enter the password and try again",
  "连接超时，可以再输入密码并连接": "Timed out. Enter the password and try again",
  "已连接热点": "Hotspot connected",
  "OCPP 地址": "OCPP address",
  "ws(s)://主机/路径": "ws(s)://host/path",
  "过压停止 (V)": "Overvoltage stop (V)",
  "欠压停止 (V)": "Undervoltage stop (V)",
  "打开后，遥测串口每秒发送一帧遥测。关闭后，这路串口不再发送任何遥测数据。断电后仍然有效。": "When on, the telemetry port sends one frame each second. When off, that port sends no telemetry. Kept across power loss.",
  "开启遥测": "Telemetry on",
  "关闭后上位机收不到状态": "When off, the host receives no status",
  "充电中": "Charging",
  "故障": "Fault",
  "用户停止": "Stopped by user",
  "刷卡停止": "Stopped by card",
  "蓝牙停止": "Stopped by Bluetooth",
  "远程停止": "Stopped remotely",
  "调试口停止": "Stopped from debug port",
  "故障停止": "Stopped by fault",
  "掉电停止": "Stopped by power loss",
  "温度传感器故障": "Temperature sensor fault",
  "计量故障": "Meter fault",
  "过压": "Overvoltage",
  "欠压": "Undervoltage",
  "过流": "Overcurrent",
  "时间未同步": "Time not synced",
  "WiFi 已连接": "Wi-Fi connected",
  "WiFi 连接中": "Wi-Fi connecting",
  "WiFi 连接失败": "Wi-Fi failed",
  "WiFi 未连接": "Wi-Fi down",
  "WiFi —": "Wi-Fi —",
  "未配置热点": "No hotspot saved",
  "OCPP 已连接": "OCPP connected",
  "OCPP 正在连接": "OCPP connecting",
  "OCPP 未连接": "OCPP not connected",
  "准备扫描": "Ready to scan",
  "请在手机 App 里打开": "Turn it on in the phone app",
  "正在打开遥测": "Turning telemetry on",
  "正在关闭遥测": "Turning telemetry off",
  "扫描失败，错误码 ": "Scan failed, error ",
  "已连接，正在发现服务": "Connected. Discovering services",
  "没有找到可收发的特征值": "No read/write characteristic found",
  "已连上，正在读取充电桩状态": "Connected. Reading charger status",
  "请先打开手机蓝牙": "Turn on Bluetooth on this phone",
  "这台手机不能扫描蓝牙": "This phone cannot scan for Bluetooth devices",
  "正在扫描": "Scanning",
  "没有蓝牙权限": "Bluetooth permission is missing",
  "这个充电桩已经不在附近": "This charger is no longer nearby",
  "需要蓝牙权限才能查找充电桩": "Bluetooth permission is required to find chargers",
  "蓝牙已断开": "Bluetooth disconnected",
  "发现服务失败": "Service discovery failed",
  "正在连接 ": "Connecting ",
  "正在连接并核对已保存的密码": "Connecting and checking the saved password",
  "请输入 6 位数字": "Enter 6 digits",
  "正在连接并核对": "Connecting and checking",
  "正在读取充电桩里的设置": "Reading the saved setting",
  "正在保存": "Saving",
  "正在读取充电桩里的开关": "Reading the saved switch",
  "正在搜索热点": "Scanning for hotspots",
  "输入密码后连接": "Enter the password to connect",
  "名称或密码不能用，最长 32 字节": "The name or password is not valid. 32 bytes maximum",
  "正在读取充电桩里的地址": "Reading the address saved on the charger",
  "地址需要是 ws(s)://主机/路径，最长 127 字节": "Use ws(s)://host/path, 127 bytes maximum",
  "正在读取保护设置": "Reading protection settings",
  "已保存，断电后仍然有效": "Saved. Kept across power loss",
  "没有保存": "Not saved",
  "遥测已打开。遥测串口每秒发送状态，断电后仍然有效": "Telemetry is on. The port sends status every second. Kept across power loss",
  "遥测已关闭。遥测串口不再发送遥测数据": "Telemetry is off. The port no longer sends telemetry",
  "遥测开关没有保存": "The telemetry switch was not saved",
  "没有保存。过压不超过 320 V，欠压不低于 100 V，且比过压至少低 10 V": "Not saved. Overvoltage must be at most 320 V, undervoltage at least 100 V, and at least 10 V below overvoltage",
  "已保存，正在重新连接": "Saved. Reconnecting",
  "搜索热点失败": "Hotspot scan failed",
  "正在搜索或连接，请稍等": "Scanning or connecting. Please wait",
  "没有保存成功": "Not saved",
  "保护设置读失败，再打开一次": "Could not read protection settings. Open this page again",
  "这是充电桩里的保护设置，改完点保存": "These are the settings stored on the charger. Change them, then save",
  "点一个热点，再填密码": "Pick a hotspot, then enter its password",
  "没有搜到热点": "No hotspot found",
  "正在核对密码": "Checking the password",
  "还没有地址。填好 ws(s):// 地址并保存后才会连接": "No address yet. Enter a ws(s):// address and save it before the charger connects",
  "这是充电桩里保存的地址，改完点保存": "This is the address stored on the charger. Change it, then save",
  "语言": "Language",
  "保存密码": "Save password",
  "保存在这台手机上，下次自动连接": "Keep it on this phone and connect automatically next time",
  "断网停充": "Stop if offline",
  "OCPP 掉线超时后停止充电": "Stop charging when OCPP stays offline",
  "断网时长 (秒)": "Offline time (s)",
  "允许 10 到 600 秒，默认 60": "10 to 600 seconds, 60 by default",
  "这是充电桩里保存的设置，改完点保存": "This is the setting stored on the charger. Change it, then save",
  "没有保存。时长只能是 10 到 600 秒": "Not saved. The time must be 10 to 600 seconds",
  "断网停止": "Offline stop",
  "重启": "Reboot",
  "确认重启": "Confirm reboot",
  "取消": "Cancel",
  "充电桩正在重启": "The charger is rebooting",
  "重启没有发出": "Reboot was not sent",
  "一键配置": "One-tap setup",
  "保存在手机上，可下发到任意一台同型号充电桩": "Saved on this phone and sent to any charger of this model",
  "这份配置存在这台手机上，不绑定某一台桩。连上同型号的充电桩后，都可以下发。": "This setup stays on this phone and is not tied to one charger. Send it to any connected charger of this model.",
  "从当前充电桩保存": "Save from this charger",
  "还没有一键配置": "No saved setups yet",
  "把「{name}」下发到当前连接的充电桩？": "Send “{name}” to the connected charger?",
  "确认删除这份配置？": "Delete this setup?",
  "确认下发": "Send",
  "确认删除": "Delete",
  "重命名": "Rename",
  "下发到当前充电桩": "Send to this charger",
  "删除": "Delete",
  "配置名称": "Setup name",
  "例如 门店标准": "For example, Shop standard",
  "保存名称": "Save name",
  "开始读取": "Start reading",
  "正在从当前充电桩读取": "Reading from this charger",
  "正在下发到当前充电桩": "Sending to this charger",
  "{done} / {total}": "{done} / {total}",
  "完成": "Done",
  "保存配置": "Save setup",
  "读取配置": "Read setup",
  "下发配置": "Send setup",
  "这个名称只存在手机上。读完后会出现在一键配置列表里。": "This name stays on the phone. After reading, it appears in the one-tap list.",
  "改的是手机上的名称，不连充电桩": "This only changes the name on the phone",
  "请填写名称，最长 32 个字": "Enter a name, up to 32 characters",
  "正在读取{name}": "Reading {name}",
  "正在设置{name}": "Setting {name}",
  "{name}读取成功": "{name} read",
  "{name}设置成功": "{name} set",
  "{name}读取失败：{reason}": "{name} was not read: {reason}",
  "{name}设置失败：{reason}": "{name} was not set: {reason}",
  "有项目没有读到，没有保存": "Some items were not read, so nothing was saved",
  "已保存到一键配置": "Saved to one-tap setups",
  "有项目没有写上": "Some items were not written",
  "下发完成": "Send finished",
  "网络设置": "Network",
  "OCPP设置": "OCPP",
  "这份配置里没有这一项": "This item is missing from the setup",
  "回复超时": "No reply",
  "写入后读回核对超时": "No reply when reading back",
  "读回的值和写入的不一样": "The value read back differs from what was written",
  "请把过压和欠压填成数字": "Enter numbers for overvoltage and undervoltage",
  "没有保存。过压必须大于欠压": "Not saved. Overvoltage must be higher than undervoltage",
  "没有保存。欠压不能低于 100 V": "Not saved. Undervoltage must be at least 100 V",
  "没有保存。过压不能超过 320 V": "Not saved. Overvoltage must be at most 320 V",
  "没有保存。过压至少要比欠压高 10 V": "Not saved. Overvoltage must be at least 10 V above undervoltage",
  "充电桩没有接受": "The charger did not accept it",
  "回复内容不能用": "The reply could not be used",
  "保护参数不能用": "The safety values cannot be used",
  "蓝牙WiFi版本": "Bluetooth/Wi-Fi version",
  "蓝牙/WiFi 模组的版本号和固件版本号": "Version and firmware version of the Bluetooth/Wi-Fi module",
  "这是充电桩里的蓝牙/WiFi 模组自己报告的版本，充电桩上电时读出来保存着。": "This is the version reported by the Bluetooth/Wi-Fi module inside the charger. The charger reads it at power-on and keeps it.",
  "模组版本号": "Module version",
  "模组固件版本号": "Module firmware version",
  "SDK 版本": "SDK version",
  "编译时间": "Build time",
  "版本信息": "Version info",
  "未知。充电桩还没有从模组读到版本，请稍后重新读取。": "Unknown. The charger has not read the version from the module yet. Read again later.",
  "正在读取": "Reading",
  "重新读取": "Read again",
};

const prefixes = {
  en: [
    ["WiFi 已连接", "Wi-Fi connected"],
    ["WiFi 连接中", "Wi-Fi connecting"],
    ["WiFi 连接失败", "Wi-Fi failed"],
    ["WiFi 未连接", "Wi-Fi down"],
    ["扫描失败，错误码 ", "Scan failed, error "],
    ["正在连接 ", "Connecting "],
  ],
  fr: [
    ["WiFi 已连接", "Wi-Fi connecté"],
    ["WiFi 连接中", "Connexion Wi-Fi"],
    ["WiFi 连接失败", "Échec Wi-Fi"],
    ["WiFi 未连接", "Wi-Fi déconnecté"],
    ["扫描失败，错误码 ", "Échec du scan, code "],
    ["正在连接 ", "Connexion à "],
  ],
  ja: [
    ["WiFi 已连接", "Wi-Fi 接続済み"],
    ["WiFi 连接中", "Wi-Fi 接続中"],
    ["WiFi 连接失败", "Wi-Fi 失敗"],
    ["WiFi 未连接", "Wi-Fi 未接続"],
    ["扫描失败，错误码 ", "スキャン失敗、コード "],
    ["正在连接 ", "接続中 "],
  ],
  de: [
    ["WiFi 已连接", "WLAN verbunden"],
    ["WiFi 连接中", "WLAN verbindet"],
    ["WiFi 连接失败", "WLAN fehlgeschlagen"],
    ["WiFi 未连接", "WLAN getrennt"],
    ["扫描失败，错误码 ", "Suche fehlgeschlagen, Code "],
    ["正在连接 ", "Verbinden mit "],
  ],
  es: [
    ["WiFi 已连接", "Wi-Fi conectado"],
    ["WiFi 连接中", "Conectando Wi-Fi"],
    ["WiFi 连接失败", "Wi-Fi falló"],
    ["WiFi 未连接", "Wi-Fi desconectado"],
    ["扫描失败，错误码 ", "Error de búsqueda, código "],
    ["正在连接 ", "Conectando con "],
  ],
  pt: [
    ["WiFi 已连接", "Wi-Fi ligado"],
    ["WiFi 连接中", "A ligar Wi-Fi"],
    ["WiFi 连接失败", "Falha de Wi-Fi"],
    ["WiFi 未连接", "Wi-Fi desligado"],
    ["扫描失败，错误码 ", "Falha na procura, código "],
    ["正在连接 ", "A ligar a "],
  ],
  ru: [
    ["WiFi 已连接", "Wi-Fi подключен"],
    ["WiFi 连接中", "Подключение Wi-Fi"],
    ["WiFi 连接失败", "Ошибка Wi-Fi"],
    ["WiFi 未连接", "Wi-Fi отключен"],
    ["扫描失败，错误码 ", "Ошибка поиска, код "],
    ["正在连接 ", "Подключение к "],
  ],
  hi: [
    ["WiFi 已连接", "Wi-Fi जुड़ा"],
    ["WiFi 连接中", "Wi-Fi जुड़ रहा है"],
    ["WiFi 连接失败", "Wi-Fi असफल"],
    ["WiFi 未连接", "Wi-Fi नहीं जुड़ा"],
    ["扫描失败，错误码 ", "स्कैन असफल, त्रुटि "],
    ["正在连接 ", "जुड़ रहा है "],
  ],
  ar: [
    ["WiFi 已连接", "Wi-Fi متصل"],
    ["WiFi 连接中", "Wi-Fi يتصل"],
    ["WiFi 连接失败", "فشل Wi-Fi"],
    ["WiFi 未连接", "Wi-Fi غير متصل"],
    ["扫描失败，错误码 ", "فشل البحث، الرمز "],
    ["正在连接 ", "جارٍ الاتصال بـ "],
  ],
  bn: [
    ["WiFi 已连接", "Wi-Fi যুক্ত"],
    ["WiFi 连接中", "Wi-Fi যুক্ত হচ্ছে"],
    ["WiFi 连接失败", "Wi-Fi ব্যর্থ"],
    ["WiFi 未连接", "Wi-Fi যুক্ত নয়"],
    ["扫描失败，错误码 ", "স্ক্যান ব্যর্থ, ত্রুটি "],
    ["正在连接 ", "যুক্ত হচ্ছে "],
  ],
  id: [
    ["WiFi 已连接", "Wi-Fi tersambung"],
    ["WiFi 连接中", "Wi-Fi menyambung"],
    ["WiFi 连接失败", "Wi-Fi gagal"],
    ["WiFi 未连接", "Wi-Fi terputus"],
    ["扫描失败，错误码 ", "Pemindaian gagal, kode "],
    ["正在连接 ", "Menyambung ke "],
  ],
  ur: [
    ["WiFi 已连接", "Wi-Fi جڑا"],
    ["WiFi 连接中", "Wi-Fi جڑ رہا ہے"],
    ["WiFi 连接失败", "Wi-Fi ناکام"],
    ["WiFi 未连接", "Wi-Fi نہیں جڑا"],
    ["扫描失败，错误码 ", "اسکین ناکام، خرابی "],
    ["正在连接 ", "جڑ رہا ہے "],
  ],
};

const hotspot = {
  en: (n) => "Found " + n + " hotspots",
  fr: (n) => n + " réseaux trouvés",
  ja: (n) => n + " 件のアクセスポイント",
  de: (n) => n + " Hotspots gefunden",
  es: (n) => n + " redes encontradas",
  pt: (n) => n + " redes encontradas",
  ru: (n) => "Найдено сетей: " + n,
  hi: (n) => n + " हॉटस्पॉट मिले",
  ar: (n) => "تم العثور على " + n + " نقاط اتصال",
  bn: (n) => n + "টি হটস্পট পাওয়া গেছে",
  id: (n) => "Ditemukan " + n + " hotspot",
  ur: (n) => n + " ہاٹ اسپاٹ ملے",
};

export const languages = [
  { id: "en", name: "English" },
  { id: "zh", name: "中文" },
  { id: "fr", name: "Français" },
  { id: "ja", name: "日本語" },
  { id: "de", name: "Deutsch" },
  { id: "es", name: "Español" },
  { id: "pt", name: "Português" },
  { id: "ru", name: "Русский" },
  { id: "hi", name: "हिन्दी" },
  { id: "ar", name: "العربية" },
  { id: "bn", name: "বাংলা" },
  { id: "id", name: "Indonesia" },
  { id: "ur", name: "اردو" },
];

const supportedLang = {};
languages.forEach((item) => {
  supportedLang[item.id] = true;
});

export function languageFromTag(tag) {
  const norm = String(tag == null ? "" : tag).trim().toLowerCase().replace(/_/g, "-");
  if (!norm || norm === "und") return "en";
  const primary = norm.split("-")[0];
  if (primary === "in" && supportedLang.id) return "id";
  if (supportedLang[primary]) return primary;
  return "en";
}

function applyVars(text, vars) {
  let out = text;
  if (!vars) return out;
  Object.keys(vars).forEach((key) => {
    out = out.split("{" + key + "}").join(String(vars[key]));
  });
  return out;
}

const packs = { en, fr, ja, de, es, pt, ru, hi, ar, bn, id, ur };
/* 时区设置的字符串在 packs-tz.js，4G 设置的在 packs-lte.js，M01（10 路）新加的在 packs-m01.js，
 * 蓝牙鉴权（锁定提示、恢复后重新核对）的在 packs-auth.js，固件兼容（固件比 App 旧、新，
 * 需升级固件）的在 packs-compat.js，都并进各语言的表。 */
[tzPacks, ltePacks, m01Packs, authPacks, compatPacks].forEach((extra) => {
  Object.keys(extra).forEach((lang) => { if (packs[lang]) Object.assign(packs[lang], extra[lang]); });
});
/* 设置页「保存」按钮上的结果和短原因（save-btn.js）：packs-savebtn.js。表里已经有的句子不覆盖。 */
Object.keys(saveBtnPacks).forEach((lang) => {
  if (!packs[lang]) return;
  Object.keys(saveBtnPacks[lang]).forEach((key) => { if (!packs[lang][key]) packs[lang][key] = saveBtnPacks[lang][key]; });
});

/* 这种语言的表里有没有这一句（不算回退到英文、不算按行首匹配）。测试用。 */
export function hasKey(lang, text) {
  return !!packs[lang] && Object.prototype.hasOwnProperty.call(packs[lang], text);
}
export function packKeys(lang) {
  return packs[lang] ? Object.keys(packs[lang]) : [];
}

export function translate(lang, text, vars) {
  const key = text == null ? "" : String(text);
  if (!key) return "";
  const pack = packs[lang];
  if (!pack) return applyVars(key, vars);
  if (pack[key]) return applyVars(pack[key], vars);
  const prefs = prefixes[lang] || [];
  for (let i = 0; i < prefs.length; i++) {
    if (key.indexOf(prefs[i][0]) === 0) {
      return prefs[i][1] + key.slice(prefs[i][0].length);
    }
  }
  const found = key.match(/^已找到 (\d+) 个热点$/);
  if (found && hotspot[lang]) return hotspot[lang](found[1]);
  if (key.indexOf("、") >= 0) {
    return key.split("、").map((part) => pack[part] || en[part] || part).join(", ");
  }
  if (en[key]) return applyVars(en[key], vars);
  return applyVars(key, vars);
}
