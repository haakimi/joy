import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

function toAnthropicContent(content: ProviderMessage["content"]): any {
  return content;
}

function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  })) as Anthropic.MessageParam[];
}

export function normalizeAnthropicResponse(resp: any): ProviderResponse {
  const content: ProviderContentBlock[] = (resp.content ?? [])
    .filter((block: any) => block.type === "text" || block.type === "tool_use")
    .map((block: any) => {
      if (block.type === "text") return { type: "text", text: String(block.text ?? "") };
      return {
        type: "tool_use",
        id: String(block.id),
        name: String(block.name),
        input: block.input ?? {},
      };
    });

  return {
    content,
    stopReason: resp.stop_reason ?? "end_turn",
    usage: {
      inputTokens: Number(resp.usage?.input_tokens ?? 0),
      outputTokens: Number(resp.usage?.output_tokens ?? 0),
    },
    raw: resp.raw,
  };
}

export class AnthropicProvider implements ModelProvider {
  name = "anthropic" as const;

  constructor(private readonly client: Anthropic) {}

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    const resp = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      tools: request.tools,
      messages: toAnthropicMessages(request.messages),
    });
    return normalizeAnthropicResponse(resp);
  }
}
