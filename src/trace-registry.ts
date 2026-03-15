import type { RunTrace } from "./types.js";

const primaryKeyNames = [
  "runId",
  "agentRunId",
  "traceId",
  "invocationId",
  "requestId",
];

const contextualKeyNames = [
  "sessionId",
  "sessionKey",
  "agentId",
  "channelId",
  "workspaceDir",
] as const;

const emptyTrace = (prompt = ""): RunTrace => ({ prompt, assistantTexts: [], toolCalls: [] });

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === "string" && value ? value : "");

const namedKeysFrom = (value: unknown, names: readonly string[]): string[] =>
  names.flatMap((name) => {
    const key = asString(asRecord(value)[name]);
    return key ? [`${name}:${key}`] : [];
  });

const scopeKeyOf = (ctx: unknown): string =>
  [asString(asRecord(ctx).sessionId), asString(asRecord(ctx).agentId), asString(asRecord(ctx).channelId), asString(asRecord(ctx).workspaceDir)]
    .filter(Boolean)
    .join(":") || "global";

export const traceAliasesOf = (event: unknown, ctx: unknown): string[] =>
  [
    ...new Set([
      ...namedKeysFrom(event, primaryKeyNames),
      ...namedKeysFrom(ctx, primaryKeyNames),
      ...(
        namedKeysFrom(event, primaryKeyNames).length || namedKeysFrom(ctx, primaryKeyNames).length
          ? []
          : [...namedKeysFrom(event, contextualKeyNames), ...namedKeysFrom(ctx, contextualKeyNames), `scope:${scopeKeyOf(ctx)}`]
      ),
    ]),
  ];

const clearAliases = (aliases: Map<string, string>, canonical: string): void =>
  Array.from(aliases.entries())
    .filter(([, id]) => id === canonical)
    .forEach(([key]) => aliases.delete(key));

export const createTraceRegistry = () => {
  const traces = new Map<string, RunTrace>();
  const aliases = new Map<string, string>();
  let sequence = 0;
  const canonicalOf = (keys: string[]): string => keys.map((key) => aliases.get(key)).find(Boolean) ?? `trace:${++sequence}`;
  const bind = (canonical: string, keys: string[]): string => (keys.forEach((key) => aliases.set(key, canonical)), canonical);
  const touch = (event: unknown, ctx: unknown): string => bind(canonicalOf(traceAliasesOf(event, ctx)), traceAliasesOf(event, ctx));
  return {
    update(event: unknown, ctx: unknown, transform: (trace: RunTrace) => RunTrace): void {
      const canonical = touch(event, ctx);
      traces.set(canonical, transform(traces.get(canonical) ?? emptyTrace()));
    },
    take(event: unknown, ctx: unknown): RunTrace {
      const canonical = touch(event, ctx);
      const trace = traces.get(canonical) ?? emptyTrace();
      traces.delete(canonical);
      clearAliases(aliases, canonical);
      return trace;
    },
  };
};
