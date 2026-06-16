import { normalizeProviderResponse } from "./normalize.js";
import { withRetry } from "./retry.js";
function toAnthropicContent(content) {
    return content;
}
function toAnthropicMessages(messages) {
    return messages.map((m) => ({
        role: m.role,
        content: toAnthropicContent(m.content),
    }));
}
export function normalizeAnthropicResponse(resp) {
    const content = (resp.content ?? [])
        .filter((block) => block.type === "text" || block.type === "tool_use")
        .map((block) => {
        if (block.type === "text")
            return { type: "text", text: String(block.text ?? "") };
        return {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
        };
    });
    const normalized = normalizeProviderResponse({
        content,
        stopReason: resp.stop_reason ?? "end_turn",
        usage: {
            inputTokens: Number(resp.usage?.input_tokens ?? 0),
            outputTokens: Number(resp.usage?.output_tokens ?? 0),
        },
        raw: resp.raw,
    });
    return normalized.response;
}
export class AnthropicProvider {
    client;
    name = "anthropic";
    constructor(client) {
        this.client = client;
    }
    async createMessage(request) {
        const resp = await withRetry(() => this.client.messages.create({
            model: request.model,
            max_tokens: request.maxTokens,
            system: request.system,
            tools: request.tools,
            messages: toAnthropicMessages(request.messages),
        }), {
            signal: request.signal,
            // Generous per-attempt timeout; a single model turn can take a while
            // on long generations but should not hang forever.
            timeoutMs: 180_000,
        });
        return normalizeAnthropicResponse(resp);
    }
}
