/* iOS 上的 window.EVC。Android 是 WebView.addJavascriptInterface 给的同名对象，方法名、参数、
 * 返回值都照 MainActivity.java 的 Bridge 来，所以 Vue 界面一行不用改。
 *
 * 原生在页面开始加载前注入三段，顺序是：
 *   1. window.__evcInit = { locale, gate, mock, nativeFilePicker };
 *   2. 本文件；
 *   3. mock-evc.js（只在 Mock BLE 模式）。
 *
 * WKWebView 的 postMessage 是异步的，没有返回值。三个要同步返回的方法这样做：
 *   locale()   → 加载页面时原生写进 __evcInit 的系统语言；
 *   loadGate() → 加载页面时原生把存着的密码表整张写进 __evcInit.gate，saveGate 同时改这张表和原生；
 *   mtu()      → 原生每次协商出新值就调 __evcNative.setMtu()。 */
(function () {
  "use strict";
  if (window.EVC) return;

  var init = window.__evcInit || {};
  var gate = {};
  var key;
  if (init.gate && typeof init.gate === "object") {
    for (key in init.gate) {
      if (Object.prototype.hasOwnProperty.call(init.gate, key)) gate[key] = String(init.gate[key]);
    }
  }
  var mtu = 23;
  var mockLink = null;
  var pickTarget = null;

  function handler() {
    try {
      return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.evc;
    } catch (e) {
      return null;
    }
  }
  function post(name, args) {
    var h = handler();
    if (!h) return;
    try { h.postMessage({ m: name, a: args || [] }); } catch (e) {}
  }
  /* 蓝牙相关的调用：Mock 模式交给页面里的假充电桩，否则交给原生。 */
  function ble(name, args) {
    if (mockLink) {
      try { mockLink.call(name, args || []); } catch (e) {}
      return;
    }
    post(name, args);
  }

  window.EVC = {
    scan: function () { ble("scan"); },
    stopScan: function () { ble("stopScan"); },
    connect: function (address) { ble("connect", [address == null ? "" : String(address)]); },
    disconnect: function () { ble("disconnect"); },
    send: function (text) {
      if (text == null) return;
      text = String(text);
      if (!text.length || text.indexOf("\n") >= 0 || text.indexOf("\r") >= 0) return;
      ble("send", [text]);
    },
    saveGate: function (address, pin) {
      if (address == null || !String(address).length) return;
      address = String(address);
      pin = pin == null ? "" : String(pin);
      if (pin.length === 6) gate[address] = pin;
      else delete gate[address];
      post("saveGate", [address, pin]);
    },
    loadGate: function (address) {
      if (address == null || !String(address).length) return "";
      var pin = gate[String(address)];
      return typeof pin === "string" ? pin : "";
    },
    locale: function () { return typeof init.locale === "string" ? init.locale : ""; },
    mtu: function () { return mockLink ? mockLink.mtu() : mtu; },
    linkFast: function (on) { ble("linkFast", [!!on]); },
    heartbeatTime: function (on) { ble("heartbeatTime", [!!on]); },
    restart: function () {
      if (mockLink) {
        try { mockLink.call("shutdown", []); } catch (e) {}
      }
      post("restart");
    }
  };

  /* 原生调页面用的入口。 */
  window.__evcNative = {
    setMtu: function (value) {
      value = Number(value);
      if (value >= 23) mtu = value;
    },
    useLink: function (link) { mockLink = link || null; },
    /* 后备的文件选择（见下）：原生读完文件后把名字和 base64 内容交回来。取消时 name 是 null。 */
    filePicked: function (name, base64) {
      var input = pickTarget;
      pickTarget = null;
      if (!input || typeof name !== "string" || typeof base64 !== "string") return;
      try {
        var bin = atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var file = new File([bytes], name, { type: "application/octet-stream" });
        var box = new DataTransfer();
        box.items.add(file);
        input.files = box.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
    }
  };

  /* 固件升级选文件：界面用的是 <input type="file">，WKWebView 自己会弹系统的选择菜单，
   * 默认就走那条路。只有在 Info.plist 里把 EVCNativeFilePicker 打开时才走这里：
   * 拦下那次点击，让原生直接打开「文件」App 的选择器。 */
  if (init.nativeFilePicker && handler()) {
    document.addEventListener("click", function (event) {
      var el = event.target;
      if (!el || el.tagName !== "INPUT" || el.type !== "file") return;
      event.preventDefault();
      event.stopPropagation();
      pickTarget = el;
      post("pickFile");
    }, true);
  }

  /* 输入框字号小于 16px 时 iOS 会在聚焦时自动放大页面，之后缩不回去。Android 没有这个行为，
   * 这里把缩放锁住，保持和 Android 一样。 */
  function lockZoom() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    var content = meta.getAttribute("content") || "";
    if (content.indexOf("user-scalable") >= 0) return;
    meta.setAttribute("content", content + ",maximum-scale=1,user-scalable=no");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lockZoom);
  else lockZoom();
})();
