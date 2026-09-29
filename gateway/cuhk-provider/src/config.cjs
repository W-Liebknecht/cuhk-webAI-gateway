"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { RequestError } = require("./errors.cjs");

const MODEL_THINKING = Object.freeze({
  "glm5.3flash": ["low", "high", "max"],
  "glm5.3": [],
  "gpt5.6sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt6sol": ["none", "low", "medium", "high", "xhigh", "max"],
  "gpt6luna": ["none", "low", "medium", "high", "xhigh", "max"],
  "deepseek-v4.1-flash": ["none", "high", "max"],
  "kimi-k3": ["low", "high", "max"],
  "seed2.1pro": ["none", "high"],
  "gemini3.8flash": ["low", "high"],
  "qwen3.8-27b": ["none", "low", "medium", "xhigh"]
});

function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("CUHK config must be a JSON object.", "invalid_cuhk_config");
  }
  const gatewayEnabled = typeof value.gatewayEnabled === "boolean"
    ? value.gatewayEnabled
    : value.enabled;
  if (typeof gatewayEnabled !== "boolean") {
    throw new RequestError("CUHK config.gatewayEnabled must be a boolean.", "invalid_cuhk_config");
  }
  if (!Object.hasOwn(MODEL_THINKING, value.model)) {
    throw new RequestError(`Unsupported CUHK model: ${value.model}`, "invalid_cuhk_config");
  }
  const levels = MODEL_THINKING[value.model];
  if (levels.length && !levels.includes(value.thinking)) {
    throw new RequestError(`Unsupported thinking level for ${value.model}: ${value.thinking}`, "invalid_cuhk_config");
  }
  const imageModel = value.imageModel === undefined ? "gpt5.6sol" : value.imageModel;
  if (!Object.hasOwn(MODEL_THINKING, imageModel)) {
    throw new RequestError(`Unsupported CUHK image model: ${imageModel}`, "invalid_cuhk_config");
  }
  return Object.freeze({
    gatewayEnabled,
    model: value.model,
    thinking: levels.length ? value.thinking : null,
    imageModel,
    mode: value.mode === "client-override" ? "client-override" : "locked",
    toolMode: value.toolMode === "disabled" ? "disabled" : "emulated",
    // Default on; set false to fall back to one fresh CUHK conversation per turn.
    conversationReuse: value.conversationReuse !== false,
    maxToolLoops: Number.isInteger(value.maxToolLoops) && value.maxToolLoops > 0
      ? Math.min(value.maxToolLoops, 32)
      : 32,
    webTimeoutSeconds: Number.isInteger(value.webTimeoutSeconds)
      ? Math.max(60, Math.min(value.webTimeoutSeconds, 1800))
      : 1800,
    stalledGenerationSeconds: Number.isInteger(value.stalledGenerationSeconds)
      ? Math.max(30, Math.min(value.stalledGenerationSeconds, 900))
      : 300
  });
}

class ConfigStore {
  constructor(configPath) {
    this.configPath = path.resolve(configPath);
  }

  read() {
    const raw = fs.readFileSync(this.configPath, "utf8");
    return validateConfig(JSON.parse(raw));
  }
}

module.exports = { ConfigStore, MODEL_THINKING, validateConfig };
