/* Mock BLE：页面里的一台假充电桩。iOS 模拟器没有真蓝牙，Mock 模式下 window.EVC 的蓝牙调用
 * （scan / connect / send …）不去原生，由这里按固件的格式回 devs / page / note / line。
 * 行的格式照 AC06/app/src/wb2.c（fill_stat、ble_send_stat 和各条 xxxGET / xxxSET 的应答）。
 *
 * 同一个文件也给电脑上的截图脚本用（tools/mock-web/shots.mjs），所以这里不能用原生的东西。
 *
 * 假桩的管理员密码：任意 6 位数字都算对，只有 000000 算错（用来看「密码不对」的界面）。 */
(function () {
  "use strict";
  var init = window.__evcInit || {};
  if (!init.mock || !window.__evcNative) return;

  var DEVICES = [
    { name: "EVC-AC06-0001", addr: "5A1C0001-7E57-4AC6-9F00-000000000001", rssi: -48 },
    { name: "EVC-AC06-0002", addr: "5A1C0002-7E57-4AC6-9F00-000000000002", rssi: -63 },
    { name: "EVC-AC06-0003", addr: "5A1C0003-7E57-4AC6-9F00-000000000003", rssi: -79 }
  ];
  var FW = "3.0.7";

  var queue = [];
  var draining = false;
  function drain() {
    draining = false;
    if (typeof window.onBle !== "function") {
      draining = true;
      setTimeout(drain, 50);
      return;
    }
    var list = queue;
    queue = [];
    for (var i = 0; i < list.length; i++) {
      try { window.onBle(list[i]); } catch (e) {}
    }
  }
  /* 和原生一样，事件总是晚一拍到页面，不在调用 EVC.xxx() 的那一刻同步回来。 */
  function emit(obj) {
    queue.push(obj);
    if (draining) return;
    draining = true;
    setTimeout(drain, 0);
  }
  function note(text) { emit({ t: "note", s: text }); }
  function page(name) { emit({ t: "page", s: name }); }
  function line(text) { emit({ t: "line", s: text }); }

  var scanning = false;
  var scanTimers = [];
  var found = [];
  var linked = null;      /* 连上的那台 */
  var connecting = false;
  var early = [];         /* 连上之前界面发来的命令 */
  var linkTimers = [];
  var ticker = null;
  var mtu = 23;

  var pile = null;
  function freshPile() {
    return {
      state: "CONNECTED", stop: "NONE", seconds: 0, wh: 0,
      wifiOn: true, ssid: "EVCITY-Office", ocppOn: false, ocppUrl: "",
      tel: false, lte: false, plug: false, gbStop: false, stopUntil: 0, imax: 32, phase: true, tz: 480,
      sched: { mode: 0, hour: 22, minute: 0, armed: 0 },
      netStop: { on: false, sec: 60 },
      qr: { on: false, text: "" }, ocfw: { on: false, text: "" },
      cards: ["A1B2C3D4", "", "", "", ""],
      cfg: { over: 264, under: 176, earth: true, leak: true, earthMin: 90 },
      apn: { proto: 0, apn: "cmnet" },
      ota: false
    };
  }

  function clearTimers(list) {
    while (list.length) clearTimeout(list.pop());
  }
  function emitDevs() {
    emit({ t: "devs", list: found.map(function (d) { return { name: d.name, addr: d.addr, rssi: d.rssi }; }) });
  }
  function stopScan() {
    scanning = false;
    clearTimers(scanTimers);
    emit({ t: "scan", on: false });
  }
  function beginScan() {
    found = [];
    emitDevs();
    scanning = true;
    emit({ t: "scan", on: true });
    note("正在扫描");
    DEVICES.forEach(function (dev, index) {
      scanTimers.push(setTimeout(function () {
        if (!scanning) return;
        found.push({ name: dev.name, addr: dev.addr, rssi: dev.rssi });
        emitDevs();
      }, 250 + index * 450));
    });
  }

  function iso() {
    return new Date().toISOString().slice(0, 19) + "Z";
  }
  function statLines() {
    var charging = pile.state === "CHARGING";
    var amps = charging ? "10.42 10.38 10.40" : "0.00 0.00 0.00";
    var power = charging ? "PW7180" : "PW0";
    var wifi = pile.wifiOn ? "UP" : "DOWN";
    var ssid = pile.ssid || "-";
    var lines = [];
    lines.push(pile.lte ? "ACK LTEB UP\t-85\tMOCK_NET" : "WCFG " + wifi + " " + ssid);
    /* 严格模式（原名新国标 6 秒停充）：设置、正在等车、离强制断开还剩多少毫秒（固件 wb2.c 的 LIVE 行）。
     * 假桩的车不理方波：等满 6.5 秒才停下来。 */
    var left = pile.stopUntil ? pile.stopUntil - Date.now() : 0;
    if (pile.stopUntil && left <= 0) {
      pile.stopUntil = 0;
      pile.state = "FINISHED"; pile.stop = "BLE";
      charging = false; amps = "0.00 0.00 0.00"; power = "PW0";
    }
    lines.push("LIVE 0.4 " + (charging ? "6.02" : "9.01") + " " + (pile.wifiOn ? "-52" : "-") + " " +
      (pile.gbStop ? "1" : "0") + " " + (left > 0 ? "1 " + Math.round(left) : "0 0"));
    lines.push("FLT NONE");
    lines.push("STAT " + pile.state + " NONE " + pile.seconds + " 229.8 230.4 231.1 " + amps + " " +
      pile.stop + " " + wifi + " " + (pile.ocppOn && pile.ocppUrl ? "BUSY" : "OFF") + " 0 " +
      (pile.plug ? "1" : "0") + " 0 " + Math.floor(pile.wh) + " " + FW + " " + power + " " + iso() + " " + ssid);
    return lines;
  }
  function pushStat() {
    statLines().forEach(line);
  }
  function tick() {
    if (!linked || !pile) return;
    if (pile.state === "CHARGING") {
      pile.seconds += 1;
      pile.wh += 7180 / 3600;
    }
    if (!pile.ota) pushStat();
  }

  function dropLink() {
    clearTimers(linkTimers);
    if (ticker) clearInterval(ticker);
    ticker = null;
    linked = null;
    pile = null;
    connecting = false;
    early = [];
  }
  function connect(address) {
    stopScan();
    var dev = null;
    for (var i = 0; i < found.length; i++) if (found[i].addr === address) dev = found[i];
    if (!dev) {
      note("这个充电桩已经不在附近");
      page("scan");
      return;
    }
    dropLink();
    connecting = true;
    page("charge");
    note("正在连接 " + dev.name);
    linkTimers.push(setTimeout(function () {
      page("charge");
      note("已连接，正在发现服务");
      linkTimers.push(setTimeout(function () {
        linked = dev;
        pile = freshPile();
        mtu = 247;
        connecting = false;
        note("已连上，正在读取充电桩状态");
        pushStat();
        ticker = setInterval(tick, 1000);
        var waiting = early;
        early = [];
        waiting.forEach(send);
      }, 300));
    }, 500));
  }

  function setAck(name, ok) {
    return "ACK " + name + (ok ? " OK" : " FAIL");
  }
  /* 一条命令 → 要回的行。不认识的命令不回，界面自己会等到超时。 */
  function reply(text) {
    var tab = text.indexOf("\t");
    var cmd = tab < 0 ? text : text.slice(0, tab);
    var arg = tab < 0 ? [] : text.slice(tab + 1).split("\t");
    var num = parseInt(arg[0], 10);
    switch (cmd) {
      case "HB": return [];
      case "STATUS": return statLines();
      case "AUTH": return [/^\d{6}$/.test(arg[0] || "") && arg[0] !== "000000" ? "ACK AUTH OK" : "ACK AUTH FAIL"];
      case "START":
        if (pile.stopUntil) return ["ACK START REJECTED"];      /* 正在等车停：不受理 */
        pile.state = "CHARGING"; pile.stop = "NONE"; pile.seconds = 0; pile.wh = 0;
        return ["ACK START OK"];
      case "STOP":
        if (pile.state === "CHARGING" && pile.gbStop) {
          if (!pile.stopUntil) pile.stopUntil = Date.now() + 6500;    /* 再点不重新计时 */
        }
        else if (pile.state === "CHARGING") { pile.state = "FINISHED"; pile.stop = "BLE"; }
        return ["ACK STOP OK"];
      case "WCFGGET": return ["WCFG " + (pile.wifiOn ? "UP" : "DOWN") + " " + (pile.ssid || "-")];
      case "WSCAN":
        return ["ACK WSCAN OK", "AP -47 EVCITY-Office", "AP -61 EVCITY-Guest", "AP -74 Workshop-2.4G", "APDONE"];
      case "WJOIN":
        pile.ssid = arg[0] || pile.ssid; pile.wifiOn = true;
        return ["ACK WJOIN OK", "WIFISW 1", "WCFG UP " + pile.ssid];
      case "WSAVE": return ["ACK WSAVE OK"];
      case "WPASSGET": return ["ACK WPASSGET -"];
      case "CARDGET": return ["CARD\t" + pile.cards.join("\t")];
      case "CARDSET":
        if (num >= 0 && num < pile.cards.length) pile.cards[num] = arg[1] || "";
        return ["ACK CARDSET OK"];
      case "OCPPGET": return ["OCPP " + (pile.ocppUrl || "-")];
      case "OCPPSET": pile.ocppUrl = arg[0] || ""; return ["ACK OCPPSET OK"];
      case "ORDGET":
        var now = Math.floor(Date.now() / 1000);
        return [
          "ORD 0 " + (now - 90000) + " " + (now - 82800) + " 14360 1042 BLE 7200 BLE - -",
          "ORD 1 " + (now - 180000) + " " + (now - 176400) + " 7180 1040 DISCONNECTED 3600 CARD A1B2C3D4 -",
          "ORDDONE"
        ];
      case "SCHEDGET":
        return ["SCHED 1 " + pile.tz + " " + pile.sched.mode + " " + pile.sched.hour + " " +
          pile.sched.minute + " " + pile.sched.armed];
      case "SCHEDSET": return ["ACK SCHEDSET OK"];
      case "IMAXGET": return ["IMAX " + pile.imax];
      case "IMAXSET":
        if (!(num >= 6 && num <= 32)) return ["ACK IMAXSET FAIL"];
        pile.imax = num;
        return ["ACK IMAXSET OK"];
      case "PLUGGET": return ["ACK PLUGGET " + (pile.plug ? "1" : "0")];
      case "PLUGSET": pile.plug = arg[0] === "1"; return ["ACK PLUGSET OK"];
      case "GBSTOPGET": return ["ACK GBSTOPGET " + (pile.gbStop ? "1" : "0")];
      case "GBSTOPSET":
        if (arg[0] !== "0" && arg[0] !== "1") return ["ACK GBSTOPSET FAIL"];
        pile.gbStop = arg[0] === "1";
        return ["ACK GBSTOPSET OK"];
      case "TELGET": return ["TEL " + (pile.tel ? "1" : "0")];
      case "TELSET": pile.tel = arg[0] === "1"; return ["ACK TELSET OK"];
      case "WIFISWGET": return ["WIFISW " + (pile.wifiOn ? "1" : "0")];
      case "WIFISWSET": pile.wifiOn = arg[0] === "1"; return ["ACK WIFISWSET OK"];
      case "OCPPSWGET": return ["OCPPSW " + (pile.ocppOn ? "1" : "0")];
      case "OCPPSWSET": pile.ocppOn = arg[0] === "1"; return ["ACK OCPPSWSET OK"];
      case "NETSTOPGET": return ["NETSTOP " + (pile.netStop.on ? "1" : "0") + " " + pile.netStop.sec];
      case "NETSTOPSET": return ["ACK NETSTOPSET OK"];
      case "LTEGET": return ["ACK LTE " + (pile.lte ? "1" : "0")];
      case "LTESET": pile.lte = arg[0] === "1"; return ["ACK LTESET OK"];
      case "APNGET": return ["ACK APN " + pile.apn.proto + "\t" + pile.apn.apn];
      case "APNSET": return ["ACK APNSET OK"];
      case "PHASEGET": return ["PHASE " + (pile.phase ? "1" : "0")];
      case "PHASESET":
        /* 和固件 wb2.c 一样：只认 0 / 1；充电中改成另一个值回 BUSY，值没变照常 OK。 */
        if (arg.length !== 1 || (arg[0] !== "0" && arg[0] !== "1")) return ["ACK PHASESET FAIL"];
        if ((arg[0] === "1") !== pile.phase && pile.state === "CHARGING") return ["ACK PHASESET BUSY"];
        pile.phase = arg[0] === "1";
        return ["ACK PHASESET OK"];
      case "QRGET": return ["QR " + (pile.qr.on ? "1" : "0") + "\t" + pile.qr.text];
      case "QRSET": return ["ACK QRSET OK"];
      case "OCFWGET": return ["OCFW " + (pile.ocfw.on ? "1" : "0") + "\t" + pile.ocfw.text];
      case "OCFWSET": return ["ACK OCFWSET OK"];
      case "MODVERGET": return ["ACK MODVER 0"];
      case "TIMESET": return ["ACK TIMESET OK"];
      case "TZSET":
        if (num >= -720 && num <= 840) pile.tz = num;
        return ["ACK TZSET OK"];
      case "TZGET": return ["ACK TZ " + pile.tz];
      /* 屏幕语言（0–4）和屏幕颜色（0 红 … 6 紫，默认 2 黄），写法和固件 wb2.c 一样。 */
      case "SCRLANGGET": return ["ACK SCRLANG " + (pile.scrLang || 0)];
      case "SCRLANGSET":
        if (!/^[0-4]$/.test(arg[0] || "") || arg.length !== 1) return ["ACK SCRLANGSET FAIL"];
        pile.scrLang = Number(arg[0]);
        return ["ACK SCRLANGSET OK"];
      case "SCRTHEMEGET": return ["ACK SCRTHEME " + (pile.scrTheme === undefined ? 2 : pile.scrTheme)];
      case "SCRTHEMESET":
        if (!/^[0-6]$/.test(arg[0] || "") || arg.length !== 1) return ["ACK SCRTHEMESET FAIL"];
        pile.scrTheme = Number(arg[0]);
        return ["ACK SCRTHEMESET OK"];
      case "TIMEGET": return ["ACK TIME " + Math.floor(Date.now() / 1000) + " " + pile.tz];
      case "CFGGET":
        return ["CFG " + pile.cfg.over + " " + pile.cfg.under + " 10.50 7.50 4.50 1.50 " +
          (pile.cfg.earth ? "1" : "0") + " " + (pile.cfg.leak ? "1" : "0") + " 0 " + pile.cfg.earthMin];
      case "CFGSET": return ["ACK CFGSET OK"];
      case "REBOOT": return ["ACK REBOOT OK"];
      /* 固件升级：停充、WiFi、OCPP 三项都算已经停好；每一片都回 OK。 */
      case "OTAPREP": return ["ACK OTAPREP 1 1 1"];
      case "OTACHECK": return ["ACK OTACHECK 1 1 1"];
      case "OTASTART": pile.ota = true; return ["ACK OTASTART OK"];
      case "OTADATA":
        return [/^\d+$/.test(arg[0] || "") ? "ACK OTADATA " + arg[0] + " OK" : "ACK OTADATA FAIL"];
      case "OTAEND": pile.ota = false; return ["ACK OTAEND OK"];
      case "OTAABORT": pile.ota = false; return ["ACK OTAABORT OK"];
      default:
        return [];
    }
  }
  function send(text) {
    if (typeof text !== "string") return;
    /* 还在连接时界面就会发 AUTH。Android 是先排进发送队列，连上后发出去，这里也先留着。 */
    if (connecting && !linked) {
      early.push(text);
      return;
    }
    if (!linked || !pile) return;
    var lines = reply(text);
    if (!lines.length) return;
    /* 真桩隔几十毫秒才回。 */
    linkTimers.push(setTimeout(function () {
      if (!linked) return;
      lines.forEach(line);
    }, 40));
  }

  var link = {
    mtu: function () { return mtu; },
    call: function (name, args) {
      if (name === "scan") {
        if (scanning) stopScan();
        else beginScan();
      } else if (name === "stopScan") {
        stopScan();
      } else if (name === "connect") {
        connect(args[0]);
      } else if (name === "disconnect") {
        dropLink();
        page("scan");
        note("蓝牙已断开");
      } else if (name === "send") {
        send(args[0]);
      } else if (name === "shutdown") {
        clearTimers(scanTimers);
        scanning = false;
        dropLink();
      }
      /* linkFast、heartbeatTime：假桩用不上。 */
    }
  };
  window.__evcNative.useLink(link);
})();
