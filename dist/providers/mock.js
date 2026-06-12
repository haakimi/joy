export class MockProvider {
    script;
    name = "mock";
    index = 0;
    constructor(script) {
        this.script = script;
    }
    async createMessage(_request) {
        const response = this.script[this.index++];
        if (!response) {
            throw new Error("Mock provider has no scripted response left");
        }
        return response;
    }
}
export function mockScriptFromEnv() {
    const raw = process.env.JOY_MOCK_RESPONSES;
    if (!raw) {
        return [{
                content: [{ type: "text", text: "mock response" }],
                stopReason: "end_turn",
                usage: { inputTokens: 0, outputTokens: 0 },
            }];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
        throw new Error("JOY_MOCK_RESPONSES must be a JSON array");
    return parsed;
}
