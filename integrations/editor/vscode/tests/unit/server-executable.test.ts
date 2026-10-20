import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareBundledExecutable,
  resolveServerExecutable,
} from "../../src/server-executable.ts";

/*
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,constraints
 */
const present = (...paths: string[]) => (path: string) => paths.includes(path);

test("the setting wins even when a shipped sigil exists", () => {
  assert.deepEqual(
    resolveServerExecutable({
      setting: "/opt/sigil/bin/sigil",
      extensionPath: "/ext",
      platform: "linux",
      exists: present("/ext/bin/sigil"),
    }),
    { command: "/opt/sigil/bin/sigil", source: "setting" },
  );
});

test("a blank setting means the shipped sigil, then the path", () => {
  for (const setting of [undefined, "", "   "]) {
    assert.deepEqual(
      resolveServerExecutable({
        setting,
        extensionPath: "/ext",
        platform: "darwin",
        exists: present("/ext/bin/sigil"),
      }),
      { command: "/ext/bin/sigil", source: "bundled" },
    );
    assert.deepEqual(
      resolveServerExecutable({
        setting,
        extensionPath: "/ext",
        platform: "darwin",
        exists: present(),
      }),
      { command: "sigil", source: "path" },
    );
  }
});

test("on Windows the shipped sigil is sigil.exe and the path fallback is sigil", () => {
  assert.deepEqual(
    resolveServerExecutable({
      setting: undefined,
      extensionPath: "C:\\Users\\a b\\ext",
      platform: "win32",
      exists: present("C:\\Users\\a b\\ext\\bin\\sigil.exe"),
    }),
    { command: "C:\\Users\\a b\\ext\\bin\\sigil.exe", source: "bundled" },
  );
  assert.deepEqual(
    resolveServerExecutable({
      setting: undefined,
      extensionPath: "C:\\ext",
      platform: "win32",
      exists: present(),
    }),
    { command: "sigil", source: "path" },
  );
});

test("a path with spaces and non-ASCII characters stays one command", () => {
  const extensionPath = "/home/Ω user/ext 空";
  const resolved = resolveServerExecutable({
    setting: undefined,
    extensionPath,
    platform: "linux",
    exists: present(`${extensionPath}/bin/sigil`),
  });
  assert.equal(resolved.command, `${extensionPath}/bin/sigil`);
});

test("a setting is trimmed", () => {
  assert.equal(
    resolveServerExecutable({
      setting: "  /x/sigil \n",
      extensionPath: "/ext",
      platform: "linux",
      exists: present(),
    }).command,
    "/x/sigil",
  );
});

test("a shipped sigil is made executable on Linux and macOS only", async () => {
  const calls: [string, number][] = [];
  const chmod = (path: string, mode: number) => {
    calls.push([path, mode]);
    return Promise.resolve();
  };
  const log: string[] = [];
  await prepareBundledExecutable(
    { command: "/ext/bin/sigil", source: "bundled" },
    "linux",
    chmod,
    (line) => log.push(line),
  );
  await prepareBundledExecutable(
    { command: "/ext/bin/sigil", source: "bundled" },
    "darwin",
    chmod,
    (line) => log.push(line),
  );
  await prepareBundledExecutable(
    { command: "C:\\ext\\bin\\sigil.exe", source: "bundled" },
    "win32",
    chmod,
    (line) => log.push(line),
  );
  await prepareBundledExecutable(
    { command: "/opt/sigil", source: "setting" },
    "linux",
    chmod,
    (line) => log.push(line),
  );
  await prepareBundledExecutable(
    { command: "sigil", source: "path" },
    "linux",
    chmod,
    (line) => log.push(line),
  );
  assert.deepEqual(calls, [
    ["/ext/bin/sigil", 0o755],
    ["/ext/bin/sigil", 0o755],
  ]);
  assert.deepEqual(log, []);
});

test("a failed chmod is logged and does not stop the start", async () => {
  const log: string[] = [];
  await prepareBundledExecutable(
    { command: "/ext/bin/sigil", source: "bundled" },
    "linux",
    () => Promise.reject(new Error("EPERM: operation not permitted")),
    (line) => log.push(line),
  );
  assert.equal(log.length, 1);
  assert(log[0].includes("/ext/bin/sigil") && log[0].includes("EPERM"));
});
