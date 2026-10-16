import { costUsd } from "./budget";
import type { ProviderKind } from "./llm/types";
import type { Kind, Pool } from "../../../shared/schema";

export interface EstimateInput {
  kind: Kind; count: number; pool: Pool;
  questionsPerPassage?: number; questionsPerPoint?: number;
  gen: { provider: ProviderKind; model: string };
  verify: { provider: ProviderKind; model: string };
}
export interface Estimate {
  genCalls: number; verifyCalls: number; totalCalls: number; items: number; questions: number;
  usd?: number; assumptions: string[];
}

const REVISE_RATE = 0.25;       // [실무 제안] fraction of items that need a rewrite
const BATCH = 8;                // items per generation call (generate.ts)

/** Planning estimate, not a measurement: the assumptions are printed with the result. */
export function estimate(i: EstimateInput): Estimate {
  const qPer = i.kind === "PASSAGE" ? i.questionsPerPassage ?? 3 : i.kind === "GRAMMAR" ? i.questionsPerPoint ?? 1 : i.kind === "LISTENING" ? 1 : 0;
  const questions = i.kind === "QUESTION" ? i.count : i.count * qPer;
  const others = i.kind === "QUESTION" ? 0 : i.count;
  const genCalls = Math.ceil(i.count / BATCH);
  const perQuestion = (i.pool === "ASSESS" ? 4 : 2) + 1 + 1;          // blind rounds + distractor + quality
  const reviseExtra = REVISE_RATE * (1 + perQuestion);
  const verifyCalls = Math.ceil(questions * (perQuestion + reviseExtra) + others * (1 + REVISE_RATE * 2));
  const totalCalls = genCalls + verifyCalls;
  const assumptions = [`${REVISE_RATE * 100}% of items rewritten once`, `generation batches of ${BATCH} items`, "headless: counts calls only (subscription limits are not convertible)"];
  let usd: number | undefined;
  if (i.gen.provider === "api" || i.verify.provider === "api") {
    const tok = (calls: number, inT: number, outT: number, p: { provider: ProviderKind; model: string }) => (p.provider === "api" ? calls * (costUsd(p.model, { inputTokens: inT, outputTokens: outT }) ?? 0) : 0);
    usd = tok(genCalls, 1500, 700 * Math.min(BATCH, Math.max(1, i.count)), i.gen) + tok(verifyCalls, 800, 150, i.verify);
    assumptions.push("API tokens assumed: generation 1500 in / ~700 out per item; verification 800 in / 150 out per call");
  }
  return { genCalls, verifyCalls, totalCalls, items: i.count + (i.kind === "QUESTION" ? 0 : questions), questions, usd, assumptions };
}
