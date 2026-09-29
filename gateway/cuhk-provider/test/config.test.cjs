"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateConfig } = require("../src/config.cjs");

const base = {
  model: "gpt5.6sol",
  thinking: "medium"
};

test("Gateway switch is independent from consultation", () => {
  const config = validateConfig({
    ...base,
    consultationEnabled: false,
    gatewayEnabled: true
  });
  assert.equal(config.gatewayEnabled, true);
  assert.equal(Object.hasOwn(config, "consultationEnabled"), false);
});

test("legacy enabled field remains a migration fallback", () => {
  assert.equal(validateConfig({ ...base, enabled: true }).gatewayEnabled, true);
  assert.equal(validateConfig({ ...base, enabled: false }).gatewayEnabled, false);
});

test("Gateway configuration requires its own switch after migration fallback", () => {
  assert.throws(() => validateConfig(base), /gatewayEnabled/);
});

test("web timeout and stalled generation thresholds are bounded", () => {
  const defaults = validateConfig({ ...base, gatewayEnabled: true });
  assert.equal(defaults.webTimeoutSeconds, 1800);
  assert.equal(defaults.stalledGenerationSeconds, 300);
  assert.equal(defaults.imageModel, "gpt5.6sol");
  const bounded = validateConfig({ ...base, gatewayEnabled: true, webTimeoutSeconds: 9999, stalledGenerationSeconds: 1 });
  assert.equal(bounded.webTimeoutSeconds, 1800);
  assert.equal(bounded.stalledGenerationSeconds, 30);
});

test("new gateway model aliases accept their verified thinking levels", () => {
  for (const [model, thinking] of [
    ["seed2.1pro", "high"],
    ["gemini3.8flash", "low"],
    ["gpt6sol", "max"],
    ["gpt6luna", "none"],
    ["qwen3.8-27b", "medium"]
  ]) {
    const config = validateConfig({ model, thinking, gatewayEnabled: true });
    assert.equal(config.model, model);
    assert.equal(config.thinking, thinking);
  }
});
