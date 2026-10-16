import { buildRecord, type ContentRecord, type Kind } from "../../shared/schema";

const prov = { origin: "AI_GENERATED" as const, createdAt: "2026-10-16T00:00:00Z", generatorModel: "claude-sonnet-5-5" };
const ver = { status: "UNVERIFIED" as const, selfAttested: false, checks: [] };

export const vocab = (over: Record<string, unknown> = {}): ContentRecord =>
  buildRecord({
    kind: "VOCAB", level: "N3", pool: "LEARN", tags: ["KO_FALSE_FRIEND"],
    payload: { surface: "油断", reading: "ゆだん", pos: "noun", meaningKo: "방심", example: { ja: "油断は禁物だ。", ko: "방심은 금물이다." }, levelEstimate: "N3", miscTags: [], ...over },
    provenance: prov, verification: ver,
  });

export const question = (over: Record<string, unknown> = {}, choices?: unknown[]): ContentRecord =>
  buildRecord({
    kind: "QUESTION", level: "N3", pool: "LEARN", tags: ["KO_PARTICLE_TRANSFER"],
    payload: {
      domain: "GRAMMAR_FORM",
      stem: "昨日は雨が降っていたので、友達との約束を（　　）ことにした。",
      choices: choices ?? [
        { id: "a", text: "やめる" },
        { id: "b", text: "やめた", whyWrong: "「ことにした」の前は辞書形になる。", howToCorrect: "「やめる＋ことにした」と接続する。" },
        { id: "c", text: "やめて", whyWrong: "て形には「ことにした」が続かない。", howToCorrect: "辞書形に直す。" },
        { id: "d", text: "やめない", whyWrong: "意味が逆になり、理由の「雨」と合わない。", howToCorrect: "肯定形の辞書形を使う。" },
      ],
      correctChoiceId: "a", explanationKo: "「〜ことにする」는 스스로 결정할 때 쓴다.", scoringSection: "LANGUAGE_KNOWLEDGE", ...over,
    },
    provenance: prov, verification: ver,
  });

export const KIND_SAMPLES: Record<Kind, Record<string, unknown>> = {
  KANA: { chars: ["シ", "ツ"], readings: { "シ": "shi", "ツ": "tsu" }, confusionNoteKo: "점의 방향이 다르다." },
  VOCAB: {}, QUESTION: {}, KANJI: {}, GRAMMAR: {}, PASSAGE: {}, LISTENING: {},
};
