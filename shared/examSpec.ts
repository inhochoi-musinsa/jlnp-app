// The only place (besides tools/content/targets/) where JLPT level literals live.
export const LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
export type Level = (typeof LEVELS)[number];
/** Initial target level setting (user can change it at any time). */
export const DEFAULT_TARGET_LEVEL: Level = "N3";

export type TestSectionId = "VOCAB" | "GRAMMAR_READING" | "LANGUAGE_READING" | "LISTENING";
export type ScoringSectionId = "LANGUAGE_KNOWLEDGE" | "READING" | "LISTENING" | "LANGUAGE_KNOWLEDGE_READING";

export interface ExamSpec {
  level: Level;
  testSections: { id: TestSectionId; timeMinutes: number }[];
  scoringSections: { id: ScoringSectionId; maxScaledScore: number; officialSectionalPassMark: number }[];
  officialOverallPassMark: number;
  officialTotalMaxScore: number;
  examSpecVersion: string;
  officialSourceUrls: string[];
  verifiedAt: string;
}

const SOURCES = [
  "https://www.jlpt.jp/e/guideline/testsections.html",
  "https://www.jlpt.jp/e/guideline/results.html",
];
const knowledgeReadingListening = (overall: number) => ({
  scoringSections: [
    { id: "LANGUAGE_KNOWLEDGE" as const, maxScaledScore: 60, officialSectionalPassMark: 19 },
    { id: "READING" as const, maxScaledScore: 60, officialSectionalPassMark: 19 },
    { id: "LISTENING" as const, maxScaledScore: 60, officialSectionalPassMark: 19 },
  ],
  officialOverallPassMark: overall,
});
const combinedListening = (overall: number) => ({
  scoringSections: [
    { id: "LANGUAGE_KNOWLEDGE_READING" as const, maxScaledScore: 120, officialSectionalPassMark: 38 },
    { id: "LISTENING" as const, maxScaledScore: 60, officialSectionalPassMark: 19 },
  ],
  officialOverallPassMark: overall,
});
const base = { officialTotalMaxScore: 180, examSpecVersion: "1", officialSourceUrls: SOURCES, verifiedAt: "2026-10-16" };

export const EXAM_SPECS: Record<Level, ExamSpec> = {
  N1: { level: "N1", ...base, testSections: [{ id: "LANGUAGE_READING", timeMinutes: 110 }, { id: "LISTENING", timeMinutes: 55 }], ...knowledgeReadingListening(100) },
  N2: { level: "N2", ...base, testSections: [{ id: "LANGUAGE_READING", timeMinutes: 105 }, { id: "LISTENING", timeMinutes: 50 }], ...knowledgeReadingListening(90) },
  N3: { level: "N3", ...base, testSections: [{ id: "VOCAB", timeMinutes: 30 }, { id: "GRAMMAR_READING", timeMinutes: 70 }, { id: "LISTENING", timeMinutes: 40 }], ...knowledgeReadingListening(95) },
  N4: { level: "N4", ...base, testSections: [{ id: "VOCAB", timeMinutes: 25 }, { id: "GRAMMAR_READING", timeMinutes: 55 }, { id: "LISTENING", timeMinutes: 35 }], ...combinedListening(90) },
  N5: { level: "N5", ...base, testSections: [{ id: "VOCAB", timeMinutes: 20 }, { id: "GRAMMAR_READING", timeMinutes: 40 }, { id: "LISTENING", timeMinutes: 30 }], ...combinedListening(80) },
};

export function getExamSpec(level: Level): ExamSpec {
  return EXAM_SPECS[level];
}
export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

/** QUESTION.domain -> ScoringSection (depends on the level's scoring structure). */
export function scoringSectionFor(level: Level, domain: string): ScoringSectionId {
  const combined = EXAM_SPECS[level].scoringSections.some((s) => s.id === "LANGUAGE_KNOWLEDGE_READING");
  if (domain === "LISTENING_Q") return "LISTENING";
  const isReading = domain === "READING_Q";
  if (combined) return "LANGUAGE_KNOWLEDGE_READING";
  return isReading ? "READING" : "LANGUAGE_KNOWLEDGE";
}
