import type { LlmProvider, LlmRequest, LlmResponse } from "../../tools/content/src/llm/types";

export type Handler = (req: LlmRequest) => string | Promise<string>;

/** Scripted provider: routes by prompt kind and records every request. */
export class FakeProvider implements LlmProvider {
  calls: LlmRequest[] = [];
  constructor(readonly kind: "api" | "headless", private handler: Handler, private modelReported?: (req: LlmRequest) => string | undefined) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = await this.handler(req);
    const m = this.modelReported ? this.modelReported(req) : req.model;
    return { text, resolvedModel: m, resolved: m !== undefined, usage: { inputTokens: 1000, outputTokens: 200 } };
  }
}

export const isGen = (p: string) => /write \d+ multiple-choice questions|write \d+ vocabulary|write \d+ grammar|reading passage/.test(p);
export const isBlind = (p: string) => p.includes("You are NOT told the answer");
export const isDistractor = (p: string) => p.includes("The intended correct option is marked");
export const isQuality = (p: string) => p.includes("strict reviewer");
export const isRevise = (p: string) => p.includes("Rewrite the item below");

export const mkQuestion = (stem: string, correct = "a", extra: Record<string, unknown> = {}) => ({
  stem,
  choices: ["a", "b", "c", "d"].map((id) => id === correct ? { id, text: `正解${stem.length}${id}` } : { id, text: `誤り${id}${stem.length}`, whyWrong: `${id}は文脈に合わない理由 ${stem}`, howToCorrect: `${id}を直す方法 ${stem}` }),
  correctChoiceId: correct, explanationKo: "정답 해설입니다.", tags: ["KO_PARTICLE_TRANSFER"], ...extra,
});

/** Finds which label (A-D) carries the correct text in a blind/distractor prompt. */
export const labelOfCorrect = (prompt: string, correctText: string): string => {
  const m = new RegExp(`^([A-D])\\. ${correctText}$`, "m").exec(prompt);
  return m ? m[1]! : "NONE";
};
