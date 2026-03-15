import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExperienceStore } from "./store.js";
import type { StoredExperience } from "./types.js";

const dbPath = path.join(process.cwd(), ".tmp", "store.test.db");

const logger = { warn() {}, debug() {} };

const experienceOf = (id: string, createdAt: string): StoredExperience => ({
  id,
  taskSummary: `task-${id}`,
  prompt: `prompt-${id}`,
  trajectory: { prompt: `prompt-${id}`, steps: [], finalAnswer: `done-${id}`, outcome: "success" },
  vector: [1, 0],
  successScore: 0.9,
  createdAt,
  fingerprint: `fp-${id}`,
});

afterEach(() => fs.existsSync(dbPath) && fs.unlinkSync(dbPath));

describe("store", () => {
  it("returns the newest experiences first and respects the requested limit", () => {
    const store = createExperienceStore({ dbPath, logger });
    ["2026-03-13T00:00:00.000Z", "2026-03-14T00:00:00.000Z", "2026-03-15T00:00:00.000Z"]
      .map((createdAt, index) => experienceOf(String(index + 1), createdAt))
      .forEach((experience) => store.save(experience));
    expect(store.listRecent(2).map(({ id }) => id)).toEqual(["3", "2"]);
  });
});
