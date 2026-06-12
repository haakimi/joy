import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

export interface GlmProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export class GlmProvider implements ModelProvider {
  name = "glm" as const;

  constructor(private readonly config: GlmProviderConfig) {}

  async createMessage(_request: ProviderRequest): Promise<ProviderResponse> {
    void this.config;
    throw new Error(
      "GLM provider is reserved but not implemented because no GLM API access is available yet. " +
        "Set JOY_PROVIDER=anthropic for real calls or JOY_PROVIDER=mock for local agent-loop tests.",
    );
  }
}
