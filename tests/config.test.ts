import assert from "node:assert/strict";
import test from "node:test";

import { pickProviderFromConfig, pickTokenFromConfig } from "../src/config.ts";

test("provider defaults to anthropic when unspecified", () => {
  assert.equal(pickProviderFromConfig({}), "anthropic");
});

test("provider can be read from JOY_PROVIDER env-shaped config", () => {
  assert.equal(pickProviderFromConfig({ env: { JOY_PROVIDER: "mock" } }), "mock");
});

test("provider can be read from provider config key", () => {
  assert.equal(pickProviderFromConfig({ provider: "glm" }), "glm");
});

test("unknown provider falls back to anthropic", () => {
  assert.equal(pickProviderFromConfig({ provider: "bogus" }), "anthropic");
});

test("token picker accepts GLM env-shaped keys", () => {
  assert.equal(pickTokenFromConfig({ env: { ZHIPUAI_API_KEY: "zhipu-key" } }), "zhipu-key");
});
