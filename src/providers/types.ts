import type { ToolDef } from "../tools.js";

export type ProviderName = "anthropic" | "mock" | "glm";

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export type ProviderMessage = {
  role: "user" | "assistant";
  content: string | ProviderContentBlock[] | ProviderToolResultBlock[];
};

export type ProviderToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ProviderStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded"
  | string;

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ToolRepairDiagnostic = {
  kind:
    | "tool_name_alias"
    | "input_key_alias"
    | "input_json_parsed"
    | "raw_arguments_parsed"
    | "tool_id_generated"
    | "stop_reason_reconciled"
    | "tool_input_unparseable";
  toolId?: string;
  toolName?: string;
  from?: string;
  to?: string;
  message?: string;
};

export type ProviderRequest = {
  model: string;
  maxTokens: number;
  system: string;
  tools: ToolDef[];
  messages: ProviderMessage[];
  signal?: AbortSignal;
};

export type ProviderResponse = {
  content: ProviderContentBlock[];
  stopReason: ProviderStopReason;
  usage: ProviderUsage;
  raw?: unknown;
  diagnostics?: ToolRepairDiagnostic[];
};

export interface ModelProvider {
  name: ProviderName;
  createMessage(request: ProviderRequest): Promise<ProviderResponse>;
}
