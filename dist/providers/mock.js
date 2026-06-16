export class MockProvider {
    script;
    name = "mock";
    index = 0;
    constructor(script) {
        this.script = script;
    }
    async createMessage(_request) {
        const entry = this.script[this.index++];
        if (!entry) {
            throw new Error("Mock provider has no scripted response left");
        }
        if ("throw" in entry) {
            const err = Object.assign(new Error(entry.throw), { status: entry.status });
            throw err;
        }
        return entry;
    }
    /** Number of scripted entries consumed so far (useful for assertions). */
    get callCount() {
        return this.index;
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
