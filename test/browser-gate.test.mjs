// The browser run must refuse to launch unless a person allowed it. PATH and
// the install folders are left out, so a broken gate finds no browser to start.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("test:browser refuses to launch without the operator's flag", () => {
  const { status, stderr } = spawnSync(process.execPath, ["test/browser/run.mjs"], {
    encoding: "utf8",
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  assert.equal(status, 1);
  assert.match(stderr, /browser_launch_disabled/);
});
