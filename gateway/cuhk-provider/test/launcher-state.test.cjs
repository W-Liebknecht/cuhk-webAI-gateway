"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LEGACY_PORTS, allocatePorts, normalizeControl, resolveCcrRoot } = require("../../../bin/cuhk-gateway.cjs");

test("legacy control state receives legacy ports without losing credentials", () => {
  const control = normalizeControl({ pid: 123, webToken: "web", gatewayKey: "key" });
  assert.deepEqual(control.ports, LEGACY_PORTS);
  assert.equal(control.gatewayKey, "key");
});

test("invalid control state is rejected before any PID action", () => {
  assert.equal(normalizeControl({ pid: 123, webToken: "web", gatewayKey: "key", ports: { gateway: 0 } }), null);
  assert.equal(normalizeControl({ pid: 123, webToken: "web" }), null);
});

test("gateway startup allocates four distinct loopback ports", async () => {
  const ports = await allocatePorts();
  const values = Object.values(ports);
  assert.equal(new Set(values).size, 4);
  assert.ok(values.every((port) => Number.isInteger(port) && port > 1024));
});

test("a linked worktree reuses the primary checkout CCR runtime", (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-ccr-worktree-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const primary = path.join(temporary, "primary");
  const worktree = path.join(primary, ".worktrees", "picker");
  const worktreeGitDirectory = path.join(primary, ".git", "worktrees", "picker");
  const server = path.join(primary, "research", "claude-code-router", "packages", "core", "dist", "main", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(worktreeGitDirectory, { recursive: true });
  fs.writeFileSync(server, "", "utf8");
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${worktreeGitDirectory}\n`, "utf8");
  fs.writeFileSync(path.join(worktreeGitDirectory, "commondir"), "../..\n", "utf8");

  assert.equal(resolveCcrRoot(worktree, {}), path.join(primary, "research", "claude-code-router"));
});

test("an explicit CCR runtime overrides checkout discovery", (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-ccr-override-"));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const server = path.join(temporary, "packages", "core", "dist", "main", "server.js");
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, "", "utf8");

  assert.equal(resolveCcrRoot("Z:\\missing-project", { CUHK_CCR_ROOT: temporary }), temporary);
});
