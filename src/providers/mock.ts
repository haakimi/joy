import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

export class MockProvider implements ModelProvider {
  name = "mock" as const;
  private index = 0;

  constructor(private readonly script: ProviderResponse[]) {}

  async createMessage(_request: ProviderRequest): Promise<ProviderResponse> {
    const response = this.script[this.index++];
    if (!response) {
      throw new Error("Mock provider has no scripted response left");
    }
    return response;
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
