"use strict";
// Real browser/model acceptance. All outputs/config are confined to this
// checkout; caller must have a ready Gateway and authenticated CUHK Chrome.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const state = path.join(root, "gateway/runtime-state");
const selected = process.argv[2] || "qwen-tools";
const model = selected.startsWith("glm") ? "glm5.3flash" : "qwen3.8-27b";
const workspace = path.join(state, "online-workspace", selected);
fs.mkdirSync(workspace, { recursive: true });
const configPath = path.join(root, "config.json");
const previous = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(previous);
fs.writeFileSync(configPath, JSON.stringify({ ...config, gatewayEnabled: true, model, thinking: "low" }, null, 2));

function launch(name, prompt, options = []) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "bin/cuhk-claude.ps1"),
    "-p", "--output-format", "stream-json", "--verbose", "--tools", "Bash,Read,Write,Edit",
    "--allowedTools", "Bash,Read,Write,Edit", "--setting-sources", "user", "--strict-mcp-config", ...options];
  const child = spawn("powershell.exe", args, { cwd: workspace, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const logPath = path.join(state, `${name}.ndjson`);
  const log = fs.createWriteStream(logPath);
  let stdout = "", stderr = "";
  child.stdout.on("data", d => { stdout += d; log.write(d); });
  child.stderr.on("data", d => { stderr += d; });
  child.stdin.end(prompt);
  const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }), 1200000);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => {
      clearTimeout(timer); log.end();
      fs.writeFileSync(path.join(state, `${name}.stderr.log`), stderr);
      const events = stdout.trim().split(/\r?\n/).filter(Boolean).map(row => { try { return JSON.parse(row); } catch { return null; } }).filter(Boolean);
      const result = events.findLast(e => e.type === "result");
      const calls = events.filter(e => e.type === "assistant").flatMap(e => e.message?.content || []).filter(b => b.type === "tool_use");
      try {
        assert.equal(code, 0, stderr + stdout.slice(-2000));
        assert.ok(result, "CLI produced no final result");
        assert.equal(result.is_error, false, JSON.stringify(result));
        assert.equal(result.permission_denials.length, 0, JSON.stringify(result.permission_denials));
        assert.equal(result.modelUsage["cuhk-gateway"].contextWindow, 100000);
        resolve({ result, calls, logPath });
      } catch (e) { reject(e); }
    });
  });
}

