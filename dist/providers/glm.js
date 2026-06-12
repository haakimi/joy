export class GlmProvider {
    config;
    name = "glm";
    constructor(config) {
        this.config = config;
    }
    async createMessage(_request) {
        void this.config;
        throw new Error("GLM provider is reserved but not implemented because no GLM API access is available yet. " +
            "Set JOY_PROVIDER=anthropic for real calls or JOY_PROVIDER=mock for local agent-loop tests.");
    }
}
