export type JsonRecord = Record<string, unknown>;

export type EmbeddingProvider = "lexical" | "openai";

export type ExperienceReplayConfig = {
  enabled: boolean;
  storePath: string;
  topK: number;
  similarityThreshold: number;
  maxExamples: number;
  maxCandidates: number;
  embedding: {
    provider: EmbeddingProvider;
    requestedProvider: EmbeddingProvider;
    model: string;
    openaiApiKey: string;
    baseUrl: string;
  };
  capture: {
    maxToolCalls: number;
    maxCharsPerResult: number;
  };
  success: {
    minScore: number;
    negativeFeedbackPatterns: string[];
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
};

export type PluginLogger = {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
};
