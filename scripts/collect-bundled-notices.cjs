"use strict";
const fs = require("node:fs");
const path = require("node:path");
const dependencies = path.resolve(process.argv[2]);
const destination = path.resolve(process.argv[3]);
const inventory = JSON.parse(fs.readFileSync(path.join(dependencies, "dependency-inventory.json"), "utf8"));
const rows = [];
const missing = [];
fs.mkdirSync(destination, { recursive: true });

async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (response.status >= 500) throw new Error(`Server error ${response.status}: ${url}`);
      if (!response.ok) return null;
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { if (attempt === 2) throw error; }
  }
}
function repository(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (/^[\w.-]+\/[\w.-]+$/.test(url || "")) return url;
  const match = /github\.com[:/]([^/]+\/[^/#]+?)(?:\.git)?(?:#.*)?$/.exec(url || "");
  return match?.[1];
}
async function collect(pkg) {
  const root = path.join(dependencies, pkg.location);
  const folder = path.join(destination, pkg.name.replace(/[^a-zA-Z0-9._-]/g, "_") + "@" + pkg.version);
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(path.join(root, "package.json"), path.join(folder, "package.json"));
  let texts = fs.readdirSync(root).filter(name => /^(licen[cs]e|copying|notice|copyright|unlicense)([._-]|$)/i.test(name) && fs.statSync(path.join(root, name)).isFile());
  for (const name of texts) fs.copyFileSync(path.join(root, name), path.join(folder, name));
  function nestedNotices(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) nestedNotices(file);
      else if (/^(licen[cs]e|copying|notice|copyright|unlicense)([._-]|$)/i.test(entry.name)) {
        const relative = path.relative(root, file);
        const target = path.join(folder, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target); texts.push(relative.replaceAll("\\", "/"));
      }
    }
  }
  // Vendored modules may keep their notices below the package root.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) nestedNotices(path.join(root, entry.name));
  }
  let source;
  let revision;
  if (!texts.length && pkg.name.startsWith("@claude-code-router/")) {
    fs.copyFileSync(path.join(dependencies, "claude-code-router/LICENSE"), path.join(folder, "LICENSE"));
    texts = ["LICENSE"];
  }
  if (!texts.length) {
    for (const name of fs.readdirSync(root).filter(name => /^readme/i.test(name) || name === "index.js")) {
      const file = path.join(root, name);
      if (!fs.statSync(file).isFile()) continue;
      const text = fs.readFileSync(file, "utf8");
      if (/Permission is hereby granted, free of charge|Redistribution and use in source and binary forms/i.test(text)) {
        fs.copyFileSync(file, path.join(folder, name)); texts.push(name); break;
      }
    }
  }
  const special = typeof pkg.license === "string" && /AGPL|MPL/.test(pkg.license);
  if (!texts.length || special) {
    const encoded = pkg.name.replace("/", "%2f");
    const metadataBytes = await download(`https://registry.npmjs.org/${encoded}/${pkg.version}`);
    if (metadataBytes) {
      const metadata = JSON.parse(metadataBytes.toString("utf8"));
      const repo = repository(metadata.repository);
      revision = metadata.gitHead;
      if (repo && /^[a-f0-9]{40}$/i.test(revision || "")) {
        source = `https://github.com/${repo}/tree/${revision}`;
        if (!texts.length) {
          for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md", "license.txt", "COPYING"]) {
            const bytes = await download(`https://raw.githubusercontent.com/${repo}/${revision}/${name}`);
            if (bytes?.length) { fs.writeFileSync(path.join(folder, name), bytes); texts.push(name); break; }
          }
        }
        if (special) {
          const archive = await download(`https://codeload.github.com/${repo}/zip/${revision}`);
          if (!archive?.length) throw new Error(`Corresponding source download failed: ${pkg.name}`);
          fs.writeFileSync(path.join(folder, "upstream-source.zip"), archive);
        }
      }
      if (repo && !texts.length) {
        // Some old npm releases have no gitHead or omit monorepo notices.
        // Record the exact retrieved notice URL separately from corresponding source.
        for (const ref of [`v${pkg.version}`, pkg.version, "main", "master"]) {
          for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "README.md"]) {
            const url = `https://raw.githubusercontent.com/${repo}/${ref}/${name}`;
            const bytes = await download(url);
            if (bytes?.length && /Permission is hereby granted|Redistribution and use|ISC License/i.test(bytes.toString("utf8"))) {
              fs.writeFileSync(path.join(folder, name), bytes); texts.push(name);
              fs.writeFileSync(path.join(folder, "NOTICE-SOURCE.txt"), url + "\n"); break;
            }
          }
          if (texts.length) break;
        }
      }
    }
  }
  if (!texts.length && pkg.license === "MIT") {
    // Preserve the publisher's declaration and attribution in package.json;
    // original source/README copyright headers remain in the installed package.
    const url = "https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt";
    const bytes = await download(url);
    if (bytes?.length) {
      fs.writeFileSync(path.join(folder, "MIT-template.txt"), bytes);
      fs.writeFileSync(path.join(folder, "NOTICE-SOURCE.txt"), `Standard text for the publisher's MIT declaration: ${url}\nAttribution: see package.json and the original package source/README. This is not an upstream copyright notice.\n`);
      texts.push("MIT-template.txt");
    }
  }
  if (pkg.license === "MIT AND ISC") {
    const bytes = await download("https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/ISC.txt");
    if (!bytes?.length) throw new Error(`ISC text download failed: ${pkg.name}`);
    fs.writeFileSync(path.join(folder, "ISC-template.txt"), bytes);
    texts.push("ISC-template.txt");
  }
  if (!texts.length || (special && !source)) missing.push(pkg.name + "@" + pkg.version);
  rows.push({ ...pkg, texts, ...(source ? { source, revision } : {}) });
}
(async () => {
  // Limit parallel downloads; corresponding source is pinned to npm's gitHead.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < inventory.packages.length) await collect(inventory.packages[next++]);
  }));
  rows.sort((a, b) => a.location.localeCompare(b.location));
  fs.writeFileSync(path.join(destination, "NOTICE-MANIFEST.json"), JSON.stringify({ packages: rows, unresolved: missing }, null, 2) + "\n");
  if (missing.length) throw new Error("Unresolved license texts or source archives: " + missing.join(", "));
  console.log(`Bundled notices: ${rows.length} package entries; required notice files collected.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
