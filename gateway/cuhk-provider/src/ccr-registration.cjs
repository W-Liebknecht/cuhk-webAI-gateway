"use strict";

// CCR's native GatewayProviderConfig. CCR supplies runtime IDs, topology,
// model discovery and ModelRegistry resolution; no parallel registry here.
function cuhkProvider(backendPort = 3462) {
  return {
    id: "cuhk-ai", name: "CUHK AI", enabled: true,
    type: "openai_responses", baseurl: `http://127.0.0.1:${backendPort}/v1`,
    // Required by CCR's OpenAI protocol builder; no school credential involved.
    apikey: "cuhk-local-transport",
    models: ["gpt-5.6-sol", "gpt6sol", "gpt6luna", "glm5.3flash", "glm5.3", "deepseek-v4.1-flash", "kimi-k3", "qwen3.8-27b", "seed2.1pro", "gemini3.8flash"],
    autoFetchModels: false, protocolDetectionMode: "manual"
  };
}

module.exports = { cuhkProvider };
