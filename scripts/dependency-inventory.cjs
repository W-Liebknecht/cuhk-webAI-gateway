"use strict";
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(process.argv[2]);
const packages = [];
function visit(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const child = path.join(root, entry.name);
    const manifest = path.join(child, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name && pkg.version) packages.push({ name: pkg.name, version: pkg.version, license: pkg.license || "UNDECLARED", location: path.relative(directory, child).replaceAll("\\", "/") });
    }
    visit(child);
  }
}
for (const name of ["opencli", "claude-code-router"]) {
  const root = path.join(directory, name);
  visit(path.join(root, "node_modules"));
  if (name === "opencli") visit(path.join(root, "extension/node_modules"));
}
packages.sort((a, b) => a.location.localeCompare(b.location));
const destination = path.join(directory, "dependency-inventory.json");
fs.writeFileSync(destination, JSON.stringify({ generatedAt: new Date().toISOString(), scope: "Installed dependencies; metadata inventory, not a license audit. No dependencies are bundled in the source release.", packages }, null, 2) + "\n");
console.log(`Dependency inventory: ${destination} (${packages.length} package entries)`);
