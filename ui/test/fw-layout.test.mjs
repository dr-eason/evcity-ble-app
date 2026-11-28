/* 固件分区布局（3.0.0，B 方案）的主机测试：
 *
 *     node --test APP/ui/test/fw-layout.test.mjs
 *
 * App 要认出文件是老分区（L1）还是新板（L2）的固件，认出桩是哪一种（OTAPREP 应答后面的
 * "L2"），对不上不发。老分区（L1）已经退役、不再发布 L1 的包，但现场还有 L1 的桩和残留的 L1
 * 文件：识别和拒发的用例都要留着（防变砖）。L2 的数字和固件的 config/flash_layout.h、wb2.c
 * 对照；L1 的数字是现场老桩的分区，固定不变，写在这里。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIRMWARE_MAX, LAYOUTS, LAYOUT_MARK_MAGIC, LAYOUT_MARK_OFFSET, firmwareLayout, layoutLabel,
  layoutMaxSize, layoutMismatchNote, pileLayoutFrom,
} from "../src/fw-layout.js";
import { languages, translate } from "../src/i18n.js";
import { layoutPacks } from "../src/packs-layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function put(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

/* 像链接器那样摆一个镜像：栈顶、复位向量，L2 的在 0x130 带标记。 */
function image({ size = 190 * 1024, sp = 0x20018000, entry, mark = null }) {
  const bytes = new Uint8Array(size).fill(0x5a);
  put(bytes, 0, sp);
  put(bytes, 4, entry | 1);
  if (mark) {
    put(bytes, LAYOUT_MARK_OFFSET, mark[0]);
    put(bytes, LAYOUT_MARK_OFFSET + 4, mark[1]);
  }
  return bytes;
}

const L1 = () => image({ entry: 0x080316bc });                                   /* 3.0.0 L1 实际的入口 */
const L2 = () => image({ entry: 0x08004138, mark: [LAYOUT_MARK_MAGIC, 2] });     /* 3.0.0 L2 实际的入口 */

test("认文件：老分区 L1、新板 L2、都不是", () => {
  assert.equal(firmwareLayout(L1()), 1);
  assert.equal(firmwareLayout(L2()), 2);
  /* 入口在 0x0800C000 之前、没有标记：不是 L1（老 App 也这么判）。 */
  assert.equal(firmwareLayout(image({ entry: 0x08004138 })), 0);
  /* 有标记但入口跑到 0x0800C000 以后：不是合格的 L2（老桩会收下它）。 */
  assert.equal(firmwareLayout(image({ entry: 0x0800c200, mark: [LAYOUT_MARK_MAGIC, 2] })), 0);
  /* 标记的布局号不认识。 */
  assert.equal(firmwareLayout(image({ entry: 0x08004138, mark: [LAYOUT_MARK_MAGIC, 3] })), 0);
  assert.equal(firmwareLayout(image({ entry: 0x08004138, mark: [LAYOUT_MARK_MAGIC, 1] })), 0);
  /* 栈顶不在 RAM、复位向量不是 Thumb。 */
  assert.equal(firmwareLayout(image({ entry: 0x080316bc, sp: 0x10000000 })), 0);
  const even = L1();
  put(even, 4, 0x080316bc);
  assert.equal(firmwareLayout(even), 0);
  assert.equal(firmwareLayout(new Uint8Array(4)), 0);
});

test("大小：L1 最多 200 KB，L2 最多 240 KB", () => {
  assert.equal(FIRMWARE_MAX, 240 * 1024);
  assert.equal(layoutMaxSize(1), 200 * 1024);
  assert.equal(layoutMaxSize(2), 240 * 1024);
  assert.equal(firmwareLayout(image({ size: 200 * 1024, entry: 0x080316bc })), 1);
  assert.equal(firmwareLayout(image({ size: 200 * 1024 + 4, entry: 0x080316bc })), 0);
  assert.equal(firmwareLayout(image({ size: 240 * 1024, entry: 0x08004138, mark: [LAYOUT_MARK_MAGIC, 2] })), 2);
  assert.equal(firmwareLayout(image({ size: 240 * 1024 + 4, entry: 0x08004138, mark: [LAYOUT_MARK_MAGIC, 2] })), 0);
});

test("认桩：OTAPREP / OTACHECK 后面的 L2", () => {
  assert.equal(pileLayoutFrom("ACK OTAPREP 1 1 1"), 1);          /* 老固件（L1，任何版本） */
  assert.equal(pileLayoutFrom("ACK OTAPREP 0 1 0"), 1);
  assert.equal(pileLayoutFrom("ACK OTAPREP 1 1 1 L2"), 2);
  assert.equal(pileLayoutFrom("ACK OTACHECK 0 0 1 L2"), 2);
  assert.equal(pileLayoutFrom("ACK OTACHECK 1 1 1"), 1);
  assert.equal(pileLayoutFrom("ACK OTASTART OK"), 0);
  assert.equal(pileLayoutFrom(""), 0);
});

