"use strict";
const fs = require("node:fs");
const path = require("node:path");

function primaryCheckout(root) {
  try {
    const dotGit = path.join(root, ".git");
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(dotGit, "utf8"));
      if (match) {
        const gitDir = path.resolve(root, match[1].trim());
        return path.dirname(path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()));
      }
    }
  } catch {}
  return root;
}
function openCliEntry(root) {
  if (process.env.CUHK_OPENCLI_ENTRY) return path.resolve(process.env.CUHK_OPENCLI_ENTRY);
  const primary = primaryCheckout(root);
  const candidates = [
    path.resolve(primary, "../cuhk-ai-opencli/dist/src/main.js"),
    path.join(primary, ".dependencies/opencli/dist/src/main.js")
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[1];
}
function ensureConfig(root) {
  const target = path.join(root, "config.json");
  if (!fs.existsSync(target)) {
    try { fs.copyFileSync(path.join(root, "config.example.json"), target, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  return target;
}
module.exports = { primaryCheckout, openCliEntry, ensureConfig };
