"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { materializeImages } = require("../src/transport.cjs");

test("materializes image data URLs and preserves local Windows paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-images-"));
  const local = path.join(dir, "local image.png");
  fs.writeFileSync(local, Buffer.from([1, 2, 3]));
  try {
    const slashed = local.replace(/\\/g, "/");
    const paths = materializeImages([
      { source: "data:image/png;base64,AQID" },
      { source: slashed }
    ], dir);
    assert.equal(fs.readFileSync(paths[0]).toString("hex"), "010203");
    assert.equal(paths[1], local);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("rejects remote image URLs before opening the browser", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cuhk-images-"));
  try { assert.throws(() => materializeImages([{ source: "https://example.com/a.png" }], dir), /Remote image URLs/); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
