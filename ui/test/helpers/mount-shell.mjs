/* 在 node 里把合并后的 App.vue（外壳 + AC06 页面）和 m01/M01App.vue 一起跑起来，给路由的主机测试用。
 * 做法照 M01 仓库的 test/helpers/mount-app.mjs：@vue/compiler-sfc 编成模块（模板内联），挂在一个
 * 极简的渲染器上，元素就是普通对象，点按钮就是调它的 onClick。window.EVC 是假的手机那一层：
 * 记下 setProfile / connect / disconnect / send，由测试决定怎么回（vm.handle 喂回去）。
 *
 * 计时器要由调用方先用 node:test 的 mock.timers 接管，再调用 mountShell()。 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, compileScript } from "@vue/compiler-sfc";
import { createRenderer } from "vue";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../src");
const VUE_URL = import.meta.resolve("vue");

let compiled = null;
let current = null;

function compileOne(file, dir, rewrite) {
  const source = readFileSync(file, "utf8");
  const { descriptor } = parse(source, { filename: file });
  const out = compileScript(descriptor, {
    id: "shell-test-" + file.length, inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } },
  });
  return rewrite(out.content).replace(/from "vue"/g, "from " + JSON.stringify(VUE_URL));
}
const url = (path) => JSON.stringify(pathToFileURL(path).href);

async function loadShell() {
  if (compiled) return compiled;
  const dir = mkdtempSync(resolve(tmpdir(), "ac06-shell-"));
  const stub = resolve(dir, "privacy-stub.mjs");
  writeFileSync(stub, "export default { render() { return null; } };\n");
  const m01File = resolve(dir, "M01App.mjs");
  writeFileSync(m01File, compileOne(resolve(SRC, "m01/M01App.vue"), dir, (code) => code
    .replace(/from "\.\.\/PrivacyPolicy\.vue"/g, "from " + url(stub))
    .replace(/from "\.\.\/([^"]+)"/g, (m, f) => "from " + url(resolve(SRC, f)))
    .replace(/from "\.\/([^"]+)"/g, (m, f) => "from " + url(resolve(SRC, "m01", f)))));
  const appFile = resolve(dir, "App.mjs");
  writeFileSync(appFile, compileOne(resolve(SRC, "App.vue"), dir, (code) => code
    .replace(/from "\.\/PrivacyPolicy\.vue"/g, "from " + url(stub))
    .replace(/from "\.\/m01\/M01App\.vue"/g, "from " + url(m01File))
    .replace(/from "\.\/([^"]+)"/g, (m, f) => "from " + url(resolve(SRC, f)))));
  compiled = (await import(pathToFileURL(appFile).href)).default;
  return compiled;
}

function el(tag) {
  return {
    tag, children: [], props: {}, parent: null, text: "", value: "", checked: false,
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    removeEventListener() {},
    listeners: {},
  };
}
const nodeOps = {
  createElement: (tag) => el(tag),
  createText: (text) => ({ tag: "#text", text, parent: null }),
  createComment: (text) => ({ tag: "#comment", text, parent: null }),
  setText: (node, text) => { node.text = text; },
  setElementText: (node, text) => {
    node.children.forEach((c) => { c.parent = null; });
    node.children = text ? [{ tag: "#text", text, parent: node }] : [];
  },
  insert: (child, parent, anchor) => {
    if (child.parent) nodeOps.remove(child);
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i >= 0) parent.children.splice(i, 0, child);
    else parent.children.push(child);
    child.parent = parent;
  },
  remove: (child) => {
    const p = child.parent;
    if (!p) return;
    const i = p.children.indexOf(child);
    if (i >= 0) p.children.splice(i, 1);
    child.parent = null;
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => {
    const p = node.parent;
    if (!p) return null;
    return p.children[p.children.indexOf(node) + 1] || null;
  },
  patchProp: (node, key, prev, next) => {
    if (key === "value") node.value = next;
    else if (key === "checked") node.checked = !!next;
    node.props[key] = next;
  },
  querySelector: () => null,
  setScopeId() {},
  insertStaticContent() { throw new Error("static content"); },
};

export function textOf(node) {
  if (!node) return "";
  if (node.tag === "#text") return node.text;
  if (node.tag === "#comment") return "";
  return (node.children || []).map(textOf).join("");
}
function findAll(node, pred, out = []) {
  if (!node || node.tag === "#text" || node.tag === "#comment") return out;
  if (pred(node)) out.push(node);
  node.children.forEach((c) => findAll(c, pred, out));
  return out;
}
function classOf(node) {
  const c = node.props.class;
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : Object.keys(x || {}).filter((k) => x[k]).join(" "))).join(" ");
  if (typeof c === "object") return Object.keys(c).filter((k) => c[k]).join(" ");
  return String(c);
}

/* opts.pins：{ 地址: 密码 }，手机那一层存着的密码（loadGate）。opts.store：预先放进 localStorage 的。
 * 返回 { vm, root, calls, sent, store, text(), click(), byClass() }。calls 是对 window.EVC 的
 * 每一次调用 [名字, 参数]。 */
export async function mountShell(opts = {}) {
  const App = await loadShell();
  const calls = [];
  const sent = [];
  const store = new Map(Object.entries(opts.store || {}));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  globalThis.document = {
    documentElement: { lang: "", dir: "", setAttribute() {} },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
  globalThis.window = globalThis;
  globalThis.scrollTo = () => {};
  const pins = Object.assign({}, opts.pins || {});
  const evc = {
    send(text) { sent.push(text); calls.push(["send", text]); if (opts.onSend) opts.onSend(text); },
    scan() { calls.push(["scan"]); }, stopScan() { calls.push(["stopScan"]); }, restart() {},
    disconnect() { calls.push(["disconnect"]); if (opts.onDisconnect) opts.onDisconnect(); },
    linkFast() {}, heartbeatTime() {},
    setProfile(which) { calls.push(["setProfile", which]); },
    connect(addr) { calls.push(["connect", addr]); if (opts.onConnect) opts.onConnect(addr); },
    loadGate: (addr) => pins[addr] || "",
    saveGate(addr, pin) { if (pin) pins[addr] = pin; else delete pins[addr]; },
    locale: () => "zh-CN",
    mtu: () => 247,
  };
  globalThis.EVC = evc;
  if (current && current.close) current.close();
  const root = el("div");
  const { createApp } = createRenderer(nodeOps);
  const app = createApp(App);
  const vm = app.mount(root);
  const find = (pred) => findAll(root, pred);
  let closed = false;
  current = {
    vm, root, calls, sent, store, evc,
    close() {
      if (closed) return;
      closed = true;
      evc.send = () => {};
      app.unmount();
    },
    text: () => textOf(root),
    buttons: (pred) => find((n) => n.tag === "button" && (!pred || pred(n))),
    inputs: () => find((n) => n.tag === "input"),
    click(match) {
      const hit = find((n) => n.tag === "button" &&
        (typeof match === "function" ? match(n) : textOf(n).includes(match)));
      if (!hit.length) throw new Error("没有这个按钮: " + match);
      const fn = hit[0].props.onClick;
      if (typeof fn !== "function") throw new Error("按钮没有 onClick: " + match);
      fn({ stopPropagation() {} });
      return hit[0];
    },
    byClass: (cls) => find((n) => classOf(n).split(/\s+/).includes(cls)),
  };
  return current;
}
