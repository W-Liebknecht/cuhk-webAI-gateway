"use strict";
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { codexExecutable } = require('./cli-discovery.cjs');
const { registerProcess } = require('./process-owner.cjs');
// Avoid cmd.exe re-parsing multiline prompts. The ephemeral relay attaches CLI
// ownership to requests; it does not log content or credentials.
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const args = Array.isArray(payload) ? payload : payload.args;
const gatewayPort = Array.isArray(payload) ? 3460 : Number(payload.gatewayPort);
if (!Array.isArray(args) || !Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error('Invalid CUHK Gateway launch payload.');
fs.unlinkSync(process.argv[2]);
const executable = codexExecutable();
const relay = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.method === 'POST' && /\/responses$/.test(req.url)) {
      const parsed = JSON.parse(body.toString('utf8'));
      parsed.client_metadata = { ...parsed.client_metadata, cuhk_owner_pid: process.pid };
      body = Buffer.from(JSON.stringify(parsed));
    }
    const headers = { ...req.headers, host: `127.0.0.1:${gatewayPort}`, 'content-length': body.length };
    delete headers['transfer-encoding'];
    const upstream = http.request({ hostname: '127.0.0.1', port: gatewayPort, path: req.url, method: req.method, headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(res);
    });
    upstream.on('error', error => { if (!res.headersSent) res.writeHead(502); res.end(error.message); });
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    upstream.end(body);
  } catch (error) { res.writeHead(400); res.end(error.message); }
});
relay.listen(0, '127.0.0.1', () => {
  const base = `model_providers.cuhk_gateway.base_url="http://127.0.0.1:${relay.address().port}/v1"`;
  const child = spawn(executable, ['-c', base, ...args], { stdio: 'inherit', windowsHide: true, shell: false });
  child.once('spawn', () => registerProcess(child.pid, executable));
  process.on('SIGINT', () => {});
  child.on('error', error => { console.error(error.message); process.exit(1); });
  child.on('exit', code => process.exit(code ?? 1));
});
