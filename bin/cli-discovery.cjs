"use strict";
const fs = require("node:fs");
const path = require("node:path");
function nativeExecutables(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true })
    .filter(name => path.basename(name).toLowerCase() === "codex.exe")
    .map(name => path.join(root, name));
}
function codexExecutable(environment = process.env) {
  if (environment.CUHK_CODEX_EXE) {
    const explicit = path.resolve(environment.CUHK_CODEX_EXE);
    if (!fs.existsSync(explicit) || path.extname(explicit).toLowerCase() !== ".exe") {
      throw new Error("CUHK_CODEX_EXE must point to an existing native codex.exe.");
    }
    return explicit;
  }
  const desktop = environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, "OpenAI/Codex/bin");
  const installed = nativeExecutables(desktop).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (installed.length) return installed[0];
  for (const directory of (environment.PATH || "").split(path.delimiter).filter(Boolean)) {
    const direct = path.join(directory, "codex.exe");
    if (fs.existsSync(direct)) return direct;
    // npm shims cannot be spawned safely with multiline arguments. Locate the
    // native binary in the official npm package instead of invoking cmd.exe.
    if (fs.existsSync(path.join(directory, "codex.cmd"))) {
      for (const name of ["codex", "codex-win32-x64", "codex-win32-arm64"]) {
        const binaries = nativeExecutables(path.join(directory, "node_modules/@openai", name));
        if (binaries.length) return binaries[0];
      }
    }
  }
  throw new Error("Codex executable not found. Install the official Codex CLI, or set CUHK_CODEX_EXE to its native codex.exe.");
}
module.exports = { codexExecutable };
