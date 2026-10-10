"use strict";
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { openCliEntry } = require("../bin/bridge-paths.cjs");
const root = path.resolve(__dirname, "..");
const vitest = path.resolve(path.dirname(openCliEntry(root)), "../../node_modules/vitest/vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "opencli-adapter", "--root", root,
  "--exclude", "**/.worktrees/**", "--exclude", "**/gateway/runtime-state/**", "--exclude", "**/gateway/host-state/**"],
  { cwd: root, stdio: "inherit", shell: false });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
