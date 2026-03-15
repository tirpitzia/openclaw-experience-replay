import { describe, expect, it, vi } from "vitest";
import plugin, { register } from "./index.js";

const createTestApi = () => {
  const hooks = new Map<string, Function>();
  return {
    api: {
      id: "experience-replay",
      name: "Experience Replay",
      source: "test",
      config: {},
      pluginConfig: {
        storePath: "./.tmp/test.db",
      },
      runtime: {} as never,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      registerTool() {},
      registerHook() {},
      registerHttpRoute() {},
      registerChannel() {},
      registerGatewayMethod() {},
      registerCli() {},
      registerService() {},
      registerProvider() {},
      registerCommand() {},
      registerContextEngine() {},
      resolvePath: (input: string) => input,
      on: vi.fn((name: string, handler: Function) => hooks.set(name, handler)),
    },
    hooks,
  };
};

describe("experience replay plugin", () => {
  it("exports metadata and register function", () => {
    expect(plugin.id).toBe("experience-replay");
    expect(typeof register).toBe("function");
  });

  it("registers replay and capture hooks", async () => {
    const { api, hooks } = createTestApi();
    register(api as never);
    expect(api.on).toHaveBeenCalledTimes(4);
    const beforePromptBuild = hooks.get("before_prompt_build");
    const result = await beforePromptBuild?.({ prompt: "帮我订会议室", messages: [] }, { sessionId: "s1" });
    expect(result?.prependSystemContext).toContain("adaptable guidance");
  });
});