async function main() {
  const control = JSON.parse(fs.readFileSync(path.join(state, "control.json"), "utf8"));
  const ready = await fetch(`http://127.0.0.1:${control.ports.gateway}/plugins/cuhk/health/ready`).then(r => r.json());
  assert.equal(ready.ok, true, JSON.stringify(ready));
  let report;
  if (selected === "context") {
    const run = await launch("claude-context-online", "Do not use tools. Reply exactly CONTEXTSCALEOK.");
    assert.equal(run.calls.length, 0);
    assert.match(run.result.result, /CONTEXTSCALEOK/);
    report = { ok: true, case: selected, model, contextWindow: run.result.modelUsage["cuhk-gateway"].contextWindow };
  } else if (selected === "qwen-recovery") {
    const marker = `LONGCOMMAND${crypto.randomBytes(8).toString("hex")}`;
    const missing = path.join(workspace, "missing-file.txt");
    const target = path.join(workspace, "long-result.txt");
    const prompt = `Run this error and long-command regression using native tools. Do not call agents.\n` +
      `First call Read on ${missing}; it intentionally does not exist, so a tool error is expected. This is not a reason to stop.\n` +
      `Then call Bash once to execute: node -e "setTimeout(()=>{require('fs').writeFileSync('long-result.txt','${marker}');console.log('${marker}')},12000)". Let this command finish; do not launch it again.\n` +
      `After it finishes use Read on ${target}. Finally report RECOVERYCOMPLETE plus the exact marker from actual tool output. State that the first Read failed as expected.`;
    const run = await launch("claude-qwen-recovery", prompt);
    assert.equal(fs.readFileSync(target, "utf8"), marker);
    const commands = run.calls.filter(c => c.name === "Bash" && c.input.command.includes(marker));
    assert.equal(commands.length, 1, "long command must execute exactly once");
    const rows = fs.readFileSync(run.logPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
    const errors = rows.filter(e => e.type === "user").flatMap(e => e.message?.content || []).filter(b => b.type === "tool_result" && b.is_error);
    assert.ok(errors.length >= 1, "native Read error must be returned to the model");
    assert.ok(run.result.result.includes(marker));
    report = { ok: true, case: selected, model, errorResult: true, longCommandOnce: true, marker, tools: run.calls.map(c => c.name), result: run.result.result };
  } else if (selected === "svg" || selected === "svg-replay") {
    const target = path.join(root, "artifacts/pelican-bicycle.svg");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const originalHash = selected === "svg-replay" ? crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") : null;
    const prompt = selected === "svg-replay"
      ? `Perform the final native Claude Code gateway artifact replay after the regression tests. Do not call agents or school-site functions. Use only the gateway catalog's JSON decision tools.\nFirst use Read on ${target}, the pelican-bicycle SVG previously generated through this gateway by Qwen. Then use Write to overwrite the same file with its exact complete SVG content unchanged (no line numbers from Read). Finally Read it again and reply SVGCOMPLETE. Preserve all 15 animation elements, all geometry and text. Do not merely narrate the writes; the native tools must execute.`
      : `请用本地工具 Write 在 ${target} 创建一份完整、自包含的 SVG 动画，主题是“鹈鹕骑自行车”。\n` +
      `要求：可辨认的鹈鹕，有长嘴和喉囊；两只车轮、自行车车架、脚踏板；动画表现车轮连续旋转、脚蹬踏和身体轻微起伏；友好的扁平插画、天空与路面、画面协调。使用 SVG 原生 animateTransform/animate 或内联 CSS keyframes，循环播放，不依赖外部资源或 JavaScript。尺寸 960x640，带 title 与 desc，源代码控制在 14000 字以内。\n` +
      `请直接调用 Write 保存真实文件，不要只把代码显示在回复里。保存后用 Read 核对文件确实存在且是完整 SVG；确认完成再答复 SVGCOMPLETE。不要创建其他文件，不要调用子代理。`;
    const run = await launch("claude-qwen-svg", prompt);
    const svg = fs.readFileSync(target, "utf8");
    assert.match(svg, /<svg\b/); assert.match(svg, /<\/svg>\s*$/);
    assert.match(svg, /animateTransform|<animate\b|@keyframes/);
    assert.ok(run.calls.some(c => c.name === "Write" && path.resolve(c.input.file_path) === target));
    assert.ok(run.calls.some(c => c.name === "Read" && path.resolve(c.input.file_path) === target));
    const hash = crypto.createHash("sha256").update(svg).digest("hex");
    if (originalHash) assert.equal(hash, originalHash, "native replay must preserve the generated artifact exactly");
    report = { ok: true, case: selected, model, target, bytes: Buffer.byteLength(svg), sha256: crypto.createHash("sha256").update(svg).digest("hex"),
      session: run.result.session_id, tools: run.calls.map(c => c.name), contextWindow: run.result.modelUsage["cuhk-gateway"].contextWindow,
      ...(originalHash ? { exactReplay: true } : {}), result: run.result.result };
  } else {
    const proof = path.join(workspace, "proof.json");
    const receiptPath = path.join(workspace, "receipt.txt");
    const label = crypto.randomBytes(8).toString("hex");
    const prompt = `Complete this local tool regression in cwd ${workspace}. Use native Claude Code tools. Do not call agents.\n` +
      `1. Use Bash to execute a Node command that creates a NEW random 16-byte hexadecimal receipt at execution time, saves it to receipt.txt and prints it. This receipt must be generated by node crypto.randomBytes, not invented by you.\n` +
      `2. Use Read on ${receiptPath} to obtain the actual receipt.\n` +
      `3. Use Write to create ${proof} containing valid JSON with exactly {"receipt":"<actual receipt>","stage":"before","label":"${label}"}.\n` +
      `4. Use Edit to replace the stage value "before" with "after" in that file.\n` +
      `5. Use Read on ${proof} and verify the actual result.\n` +
      `6. Finally reply TOOLSCOMPLETE followed by the actual receipt. Each tool result must be consumed before the next call. Do not repeat successful commands, and do not stop before the file verification.`;
    const run = await launch(`claude-${selected}`, prompt);
    const receipt = fs.readFileSync(receiptPath, "utf8").trim();
    assert.match(receipt, /^[a-f0-9]{32}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(proof, "utf8")), { receipt, stage: "after", label });
    for (const name of ["Bash", "Read", "Write", "Edit"]) assert.ok(run.calls.some(c => c.name === name), `Missing native ${name}`);
    assert.ok(run.result.result.includes(receipt), run.result.result);
    const resume = await launch(`claude-${selected}-resume`, "Without using tools, tell me the exact random receipt from the previous task and its final stage. Do not invent a new receipt.", ["--resume", run.result.session_id]);
    assert.equal(resume.calls.length, 0);
    assert.ok(resume.result.result.includes(receipt), resume.result.result);
    assert.match(resume.result.result, /after/);
    report = { ok: true, case: selected, model, session: run.result.session_id, receipt, label,
      tools: run.calls.map(c => c.name), resume: true, result: run.result.result };
  }
  fs.writeFileSync(path.join(state, `${selected}-online-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(() => fs.writeFileSync(configPath, previous));
