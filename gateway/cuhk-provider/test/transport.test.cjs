"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { UpstreamError } = require("../src/errors.cjs");
const { parseOpenCliOutput } = require("../src/transport.cjs");

test("OpenCLI JSON row arrays are normalized", () => {
  assert.deepEqual(parseOpenCliOutput('[{"response":"hello"}]'), { response: "hello" });
  assert.deepEqual(parseOpenCliOutput('{"response":"hello"}'), { response: "hello" });
  assert.throws(() => parseOpenCliOutput("not json"), UpstreamError);
});
