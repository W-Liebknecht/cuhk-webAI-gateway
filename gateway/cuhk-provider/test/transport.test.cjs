"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { UpstreamError } = require("../src/errors.cjs");
const { normalizeContextUsage, parseOpenCliOutput } = require("../src/transport.cjs");

test("OpenCLI JSON row arrays are normalized", () => {
  assert.deepEqual(parseOpenCliOutput('[{"response":"hello"}]'), { response: "hello" });
  assert.deepEqual(parseOpenCliOutput('{"response":"hello"}'), { response: "hello" });
  assert.throws(() => parseOpenCliOutput("not json"), UpstreamError);
});

test("OpenCLI context percentages are validated before reaching Responses usage", () => {
  assert.deepEqual(normalizeContextUsage({
    contextUsedPercent: 22,
    contextRemainingPercent: 78,
    contextTruncated: true
  }), { usedPercent: 22, remainingPercent: 78, truncated: true });
  assert.equal(normalizeContextUsage({ contextUsedPercent: 101 }), null);
});
