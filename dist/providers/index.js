import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "./anthropic.js";
import { GlmProvider } from "./glm.js";
import { MockProvider, mockScriptFromEnv } from "./mock.js";
export function defaultModelForProvider(provider) {
    if (provider === "mock")
        return "mock";
    if (provider === "glm")
        return "glm";
    return "claude-sonnet-4-6";
}
export function tokenRequiredForProvider(provider) {
    return provider === "anthropic";
}
export function createProvider(config) {
    if (config.provider === "anthropic") {
        return new AnthropicProvider(new Anthropic({
            apiKey: config.authToken,
            baseURL: config.baseURL,
        }));
    }
    if (config.provider === "mock") {
        return new MockProvider(mockScriptFromEnv());
    }
    if (config.provider === "glm") {
        return new GlmProvider({ apiKey: config.authToken, baseURL: config.baseURL });
    }
    throw new Error(`Provider not implemented: ${config.provider}`);
}
