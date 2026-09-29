"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { spawn } = require("node:child_process");
const { UpstreamError } = require("./errors.cjs");

class OpenCliTransport {
  constructor(options = {}) {
    this.nodePath = options.nodePath || process.execPath;
    this.entryPath = path.resolve(options.entryPath);
    this.timeoutSeconds = options.timeoutSeconds || 1800;
    this.diagnosticPath = options.diagnosticPath || null;
    this.statusEntryPath = options.statusEntryPath || null;
    this.health = { ok: null, login: null, status: "unknown", checkedAt: 0 };
  }

  async probe() {
    if (!this.statusEntryPath) return { ok: true, login: null, status: "not_configured", checkedAt: Date.now() };
    try {
      const result = await run(this.nodePath, [this.statusEntryPath, "cuhk-ai", "status", "--format", "json"], 30000);
      const parsed = JSON.parse(result.stdout);
      const row = Array.isArray(parsed) ? parsed[0] : parsed;
      const ok = row?.login === "Yes" && row?.status === "Connected";
      this.health = { ok, login: row?.login || null, status: row?.status || "unknown", url: row?.url || null, checkedAt: Date.now() };
    } catch (error) {
      this.health = { ok: false, login: null, status: error.message, checkedAt: Date.now() };
    }
    return this.health;
  }

  readiness() { return { ...this.health }; }

