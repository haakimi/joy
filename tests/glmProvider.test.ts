import assert from "node:assert/strict";
import test from "node:test";

import { GlmProvider } from "../src/providers/glm.ts";

test("glm provider reports missing API implementation clearly", async () => {
  const provider = new GlmProvider({ apiKey: undefined, baseURL: undefined });

  await assert.rejects(
    () => provider.createMessage({ model: "glm", maxTokens: 100, system: "", tools: [], messages: [] }),
    /GLM provider is reserved but not implemented/,
  );
});
