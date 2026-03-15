import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin, { register } from "./index.js";

// ── shared helpers ────────────────────────────────────────────────────────────

const integrationDbPath = path.join(process.cwd(), ".tmp", "integration.test.db");

const createTestApi = (overrides: Record<string, unknown> = {}) => {
  const hooks = new Map<string, Function>();
  return {
    api: {
      id: "experience-replay",
      name: "Experience Replay",
      source: "test",
      config: {},
      pluginConfig: {
        storePath: "./.tmp/test.db",
        ...overrides,
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

// ── unit tests ────────────────────────────────────────────────────────────────

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

  it("does not inject prependContext when no experiences are stored", async () => {
    const { hooks } = createTestApi();
    register(createTestApi().api as never);
    const beforePromptBuild = hooks.get("before_prompt_build");
    const result = await beforePromptBuild?.({ prompt: "新任务", messages: [] }, { sessionId: "s-empty" });
    expect(result?.prependContext).toBeUndefined();
  });
});

// ── integration test ──────────────────────────────────────────────────────────

describe("experience replay integration — full hook pipeline", () => {
  afterEach(() => {
    if (fs.existsSync(integrationDbPath)) fs.unlinkSync(integrationDbPath);
  });

  it("stores a successful run and retrieves it for a similar follow-up prompt", async () => {
    const { api, hooks } = createTestApi({
      storePath: integrationDbPath,
      similarityThreshold: 0,  // accept any similarity so the test is locale-independent
      maxExamples: 1,
      language: "en",
    });
    register(api as never);

    const ctx = { sessionId: "integration-session" };
    const beforePromptBuild = hooks.get("before_prompt_build")!;
    const afterToolCall = hooks.get("after_tool_call")!;
    const llmOutput = hooks.get("llm_output")!;
    const agentEnd = hooks.get("agent_end")!;

    // ── 1. First run: no experiences yet ─────────────────────────────────────
    const firstResult = await beforePromptBuild({ prompt: "Book a meeting room for Friday afternoon", messages: [] }, ctx);
    expect(firstResult?.prependSystemContext).toContain("adaptable guidance");
    expect(firstResult?.prependContext).toBeUndefined();

    // ── 2. Record a successful tool call ─────────────────────────────────────
    await afterToolCall(
      {
        toolName: "calendar_lookup",
        params: { date: "Friday", time: "14:00" },
        result: { room: "Atlas-2", confirmed: true },
        durationMs: 120,
      },
      ctx,
    );

    // ── 3. Capture the assistant's final answer ───────────────────────────────
    await llmOutput(
      { assistantTexts: ["I have booked room Atlas-2 for Friday at 2 PM. Confirmation sent."] },
      ctx,
    );

    // ── 4. End the run successfully — this should persist the experience ──────
    await agentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "Book a meeting room for Friday afternoon" },
          { role: "assistant", content: "I have booked room Atlas-2 for Friday at 2 PM." },
        ],
      },
      ctx,
    );

    // Give async store.save a moment (it's sync via better-sqlite3, but hooks are async)
    await new Promise((resolve) => setTimeout(resolve, 10));

    // ── 5. Second run with a similar prompt — experience should be injected ───
    const ctx2 = { sessionId: "integration-session-2" };
    const secondResult = await beforePromptBuild(
      { prompt: "I need to reserve a conference room for this Friday", messages: [] },
      ctx2,
    );
    expect(secondResult?.prependContext).toBeDefined();
    expect(secondResult?.prependContext).toContain("<experience_replay>");
    // Should contain the English header since language="en"
    expect(secondResult?.prependContext).toContain("previously succeeded");
  });

  it("does not inject experiences for a completely unrelated task when threshold is realistic", async () => {
    const { api, hooks } = createTestApi({
      storePath: integrationDbPath,
      similarityThreshold: 0.3,
      maxExamples: 1,
    });
    register(api as never);

    const ctx = { sessionId: "threshold-session" };
    const beforePromptBuild = hooks.get("before_prompt_build")!;
    const afterToolCall = hooks.get("after_tool_call")!;
    const llmOutput = hooks.get("llm_output")!;
    const agentEnd = hooks.get("agent_end")!;

    // Record a meeting-room task
    await beforePromptBuild({ prompt: "预订周五下午的会议室", messages: [] }, ctx);
    await afterToolCall({ toolName: "calendar", params: {}, result: { ok: true }, durationMs: 50 }, ctx);
    await llmOutput({ assistantTexts: ["已为你预订成功。"] }, ctx);
    await agentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: "预订周五下午的会议室" },
          { role: "assistant", content: "已为你预订成功。" },
        ],
      },
      ctx,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    // A completely unrelated task should not retrieve the meeting-room experience
    const unrelatedCtx = { sessionId: "unrelated-session" };
    const result = await beforePromptBuild(
      { prompt: "请帮我写一首关于秋天的诗歌", messages: [] },
      unrelatedCtx,
    );
    // With threshold=0.3, an unrelated task should not match — prependContext should be absent
    expect(result?.prependContext).toBeUndefined();
  });

  it("does not persist failed runs", async () => {
    const { api, hooks } = createTestApi({
      storePath: integrationDbPath,
      similarityThreshold: 0,
    });
    register(api as never);

    const ctx = { sessionId: "fail-session" };
    const beforePromptBuild = hooks.get("before_prompt_build")!;
    const llmOutput = hooks.get("llm_output")!;
    const agentEnd = hooks.get("agent_end")!;

    await beforePromptBuild({ prompt: "some task", messages: [] }, ctx);
    await llmOutput({ assistantTexts: ["Something went wrong."] }, ctx);
    await agentEnd(
      {
        success: false,
        messages: [
          { role: "user", content: "some task" },
          { role: "assistant", content: "Something went wrong." },
        ],
      },
      ctx,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    // DB should be empty — failed runs are not stored
    const ctx2 = { sessionId: "fail-check" };
    const result = await beforePromptBuild({ prompt: "some task", messages: [] }, ctx2);
    expect(result?.prependContext).toBeUndefined();
  });
});
