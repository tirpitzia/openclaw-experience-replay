import { describe, expect, it } from "vitest";
import { createTraceRegistry, traceAliasesOf } from "./trace-registry.js";

describe("trace registry", () => {
  it("collects stable aliases from event and context", () => {
    expect(traceAliasesOf({ runId: "r1" }, { sessionId: "s1", agentId: "a1" })).toEqual(["runId:r1"]);
  });

  it("falls back to session-scoped aliases when no run id exists", () => {
    expect(traceAliasesOf({}, { sessionId: "s1", agentId: "a1" })).toEqual(["sessionId:s1", "agentId:a1", "scope:s1:a1"]);
  });

  it("keeps concurrent runs in the same session separated when run ids differ", () => {
    const registry = createTraceRegistry();
    registry.update({ prompt: "task-a", runId: "r1" }, { sessionId: "s1" }, (trace) => ({ ...trace, prompt: "task-a" }));
    registry.update({ prompt: "task-b", runId: "r2" }, { sessionId: "s1" }, (trace) => ({ ...trace, prompt: "task-b" }));
    expect(registry.take({ runId: "r1" }, { sessionId: "s1" }).prompt).toBe("task-a");
    expect(registry.take({ runId: "r2" }, { sessionId: "s1" }).prompt).toBe("task-b");
  });
});
