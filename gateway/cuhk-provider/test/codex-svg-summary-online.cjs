"use strict";

// Reproduce the user's SVG task, requiring a local file to exercise the tool
// continuation path. There is no extra instruction to summarize.
// Requires an idle, running Gateway and authenticated CUHK Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const directory = path.join(root, "gateway/runtime-state", `svg-summary-${Date.now()}`);
const workspace = path.join(directory, "workspace");
fs.mkdirSync(workspace, { recursive: true });
const child = spawn("powershell.exe", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "bin/cuhk-codex.ps1"),
  "exec", "--skip-git-repo-check", "--json", "--sandbox", "danger-full-access"
], { cwd: workspace, windowsHide: true });
let stdout = "", stderr = "";
child.stdout.on("data", data => { stdout += data; fs.appendFileSync(path.join(directory, "cli.ndjson"), data); });
child.stderr.on("data", data => { stderr += data; });
const prompt = "生成10只大猪同时跳水的svg动画，使用本地工具保存为当前工作目录的 pigs-diving.svg。请用一个可复用的猪图形和10个use实例，使用同一时间开始的SVG动画，保持SVG简洁，不超过100行。不要使用网页内置画布工具。";
child.stdin.end(prompt);
const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 1200000);
child.once("error", error => { clearTimeout(timer); console.error(error.stack); process.exitCode = 1; });
child.once("close", code => {
  clearTimeout(timer);
  fs.writeFileSync(path.join(directory, "stderr.log"), stderr);
  try {
    assert.equal(code, 0, stderr + stdout.slice(-3000));
    const events = stdout.trim().split(/\r?\n/).map(JSON.parse);
    const items = events.filter(e => e.type === "item.completed").map(e => e.item);
    const tools = items.filter(i => ["command_execution", "file_change"].includes(i.type));
    assert.ok(tools.length > 0, "the task must actually execute local tools");
    const svgs = fs.readdirSync(workspace, { recursive: true }).filter(name => name.endsWith(".svg"));
    assert.ok(svgs.length > 0, "a real SVG file must be created");
    for (const name of svgs) {
      const svg = fs.readFileSync(path.join(workspace, name), "utf8");
      assert.match(svg, /<svg\b/u);
      assert.match(svg, /<animate(?:Transform|Motion)?\b|@keyframes|requestAnimationFrame/u, "SVG must contain animation");
    }
    const lastTool = events.findLastIndex(e => e.type === "item.completed" && ["command_execution", "file_change"].includes(e.item?.type));
    const final = events.slice(lastTool + 1).filter(e => e.type === "item.completed" && e.item?.type === "agent_message").at(-1)?.item?.text || "";
    assert.ok(final.trim(), "a text answer must arrive after the last local tool finishes");
    assert.match(final, /svg/iu);
    assert.ok(events.some(e => e.type === "turn.completed"));
    const report = { ok: true, prompt, tools: tools.length, files: svgs, final, workspace };
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, directory }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
});
