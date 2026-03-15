import type { Language, RetrievedExperience } from "./types.js";

type Strings = {
  directAnswer: string;
  header: string;
  task: string;
  steps: string;
  result: string;
  footer: string;
};

const ZH: Strings = {
  directAnswer: "直接回答并完成任务",
  header: "你之前成功完成过类似任务，以下是可参考的成功轨迹：",
  task: "任务",
  steps: "步骤",
  result: "结果",
  footer: "请参考其策略，但根据当前任务灵活调整。",
};

const EN: Strings = {
  directAnswer: "answered directly without tool calls",
  header: "You have previously succeeded at similar tasks. Example trajectories for reference:",
  task: "Task",
  steps: "Steps",
  result: "Result",
  footer: "Use these as adaptable guidance — do not copy them rigidly.",
};

const resolveStrings = (language: Language): Strings => {
  if (language === "en") return EN;
  if (language === "zh") return ZH;
  // auto: detect from LANG environment variable
  const lang = process.env.LANG ?? process.env.LANGUAGE ?? "";
  return lang.startsWith("en") ? EN : ZH;
};

const formatStep = (experience: RetrievedExperience, s: Strings): string =>
  experience.trajectory.steps.length === 0
    ? s.directAnswer
    : experience.trajectory.steps
        .map(({ toolName, resultSummary, ok }) => `${toolName}${ok ? "" : " (failed)"}: ${resultSummary}`)
        .join(" -> ");

const formatExample = (experience: RetrievedExperience, index: number, s: Strings): string =>
  [
    `${index + 1}. ${s.task}: ${experience.taskSummary}`,
    `   ${s.steps}: ${formatStep(experience, s)}`,
    `   ${s.result}: ${experience.trajectory.finalAnswer || s.directAnswer}`,
  ].join("\n");

export const EXPERIENCE_REPLAY_SYSTEM_CONTEXT = [
  "When relevant prior successes exist, use them as adaptable guidance rather than rigid templates.",
  "Prefer the same high-level strategy only when the current task matches the recalled pattern.",
  "Do not mention the replay buffer unless the user asks about it.",
].join("\n");

export const formatExperienceReplay = (experiences: RetrievedExperience[], language: Language = "auto"): string => {
  if (experiences.length === 0) return "";
  const s = resolveStrings(language);
  return [
    "<experience_replay>",
    s.header,
    ...experiences.map((exp, i) => formatExample(exp, i, s)),
    s.footer,
    "</experience_replay>",
  ].join("\n");
};
