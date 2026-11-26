/* 各版 M01 固件在蓝牙上的样子，给兼容框架的测试用。
 *
 * COMMANDS：各版认的命令，取自各版 wb2.c 的 ble_is_command()：05b5283（1.0.0）、20ede4e（1.1.0）、
 * 7f987eb（1.2.0）、87bbc44（1.3.0）、a63c57b（1.3.2）。"ORDGET\t" 是带参数的翻页写法。
 * 1.3.3（全部停止逐路停，c978b09）的命令和 1.3.2 一样，也没有能力位；1.3.4 起的命令也和 1.3.2
 * 一样，多的只是 ACK SYS 的能力位。
 *
 * createPile(version, opts)：一台模拟的桩，按这一版的规矩回 App 发的命令；不认的命令不回任何
 * 东西（和真固件一样）。只回兼容测试用得到的那些。 */
import { crc16 } from "../../src/m01/port-board.js";
import { compareVersion } from "../../src/m01/fw-compat.js";

const BASE_1_0_0 = ["START\t", "STOP\t", "STATUS", "HB", "HB\t", "PORTGET\t", "PORTSEL\t", "PLIMGET", "PLIMSET\t",
  "WSCAN", "WCFGGET", "WJOIN\t", "WPASSGET", "WSAVE\t", "OCPPGET", "OCPPSET\t", "CFGGET", "CFGSET\t", "TELGET",
  "TELSET\t", "WIFISWGET", "WIFISWSET\t", "OCPPSWGET", "OCPPSWSET\t", "NETSTOPGET", "NETSTOPSET\t", "REBOOT",
  "OCFWGET", "OCFWSET\t", "MODVERGET", "CARDGET", "CARDSET\t", "AUTH\t", "TIMESET\t", "TZGET", "TZSET\t", "TIMEGET",
  "LTEGET", "LTESET\t", "APNGET", "APNSET\t", "LTESTAT", "LTECELL", "ORDGET", "OTAPREP", "OTACHECK", "OTAEND",
  "OTAABORT", "OTASTART\t", "OTADATA\t"];
export const COMMANDS = {
  "1.0.0": BASE_1_0_0,
  "1.1.0": [...BASE_1_0_0, "PAYGET", "PAYSET\t"],
  "1.2.0": [...BASE_1_0_0, "PAYGET", "PAYSET\t", "PARGET", "PARSET\t", "ORDGET\t"],
  "1.3.0": [...BASE_1_0_0, "PAYGET", "PAYSET\t", "PARGET", "PARSET\t", "ORDGET\t", "ADVGET"],
  "1.3.2": [...BASE_1_0_0.filter((c) => c !== "CARDGET" && c !== "CARDSET\t"),
    "PAYGET", "PAYSET\t", "PARGET", "PARSET\t", "ORDGET\t", "ADVGET", "SNAPGET\t"],
};
COMMANDS["1.3.3"] = COMMANDS["1.3.2"];
/* App 里要看能力才发的命令。 */
export const GATED = { "PAYGET": "payRules", "PAYSET\t": "payRules", "PARGET": "parallel", "PARSET\t": "parallel",
  "ORDGET\t": "orderPaging", "ADVGET": "advDiag", "SNAPGET\t": "snapshot" };
export const OLD = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.3.2", "1.3.3"];

/* 这一版认的命令表（1.3.3 及以后按 1.3.2）。 */
export function commandsOf(version) {
  if (COMMANDS[version]) return COMMANDS[version];
  return compareVersion(version, "1.3.2") >= 0 ? COMMANDS["1.3.2"] : COMMANDS["1.0.0"];
}
/* 这一条命令这一版认不认：行首和表里一样（带参数的到第一个制表符）。 */
export function knows(version, command) {
  const tab = command.indexOf("\t");
  const head = tab < 0 ? command : command.slice(0, tab + 1);
  return commandsOf(version).includes(head);
}

function hex4(n) {
  return ("000" + n.toString(16).toUpperCase()).slice(-4);
}
function snapLines(id) {
  return [1, 6].map((first) => {
    const body = "ACK SNAP\t" + id + "\t10\t" + first + "\t2304\t" + Array(5).fill("P,0,0,0,0,-").join(";");
    return body + "\t" + hex4(crc16(body));
  });
}

