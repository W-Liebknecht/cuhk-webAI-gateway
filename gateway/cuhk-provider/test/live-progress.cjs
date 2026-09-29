"use strict";
// Opt-in real website + a tightly allowlisted 20-second local process.
// Run: node gateway/cuhk-provider/test/live-progress.cjs
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../../..");
const control = JSON.parse(fs.readFileSync(path.join(root, "gateway/runtime-state/control.json"), "utf8"));
const body = { model: "gpt-5.6-sol", prompt_cache_key: crypto.randomUUID(), tools: [{ type: "namespace", name: "functions", tools: [{ type: "custom", name: "exec" }] }], stream: true };
const command = "Write-Output CUHK_LONG_START; Start-Sleep -Seconds 20; Write-Output CUHK_LONG_DONE";
const history = [{ role: "user", content: `测试长命令。请用 exec_command 执行以下精确命令，不增加内容：${command}\n命令可能返回 session_id；必须用 write_stdin 读取同一个进程，直到 exit_code 为 0。不要重复启动。完成后只回复 CUHK_LONG_DONE。` }];
const report = { key: body.prompt_cache_key, launches: 0, polls: 0, progress: [], heartbeats: 0 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let processState;
async function request(input) {
    const response = await fetch("http://127.0.0.1:3460/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${control.gatewayKey}` }, body: JSON.stringify({ ...body, input }), signal: AbortSignal.timeout(1200000) });
    const stream = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${stream}`);
    report.heartbeats += (stream.match(/: cuhk waiting/g) || []).length;
    const events = stream.split(/\r?\n/u).filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const done = events.find(event => event.type === "response.completed");
    if (!done) throw new Error(`No terminal response: ${stream}`);
    return done.response;
}
function collect() {
    const result = { output: processState.output, ...(processState.exitCode === null ? { session_id: processState.id } : { exit_code: processState.exitCode }) };
    processState.output = "";
    return result;
}
const localTools = {
    exec_command: async args => {
        assert.equal(args.cmd.trim(), command, "Test only allows the literal fixture command");
        assert.equal(report.launches++, 0, "Must not restart the job");
        const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        processState = { id: child.pid, child, output: "", exitCode: null };
        child.stdout.on("data", chunk => { processState.output += chunk; });
        child.stderr.on("data", chunk => { processState.output += chunk; });
        child.on("error", error => { processState.output += error.message; processState.exitCode = 1; });
        child.on("close", code => { processState.exitCode = code; });
        await sleep(args.yield_time_ms);
        return collect();
    },
    write_stdin: async args => {
        assert.equal(args.session_id, processState.id);
        assert.equal(args.chars, "");
        report.polls++;
        await sleep(args.yield_time_ms);
        return collect();
    }
};
(async () => {
    let response = await request(history);
    for (let step = 0; step < 8; step++) {
        const tool = response.output.find(item => item.type === "custom_tool_call");
        if (!tool) {
            assert.equal(processState?.exitCode, 0);
            assert.ok(report.polls > 0);
            report.final = response.output.flatMap(item => item.content || []).map(item => item.text || "").join("");
            assert.match(report.final, /CUHK(?:\\)?_LONG(?:\\)?_DONE/u);
            report.passed = true;
            fs.writeFileSync(path.join(root, "gateway/host-state/live-progress-report.json"), JSON.stringify(report, null, 2));
            console.log(JSON.stringify(report));
            return;
        }
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        let output;
        await new AsyncFunction("tools", "text", tool.input)(localTools, value => { output = value; });
        if (step === 0) {
            const started = Date.now();
            const status = await request([...history, { role: "user", content: "进度如何？" }]);
            report.progress.push({ elapsedMs: Date.now() - started, text: status.output[0].content[0].text });
            assert.ok(Date.now() - started < 5000);
            console.log("Progress answered while command is running");
        }
        history.push(...response.output, { type: "custom_tool_call_output", call_id: tool.call_id, output: JSON.stringify(output) });
        response = await request(history);
    }
    throw new Error("Too many test steps");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
