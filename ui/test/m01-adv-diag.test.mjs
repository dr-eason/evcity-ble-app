/* 蓝牙广播诊断（ADVGET / ACK ADV）的主机测试：
 *
 *     node --test APP/ui/test/adv-diag.test.mjs
 *
 * 应答的解析、和固件格式串核对、协议文档里的样例行、界面的接法。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ADV_FIELDS, advRows, parseAdv, readAdv } from "../src/m01/adv-diag.js";
import { hasKey, languages } from "../src/m01/i18n.js";
/* M01 仓库里的固件头文件和协议文档，拷了一份在 test/fixtures/m01/（见那里的 README.md）。 */
const fixture = (name) => readFileSync(new URL("./fixtures/m01/" + name, import.meta.url), "utf8");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const SAMPLE = "ACK ADV restarts=3 fail=1 resets=0 reason=periodic reboots=2 drops=37";

test("ACK ADV：六个字段都解析出来", () => {
  assert.deepEqual(parseAdv(SAMPLE),
    { restarts: 3, fail: 1, resets: 0, reason: "periodic", reboots: 2, drops: 37 });
  assert.deepEqual(parseAdv(SAMPLE + "\r\n").drops, 37);
  for (const reason of ["none", "periodic", "wifi", "retry", "mode", "name", "module-reboot", "transparent", "no-reply"]) {
    assert.equal(parseAdv(SAMPLE.replace("periodic", reason)).reason, reason);
  }
  /* 以后固件多加字段不碍事。 */
  assert.equal(parseAdv(SAMPLE + " extra=9").restarts, 3);
});

test("不是这条应答、缺字段、数字不对：null", () => {
  for (const line of ["", null, undefined, "ACK ADVGET AUTH", "ACK ADV", "ACK MODVER 0",
    "ACK ADV restarts=3 fail=1 resets=0 reason=periodic reboots=2",
    "ACK ADV restarts=x fail=1 resets=0 reason=periodic reboots=2 drops=0",
    "ACK ADV restarts=3 fail=1 resets=0 reason=BAD! reboots=2 drops=0",
    "ADV restarts=3 fail=1 resets=0 reason=periodic reboots=2 drops=37"]) {
    assert.equal(parseAdv(line), null, String(line));
  }
});

test("协议文档里有这条命令和样例行，样例行解析得出来", () => {
  const doc = fixture("M01蓝牙协议.md");
  assert.ok(doc.includes("ADVGET"));
  const sample = doc.match(/ACK ADV restarts=\d+[^\n`]*/);
  assert.ok(sample);
  assert.ok(parseAdv(sample[0]) !== null, sample[0]);
});

test("readAdv：读到、老固件不回、连接没了", async () => {
  const ok = await readAdv({ ask: async (cmd, accept) => (accept(SAMPLE) ? SAMPLE : null), alive: () => true });
  assert.equal(ok.state, "ok");
  assert.equal(ok.diag.restarts, 3);
  let asked = 0;
  const silent = await readAdv({ ask: async () => { asked++; return null; }, alive: () => true });
  assert.equal(silent.state, "silent");
  assert.equal(asked, 2);
  const gone = await readAdv({ ask: async () => null, alive: () => false });
  assert.equal(gone.state, "gone");
});

test("界面：六行，名字 12 种语言都有；App.vue 在模组版本页读它", () => {
  const rows = advRows(parseAdv(SAMPLE));
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((row) => row.value), ["3", "1", "0", "2", "37", "periodic"]);
  assert.deepEqual(advRows(null), []);
  for (const item of languages) {
    if (item.id === "zh") continue;
    for (const row of rows) assert.ok(hasKey(item.id, row.label), item.id + " " + row.label);
  }
  const vue = read("APP/ui/src/m01/M01App.vue");
  assert.match(vue, /readAdv\(\{ ask, alive \}\)/);
  assert.match(vue, /if \(parseAdv\(line\) !== null\) return;/);
  assert.ok(vue.includes("t('蓝牙广播诊断')"));
});