test("L1 已退役，但残留的 L1 文件和老桩仍然认得出、仍然拒发", () => {
  /* 残留的 L1 文件：认成 1，不是 0（“不是固件”），更不是 2。 */
  assert.equal(firmwareLayout(L1()), 1);
  assert.notEqual(firmwareLayout(L1()), 2);
  /* 老桩（应答没有 L2 一段）+ 现在发布的 L2 文件：拒发。 */
  assert.notEqual(layoutMismatchNote(firmwareLayout(L2()), pileLayoutFrom("ACK OTAPREP 1 1 1")), "");
  /* 新板 + 残留的 L1 文件：拒发。 */
  assert.notEqual(layoutMismatchNote(firmwareLayout(L1()), pileLayoutFrom("ACK OTAPREP 1 1 1 L2")), "");
  /* 新板 + L2 文件：放行。 */
  assert.equal(layoutMismatchNote(firmwareLayout(L2()), pileLayoutFrom("ACK OTACHECK 1 1 1 L2")), "");
});

test("对不上就不发，四种组合", () => {
  assert.equal(layoutMismatchNote(1, 1), "");
  assert.equal(layoutMismatchNote(2, 2), "");
  assert.match(layoutMismatchNote(2, 1), /新板（L2）固件.*老分区（L1）/);
  assert.match(layoutMismatchNote(1, 2), /老分区（L1）固件.*新板（L2）/);
  assert.equal(layoutLabel(1), "L1");
  assert.equal(layoutLabel(2), "L2");
});

test("数字和固件的分区表一致", () => {
  const l2 = read("AC06/config/flash_layout.h");
  const num = (text, name) => {
    const m = text.match(new RegExp("#define\\s+" + name + "\\s+(0x[0-9A-Fa-f]+|\\d+)u"));
    assert.ok(m, name);
    return Number(m[1]);
  };
  /* 老分区（L1）：固件里已经没有它的分区头。现场老桩的数字固定，App 还靠它认残留的 L1 文件。 */
  assert.equal(LAYOUTS[1].base, 0x0800c000);
  assert.equal(LAYOUTS[1].size, 200 * 1024);
  assert.equal(LAYOUTS[1].entryEnd, 0x0803e000);
  /* 产品的分区头只有 L2，而且拒绝 -DAC06_LAYOUT=1。 */
  assert.equal(num(l2, "FLASH_LAYOUT_ID"), 2);
  assert.match(l2, /#if defined\(AC06_LAYOUT\) && \(AC06_LAYOUT != 2\)\s+#error/);
  /* L2 的入口上限正好是老分区的应用起始地址：老桩的固件因此拒收 L2 的包。 */
  assert.equal(num(l2, "FLASH_APP_ENTRY_END"), LAYOUTS[1].base);
  assert.equal(num(l2, "FLASH_APP_BASE"), LAYOUTS[2].base);
  assert.equal(num(l2, "FLASH_APP_SIZE"), LAYOUTS[2].size);
  assert.equal(num(l2, "FLASH_APP_ENTRY_END"), LAYOUTS[2].entryEnd);
  assert.equal(num(l2, "FLASH_LAYOUT_MARK_MAGIC"), LAYOUT_MARK_MAGIC);
  assert.equal(num(l2, "FLASH_LAYOUT_MARK_OFFSET"), LAYOUT_MARK_OFFSET);
  /* 固件在 OTAPREP / OTACHECK 后面报 L<布局号>（带标记的布局，产品只有 L2）。 */
  const wb2 = read("AC06/app/src/wb2.c");
  assert.match(wb2, /#ifdef FLASH_LAYOUT_MARK_MAGIC\s+snprintf\(line, sizeof\(line\), "%s %u %u %u L%u"/);
});

test("App.vue 用 fw-layout.js 判断文件，不再只认老分区", () => {
  const vue = read("APP/ui/src/App.vue");
  assert.ok(!/firmwareLooksValid/.test(vue));
  assert.match(vue, /firmwareLayout\(image\)/);
  assert.match(vue, /layoutMismatchNote\(otaFileLayout\.value, pileLayoutFrom\(line\)\)/);
  assert.match(vue, /t\('固件分区'\)/);
  assert.match(vue, /"文件不能超过 240 KB"/);
});

test("12 种语言的文案都齐，不是中文键、也不是英文原样", () => {
  const keys = Object.keys(layoutPacks.en);
  const langs = languages.map((item) => item.id).filter((id) => id !== "zh");
  assert.equal(langs.length, 12);
  for (const lang of langs) {
    assert.ok(layoutPacks[lang], lang + " 没有表");
    assert.deepEqual(Object.keys(layoutPacks[lang]).sort(), keys.slice().sort(), lang + " 的键不齐");
    for (const key of keys) {
      const out = translate(lang, key);
      assert.ok(out && out !== key, lang + " 没翻: " + key);
      if (lang !== "en") assert.notEqual(out, layoutPacks.en[key], lang + " 用了英文: " + key);
    }
  }
  assert.equal(translate("zh", "固件分区"), "固件分区");
});