/* opts：caps（ACK SYS 第 11 个字段，不给就没有）、noSys（STATUS 不回 ACK SYS：读不到版本）、
 * wifiOn（WiFi 开关）。返回 { reply(command) → 要回的几行, log: 收到的命令 }。 */
export function createPile(version, opts = {}) {
  const log = [];
  const at = (v) => compareVersion(version, v) >= 0;
  const state = { wifiOn: !!opts.wifiOn, payModel: 1, fullW: 10, hold: 300 };
  function sys() {
    const tail = opts.caps === undefined ? "" : "\t" + opts.caps;
    return "ACK SYS\t" + version + "\t10\t230.4\t31\t1\t-\tDOWN\tOFF\t-\t-" + tail;
  }
  function status() {
    const out = ["FLT NONE", "WCFG DOWN -"];
    if (!opts.noSys) out.push(sys());
    out.push("ACK PORTS\t10\t" + Array(10).fill("P,0,0,0").join(";"));
    if (at("1.1.0")) out.push("ACK PORTX\t10\t" + Array(10).fill("0,-").join(";"));
    return out;
  }
  function pay() {
    const head = "ACK PAY\t3\t" + state.payModel + "\t" + state.fullW + "\t1\t100\t" + state.hold + "\t-";
    return at("1.3.2") ? head + "\t10\t3600" : head;
  }
  function reply(command) {
    log.push(command);
    if (!knows(version, command)) return [];
    const part = command.split("\t");
    switch (part[0]) {
      case "STATUS": return status();
      case "AUTH": return [part[1] === (opts.pin || "123456") ? "ACK AUTH OK" : "ACK AUTH FAIL"];
      case "TZGET": return ["ACK TZ 480"];
      case "TIMEGET": return ["ACK TIME 0 480"];
      case "TIMESET": return ["ACK TIMESET OK"];
      case "PLIMGET": return ["ACK PLIM\t10\t50\t2000\t" + Array(10).fill("800").join(",")];
      case "WIFISWGET": return ["WIFISW " + (state.wifiOn ? 1 : 0)];
      case "OCPPSWGET": return ["OCPPSW 0"];
      case "TELGET": return ["TEL 0"];
      case "OCFWGET": return ["OCFW 0\t" + version];
      case "NETSTOPGET": return ["NETSTOP 0 60"];
      case "LTEGET": return ["ACK LTE 0"];
      case "MODVERGET": return ["ACK MODVER 1\tat version:release/V4.18_P2.19.1"];
      case "WCFGGET": return ["WCFG DOWN -"];
      case "OCPPGET": return ["OCPP -"];
      case "ADVGET": return ["ACK ADV restarts=1 fail=0 resets=0 reason=periodic reboots=0 drops=0"];
      case "PAYGET": return [pay()];
      case "PAYSET": {
        /* 1.3.2 以前多一个参数整条 FAIL（ble_arg_u32 要求门槛后面就是行尾）。 */
        const max = at("1.3.2") ? 4 : 3;
        if (part.length < 3 || part.length > max || !part.slice(1).every((p) => /^\d+$/.test(p))) return ["ACK PAYSET FAIL"];
        state.payModel = Number(part[1]);
        state.fullW = Number(part[2]);
        if (part.length === 4) state.hold = Number(part[3]);
        return ["ACK PAYSET OK", pay()];
      }
      case "PARGET": return ["ACK PAR\t1\t10\t1"];
      case "SNAPGET": return snapLines(Number(part[1]));
      case "OCPPSET": return [/^wss:/i.test(part[1]) && !at("1.3.0") ? "ACK OCPPSET FAIL" : "ACK OCPPSET OK"];
      case "WSCAN":
        /* 1.3.2 以前 WiFi 开关关着时回 OK 却不扫。 */
        if (!at("1.3.2") && !state.wifiOn) return ["ACK WSCAN OK"];
        return ["ACK WSCAN OK", "AP -52 shop", "APDONE"];
      default: return [];
    }
  }
  return { reply, log, state };
}
