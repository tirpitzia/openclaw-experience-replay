export type JsonRecord = Record<string, unknown>;

export type EmbeddingProvider = "lexical" | "openai" | "ollama";

export type Language = "auto" | "zh" | "en";

export type ExperienceReplayConfig = {
  enabled: boolean;
  storePath: string;
  /** Maximum number of similar experiences to retrieve and inject. Replaces the former topK+maxExamples pair. */
  maxExamples: number;
  similarityThreshold: number;
  maxCandidates: number;
  language: Language;
  embedding: {
    provider: EmbeddingProvider;
    requestedProvider: EmbeddingProvider;
    model: string;
    openaiApiKey: string;
    baseUrl: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    /**
     * Weight given to the semantic (provider) score in hybrid retrieval.
     * 1.0 = pure semantic, 0.0 = pure lexical.
     * Only applies when provider is "openai" or "ollama".
     */
    hybridWeight: number;
  };
  capture: {
    maxToolCalls: number;
    maxCharsPerResult: number;
  };
  success: {
    minScore: number;
    negativeFeedbackPatterns: string[];
    /**
     * Weights used by scoreExperience(). All four sum to 1.05 at maximum (by design,
     * matching the original defaults). Adjust to bias what matters for your use case.
     */
    scoreWeights: {
      /** Awarded when the run is flagged successful. Default: 0.55 */
      success: number;
      /** Awarded when a non-empty, non-failure final answer is present. Default: 0.20 */
      finalAnswer: number;
      /** Awarded when at least one tool call was made. Default: 0.15 */
      toolUse: number;
      /** Awarded when no tool calls were made (direct answer). Default: 0.10 */
      directAnswer: number;
      /** Awarded when prompt contains no negative-feedback patterns. Default: 0.15 */
      noNegativeFeedback: number;
    };
  };
};

export type ToolCallTrace = {
  toolName: string;
  params: JsonRecord;
  resultSummary: string;
  ok: boolean;
  error: string;
  durationMs: number;
};

export type RunTrace = {
  prompt: string;
  assistantTexts: string[];
  toolCalls: ToolCallTrace[];
};

export type ExperienceTrajectory = {
  prompt: string;
  steps: ToolCallTrace[];
  finalAnswer: string;
  outcome: "success";
};

export type StoredExperience = {
  id: string;
  taskSummary: string;
  prompt: string;
  trajectory: ExperienceTrajectory;
  vector: number[];
  successScore: number;
  createdAt: string;
  fingerprint: string;
};

export type RetrievedExperience = StoredExperience & {
  score: number;
};

export type Embedder = (text: string) => Promise<number[]>;

export type ExperienceStore = {
  save: (experience: StoredExperience) => boolean;
  listRecent: (limit: number) => StoredExperience[];
  count: () => number;
  delete: (id: string) => boolean;
  deleteAll: () => number;
};

export type PluginLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
};
