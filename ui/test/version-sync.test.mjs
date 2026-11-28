/* 统一版本号：AC06 固件、M01 固件、蓝牙 App（Android + iOS）永远是同一个版本号，唯一来源是仓库根的
 * VERSION 文件。这里跑仓库的 tools/version/check_version.py（任何一处不一样就失败），再核对界面里
 * M01 模块拿来和固件比的版本、测试夹具里那份 M01 固件头文件。
 *
 *     node --test APP/ui/test/version-sync.test.mjs
 *
 * 公开镜像仓 evcity-ble-app 里只有 ui/ 和 ios/，没有 VERSION 和 tools/：那里整份跳过。 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "../src/m01/fw-compat.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const versionFile = resolve(root, "VERSION");
const checker = resolve(root, "tools/version/check_version.py");
const inMonorepo = existsSync(versionFile) && existsSync(checker);
const skip = inMonorepo ? false : "不在 AC-V2 单仓里（没有 VERSION / tools/version）";
const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["--version"]).status === 0);
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("VERSION 的写法：主.次.修订，每一段一位数字", { skip }, () => {
  assert.match(read("VERSION"), /^\d\.\d\.\d\n$/);
});

test("check_version.py：每一处写版本的地方都等于 VERSION", { skip: skip || (python ? false : "没有 python3") }, () => {
  const out = spawnSync(python, ["-B", checker], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /全部一致/);
});

test("界面里的版本：M01 模块的 APP_VERSION、夹具里的 M01_FW_VERSION、AC06_FW_VERSION 都是 VERSION", { skip }, () => {
  const unified = read("VERSION").trim();
  assert.equal(APP_VERSION, unified);
  const fixture = readFileSync(resolve(here, "fixtures/m01/app_config.h"), "utf8");
  assert.equal(/#define M01_FW_VERSION\s+"([^"]+)"/.exec(fixture)[1], unified);
  assert.equal(/#define M01_FW_VERSION\s+"([^"]+)"/.exec(read("M01/user/inc/app_config.h"))[1], unified);
  assert.equal(/#define AC06_FW_VERSION\s+"([^"]+)"/.exec(read("AC06/user/inc/app_config.h"))[1], unified);
});

test("夹具是仓库里 M01 文件的原样拷贝（set_version.py 负责同步）", { skip }, () => {
  for (const [name, src] of [
    ["app_config.h", "M01/user/inc/app_config.h"],
    ["ble_caps.h", "M01/app/inc/ble_caps.h"],
    ["M01蓝牙协议.md", "M01/文档/04-协议/M01蓝牙协议.md"],
    ["App固件兼容框架.md", "M01/文档/04-协议/App固件兼容框架.md"],
  ]) {
    assert.equal(readFileSync(resolve(here, "fixtures/m01", name), "utf8"), read(src), name + " 和 " + src + " 不一样：跑 python3 tools/version/set_version.py --sync");
  }
});

test("版本号写错一处，check_version.py 报出文件和值", { skip: skip || (python ? false : "没有 python3") }, () => {
  /* 不动仓库：让脚本库在内存里扫一份改过的拷贝太绕，这里直接问库函数。 */
  const code = [
    "import sys",
    "sys.path.insert(0, sys.argv[1])",
    "import versions",
    "bad = versions.scan(versions.REPO, '9.9.9')",
    "print(len(bad))",
    "print('\\n'.join(b[0] for b in bad))",
  ].join("\n");
  const out = execFileSync(python, ["-B", "-c", code, resolve(root, "tools/version")], { encoding: "utf8" });
  const lines = out.trim().split("\n");
  assert.ok(Number(lines[0]) >= 8, out);
  for (const file of ["AC06/user/inc/app_config.h", "M01/user/inc/app_config.h", "APP/android/AndroidManifest.xml",
    "APP/ios/Config/Base.xcconfig", "APP/ui/src/m01/fw-compat.js"]) {
    assert.ok(lines.includes(file), file + " 没有被报出来");
  }
});
