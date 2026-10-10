"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { openCliEntry } = require("../bin/bridge-paths.cjs");
const { resolveCcrRoot } = require("../bin/cuhk-gateway.cjs");
const { codexExecutable } = require("../bin/cli-discovery.cjs");
const failures = [];
function check(label, callback) {
  try { console.log(`OK ${label}: ${callback()}`); }
  catch (error) { failures.push(label); console.error(`FAIL ${label}: ${error.message}`); }
}
check("Node", () => {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ required");
  return process.version;
});
check("OpenCLI and this checkout's adapter", () => {
  const entry = openCliEntry(root);
  if (!fs.existsSync(entry)) throw new Error("Run scripts/setup.ps1, or set CUHK_OPENCLI_ENTRY");
  const result = spawnSync(process.execPath, [path.join(root, "bin/cuhk-opencli.mjs"), "cuhk-ai", "--help"], { encoding: "utf8", timeout: 30000 });
  if (result.error || result.status !== 0 || !result.stdout.includes("ask")) throw new Error(result.error?.message || result.stderr || "Adapter was not registered");
  return entry;
});
check("Chrome extension build", () => {
  const extension = path.resolve(path.dirname(openCliEntry(root)), "../../extension");
  if (!fs.existsSync(path.join(extension, "dist/background.js"))) throw new Error("Extension build missing");
  return extension;
});
check("CCR native dependencies", () => {
  const ccr = resolveCcrRoot(root);
  const sqlite = require(path.join(ccr, "node_modules/better-sqlite3"));
  const db = new sqlite(":memory:");
  db.prepare("SELECT 1").get(); db.close();
  return ccr;
});
check("Python and Tkinter", () => {
  const packagedPanel = path.join(root, "app/CUHK-AI-Settings.exe");
  if (fs.existsSync(packagedPanel)) return "bundled control panel";
  const windowed = ["pyw.exe", "pythonw.exe"].some(command => spawnSync("where.exe", [command], { encoding: "utf8" }).status === 0);
  if (!windowed) throw new Error("pyw.exe or pythonw.exe must be on PATH for the control panel");
  for (const [command, prefix] of [["py", ["-3"]], ["python", []]]) {
    const result = spawnSync(command, [...prefix, "-c", "import tkinter; print(tkinter.TkVersion)"], { encoding: "utf8", timeout: 15000 });
    if (result.status === 0) return `${command}: Tk ${result.stdout.trim()}`;
  }
  throw new Error("Install Python 3 with Tkinter and the Windows Python launcher");
});
try { console.log(`CLIENT Codex: ${codexExecutable()}`); }
catch { console.log("CLIENT Codex: optional; install before using its launcher"); }
const claude = spawnSync("where.exe", ["claude"], { encoding: "utf8" });
console.log(`CLIENT Claude: ${claude.status === 0 ? "found on PATH" : "optional; install before using its launcher"}`);
console.log("Browser login and tool execution are separate manual checks; no prompts were sent.");
process.exitCode = failures.length ? 1 : 0;
