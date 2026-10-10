"use strict";
// Run after native Claude/Qwen generation. Parsing happens in an inert document
// before rendering; no model-authored script or external resource is accepted.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.CUHK_PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "../../.."), target = path.join(root, "artifacts/pelican-bicycle.svg");
async function main() {
  const svg = fs.readFileSync(target, "utf8");
  const browser = await chromium.launch({ headless: true, ...(process.env.CUHK_CHROME_PATH ? { executablePath: process.env.CUHK_CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
    const parsed = await page.evaluate(source => {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml"), svg = doc.documentElement;
      const problems = [];
      if (doc.querySelector("parsererror") || svg.localName !== "svg" || svg.namespaceURI !== "http://www.w3.org/2000/svg") problems.push("invalid SVG XML");
      if (!doc.querySelector("title") || !doc.querySelector("desc")) problems.push("missing title/desc");
      for (const el of doc.querySelectorAll("*")) {
        if (["script", "foreignObject"].includes(el.localName)) problems.push(`forbidden ${el.localName}`);
        for (const attr of el.attributes) {
          if (/^on/i.test(attr.name)) problems.push("script handler");
          if (attr.localName === "href" && !attr.value.startsWith("#")) problems.push("external href");
        }
      }
      const styles = [...doc.querySelectorAll("style")].map(el => el.textContent).join("\n");
      if (/@import/i.test(styles)) problems.push("external CSS import");
      for (const match of source.matchAll(/url\(([^)]*)\)/gi)) {
        if (!match[1].trim().replace(/^['"]|['"]$/g, "").startsWith("#")) problems.push("external CSS resource");
      }
      return { problems, width: svg.getAttribute("width"), height: svg.getAttribute("height"),
        title: doc.querySelector("title")?.textContent, animationElements: doc.querySelectorAll("animate,animateTransform,animateMotion").length,
        cssAnimation: /@keyframes/.test(styles) };
    }, svg);
    assert.deepEqual(parsed.problems, []);
    assert.equal(parsed.width, "960"); assert.equal(parsed.height, "640");
    assert.ok(parsed.animationElements > 0 || parsed.cssAnimation);
    await page.goto(pathToFileURL(target).href);
    const frames = [];
    for (const [i, seconds] of [0, 0.37, 0.83].entries()) {
      await page.evaluate(time => {
        const svg = document.querySelector("svg"); svg.pauseAnimations(); svg.setCurrentTime(time);
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time * 1000; }
      }, seconds);
      await page.waitForTimeout(50);
      const output = path.join(root, `artifacts/pelican-bicycle-frame-${i}.png`);
      const bytes = await page.screenshot({ path: output });
      frames.push({ seconds, file: path.basename(output), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
    assert.equal(new Set(frames.map(f => f.sha256)).size, 3, "animation frames must visibly differ");
    const report = { ok: true, ...parsed, selfContained: true, distinctFrames: true, frames };
    fs.writeFileSync(path.join(root, "gateway/runtime-state/svg-render-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