  async ask({ prompt, isNew, model, thinking, sessionId, conversationUrl, images = [], timeoutSeconds, stalledGenerationSeconds }) {
    if (!isNew && !conversationUrl) throw new UpstreamError("Missing conversation identity; refusing to write into the active page.", { code: "cuhk_identity_missing" });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-ccr-"));
    const promptPath = path.join(tempDir, "prompt.txt");
    fs.writeFileSync(promptPath, prompt, { encoding: "utf8", flag: "wx" });
    const effectiveTimeout = Number.isInteger(timeoutSeconds) ? timeoutSeconds : this.timeoutSeconds;
    const effectiveStalled = Number.isInteger(stalledGenerationSeconds) ? stalledGenerationSeconds : 300;
    const imagePaths = materializeImages(images, tempDir);
    const args = [this.entryPath, "--prompt-file", promptPath, "--timeout", String(effectiveTimeout), "--stalled-after", String(effectiveStalled), "--new", String(isNew), "--model", model];
    if (imagePaths.length) {
      const imageManifestPath = path.join(tempDir, "images.json");
      fs.writeFileSync(imageManifestPath, JSON.stringify(imagePaths), { encoding: "utf8", flag: "wx" });
      args.push("--image-manifest", imageManifestPath);
    }
    if (thinking) args.push("--thinking", thinking);
    args.push("--gateway-identity", "true");
    if (!isNew) {
      args.push("--conversation-url", conversationUrl);
    }
    try {
      appendDiagnostic(this.diagnosticPath, {
        type: "web_submit",
        sessionId,
        isNew,
        model,
        thinking,
        promptBytes: Buffer.byteLength(prompt, "utf8"),
        prompt
      });
      const result = await run(this.nodePath, args, (effectiveTimeout + 60) * 1000);
      const parsed = parseOpenCliOutput(result.stdout);
      if (parsed?.ok === false) {
        const error = new UpstreamError(parsed.error || 'OpenCLI failed.', { code: parsed.errorCode });
        error.conversationUrl = parsed.conversationUrl;
        throw error;
      }
      if (!parsed || parsed.ok === false || typeof parsed.response !== "string" || !parsed.response.trim()) {
        throw new UpstreamError(parsed?.error || "OpenCLI returned an empty response.");
      }
      appendDiagnostic(this.diagnosticPath, {
        type: "web_result",
        sessionId,
        isNew,
        responseBytes: Buffer.byteLength(parsed.response, "utf8"),
        response: parsed.response
      });
      this.health = { ...this.health, ok: true, login: "Yes", status: "Connected", checkedAt: Date.now() };
      return { text: parsed.response, conversationId: parsed.conversationUrl };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

const IMAGE_MIME_EXTENSIONS = Object.freeze({
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
  "image/gif": ".gif", "image/heic": ".heic", "image/heif": ".heif"
});
const IMAGE_EXTENSIONS = new Set(Object.values(IMAGE_MIME_EXTENSIONS).concat([".jpeg"]));

function materializeImages(images, tempDir) {
  if (!Array.isArray(images) || images.length === 0) return [];
  if (images.length > 4) throw new UpstreamError("At most 4 images can be uploaded in one turn.", { code: "cuhk_image_invalid", status: 400 });
  let totalBytes = 0;
  return images.map((image, index) => {
    const source = typeof image === "string" ? image : image?.source;
    if (typeof source !== "string" || !source.trim()) throw new UpstreamError("Image source is missing.", { code: "cuhk_image_invalid", status: 400 });
    if (/^https?:\/\//iu.test(source)) throw new UpstreamError("Remote image URLs are not supported; attach a local image or data URL.", { code: "cuhk_image_invalid", status: 400 });
    if (/^data:/iu.test(source)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/iu.exec(source);
      const extension = match && IMAGE_MIME_EXTENSIONS[match[1].toLowerCase()];
      if (!match || !extension) throw new UpstreamError("Unsupported or malformed image data URL.", { code: "cuhk_image_invalid", status: 400 });
      const bytes = Buffer.from(match[2].replace(/\s/gu, ""), "base64");
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new UpstreamError("Image must be between 1 byte and 25 MiB.", { code: "cuhk_image_invalid", status: 400 });
      totalBytes += bytes.length;
      if (totalBytes > 50 * 1024 * 1024) throw new UpstreamError("Combined images exceed 50 MiB.", { code: "cuhk_image_invalid", status: 400 });
      const output = path.join(tempDir, `image-${index + 1}${extension}`);
      fs.writeFileSync(output, bytes, { flag: "wx" });
      return output;
    }
    let filePath;
    try { filePath = /^file:/iu.test(source) ? fileURLToPath(source) : path.resolve(source.replace(/\\/g, path.sep)); }
    catch { throw new UpstreamError("Invalid local image path.", { code: "cuhk_image_invalid", status: 400 }); }
    let stat;
    try { stat = fs.statSync(filePath); }
    catch { throw new UpstreamError(`Image file was not found: ${filePath.replace(/\\/g, "/")}`, { code: "cuhk_image_invalid", status: 400 }); }
    if (!stat.isFile() || !IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) throw new UpstreamError("Unsupported local image file.", { code: "cuhk_image_invalid", status: 400 });
    if (stat.size > 25 * 1024 * 1024) throw new UpstreamError("Image exceeds 25 MiB.", { code: "cuhk_image_invalid", status: 400 });
    totalBytes += stat.size;
    if (totalBytes > 50 * 1024 * 1024) throw new UpstreamError("Combined images exceed 50 MiB.", { code: "cuhk_image_invalid", status: 400 });
    return filePath;
  });
}

function appendDiagnostic(filePath, row) {
  if (!filePath) return;
  fs.appendFileSync(filePath, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", "utf8");
}

function parseOpenCliOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new UpstreamError("OpenCLI returned invalid JSON.");
  }
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new UpstreamError("OpenCLI timed out; inspect the existing CUHK conversation before retrying.", { code: "cuhk_timeout" }));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new UpstreamError(`Could not start OpenCLI: ${error.message}`, { code: "cuhk_unavailable", status: 503, retryable: true }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const diagnostic = stderr.trim() || stdout.trim() || "no diagnostic";
        const errorCode = /\bEMPTY_RESULT\b/u.test(diagnostic) ? "cuhk_empty_result"
          : /\bTIMEOUT\b/u.test(diagnostic) ? "cuhk_timeout" : "cuhk_upstream_error";
        reject(new UpstreamError(`OpenCLI failed (${code}): ${diagnostic}`, { code: errorCode }));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

module.exports = { OpenCliTransport, materializeImages, parseOpenCliOutput };
