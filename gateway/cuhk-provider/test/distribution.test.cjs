"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ensureConfig, openCliEntry } = require("../../../bin/bridge-paths.cjs");
const { codexExecutable } = require("../../../bin/cli-discovery.cjs");
const { resolveCcrRoot } = require("../../../bin/cuhk-gateway.cjs");
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk distribution "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function file(destination, content = "") {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  return destination;
}
test("a new checkout initializes the example but preserves an existing config byte for byte", t => {
  const root = temporary(t);
  file(path.join(root, "config.example.json"), '{"gatewayEnabled":true}');
  const config = ensureConfig(root);
  assert.equal(fs.readFileSync(config, "utf8"), '{"gatewayEnabled":true}');
  fs.writeFileSync(config, '  {"privateSetting":"keep"}\r\n');
  ensureConfig(root);
  assert.equal(fs.readFileSync(config, "utf8"), '  {"privateSetting":"keep"}\r\n');
});
test("clean checkouts discover prepared dependencies, while legacy sibling/research runtimes keep priority", t => {
  const parent = temporary(t);
  const root = path.join(parent, "bridge with spaces");
  const opencli = file(path.join(root, ".dependencies/opencli/dist/src/main.js"));
  const ccr = path.join(root, ".dependencies/claude-code-router");
  file(path.join(ccr, "packages/core/dist/main/server.js"));
  const saved = process.env.CUHK_OPENCLI_ENTRY;
  delete process.env.CUHK_OPENCLI_ENTRY;
  try {
    assert.equal(openCliEntry(root), opencli);
    assert.equal(resolveCcrRoot(root, {}), ccr);
    const legacy = file(path.join(parent, "cuhk-ai-opencli/dist/src/main.js"));
    assert.equal(openCliEntry(root), legacy);
    file(path.join(root, "research/claude-code-router/packages/core/dist/main/server.js"));
    assert.equal(resolveCcrRoot(root, {}), path.join(root, "research/claude-code-router"));
  } finally { if (saved === undefined) delete process.env.CUHK_OPENCLI_ENTRY; else process.env.CUHK_OPENCLI_ENTRY = saved; }
});
test("npm-only Codex installations work without a desktop install and retain native argument handling", t => {
  const root = temporary(t);
  file(path.join(root, "codex.cmd"));
  const native = file(path.join(root, "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe"));
  assert.equal(codexExecutable({ PATH: root }), native);
  assert.equal(codexExecutable({ CUHK_CODEX_EXE: native }), native);
  assert.throws(() => codexExecutable({ CUHK_CODEX_EXE: path.join(root, "codex.cmd") }), /native/);
  assert.throws(() => codexExecutable({ PATH: path.join(root, "missing") }), /not found/);
});
