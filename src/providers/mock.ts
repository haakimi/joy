import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

/**
 * A scripted response entry. A normal ProviderResponse is returned as-is; a
 * `{ throw: "..." }` entry makes the next createMessage() call reject with an
 * error carrying that message (and a 429 status, to simulate a retryable
 * failure), which is useful for testing compaction/error fallbacks.
 */
export type MockScriptEntry = ProviderResponse | { throw: string; status?: number };

export class MockProvider implements ModelProvider {
  name = "mock" as const;
  private index = 0;

  constructor(private readonly script: MockScriptEntry[]) {}

  async createMessage(_request: ProviderRequest): Promise<ProviderResponse> {
    const entry = this.script[this.index++];
    if (!entry) {
      throw new Error("Mock provider has no scripted response left");
    }
    if ("throw" in entry) {
      const err: Error & { status?: number } = Object.assign(
        new Error(entry.throw),
        { status: entry.status },
      );
      throw err;
    }
    return entry;
  }

  /** Number of scripted entries consumed so far (useful for assertions). */
  get callCount(): number {
    return this.index;
  }
}

export function mockScriptFromEnv(): ProviderResponse[] {
  const raw = process.env.JOY_MOCK_RESPONSES;
  if (!raw) {
    return [{
      content: [{ type: "text", text: "mock response" }],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("JOY_MOCK_RESPONSES must be a JSON array");
  return parsed;
}
