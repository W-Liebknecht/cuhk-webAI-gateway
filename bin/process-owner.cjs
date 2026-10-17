"use strict";
// Inherited by Node children, including detached CCR workers and OpenCLI calls.
// Persist identity before application code runs so cleanup survives parent crashes.
const fs = require("node:fs");
const path = require("node:path");
const directory = process.env.CUHK_PROCESS_DIRECTORY;
function registerProcess(pid, executable, startedAt = Date.now()) {
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${pid}.json`), JSON.stringify({ pid, executable, startedAt }));
}
if (directory) {
  const file = path.join(directory, `${process.pid}.json`);
  registerProcess(process.pid, process.execPath, Date.now() - process.uptime() * 1000);
  process.once("exit", () => { try { fs.unlinkSync(file); } catch {} });
}
module.exports = { registerProcess };
