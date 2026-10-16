import { checkPackIntegrity, PACK_FORMAT, PACK_FORMAT_VERSION, type Pack } from "../../../shared/pack";
import { computeContentHash, validateContentRecord, type ContentRecord, type Issue, type Kind } from "../../../shared/schema";
import { lintRecord } from "../../../shared/lint";
import { normalizedKey } from "../../../shared/normalize";
import { SIMILARITY_THRESHOLD, SimIndex } from "../../../shared/similarity";
import { claimsVerified } from "../../../shared/verification";

export const IMPORT_LIMITS = { maxBytes: 20 * 1024 * 1024, maxItems: 20000 } as const;
const SIM_KINDS: Kind[] = ["QUESTION", "PASSAGE", "LISTENING"];

export type Reason =
  | "SCHEMA" | "HASH_MISMATCH" | "QUESTION_RULE" | "READING_CHARS" | "UNSAFE" | "INTEGRITY_CONFLICT" | "ASSESS_ISOLATION";

export interface ItemOutcome {
  contentId: string;
  contentVersion: number;
  kind: Kind;
  action: "ADD" | "ADD_VERSION_ACTIVE" | "ADD_VERSION_CANDIDATE" | "SKIP_SAME" | "SKIP_DUPLICATE_KEY" | "SKIP_SIMILAR" | "SKIP_FLAGGED_SAME_HASH" | "REJECT" | "HOLD";
  reason?: Reason;
  detail?: string;
  existingId?: string;
  score?: number;
  demoted?: string;
  warnings?: string[];
}

export interface ImportReport {
  ok: boolean;
  fileError?: string;
  packId?: string;
  total: number;
  outcomes: ItemOutcome[];
  /** Records that would be written if the user approves (already marked UNVERIFIED where demoted). */
  toWrite: ContentRecord[];
  /** Pack-level facts for display and for the PACKS row. */
  pack?: Pack["manifest"];
  summary: { added: number; newVersions: number; duplicates: number; conflicts: number; rejected: number; held: number; demoted: number; byReason: Partial<Record<Reason, number>> };
}

export interface ExistingContent {
  rows: ContentRecord[];
  /** contentIds that are FLAGGED or RETIRED for this learner/sheet. */
  blockedIds: Set<string>;
  /** contentIds (and passage ids) already shown to the learner. */
  exposed: Set<string>;
}

export interface ImportOptions {
  /** contentIds whose "similar" skip the user overrides ("그래도 추가"). */
  forceAdd?: Set<string>;
  /** import only these kinds (type-wise import). */
  kinds?: Kind[];
  textSize?: number;
}

const empty = (fileError: string): ImportReport => ({ ok: false, fileError, total: 0, outcomes: [], toWrite: [], summary: { added: 0, newVersions: 0, duplicates: 0, conflicts: 0, rejected: 0, held: 0, demoted: 0, byReason: {} } });

const simText = (r: ContentRecord): string => {
  const p = r.payload;
  if (r.kind === "QUESTION") return String(p.stem) + (p.choices as { id: string; text: string }[]).find((c) => c.id === p.correctChoiceId)?.text;
  if (r.kind === "PASSAGE") return (p.pages as string[]).join("");
  return (p.segments as { text: string }[]).map((s) => s.text).join("");
};

/**
 * Pure planning step: runs IMP-01..11 and the merge rules. Writes NOTHING.
 * The caller shows the report and writes `toWrite` only after the user approves.
 */
export function planImport(text: string, existing: ExistingContent, opts: ImportOptions = {}): ImportReport {
  if ((opts.textSize ?? text.length) > IMPORT_LIMITS.maxBytes) return empty("IMP-01: 파일이 20MB를 넘습니다.");
  let pack: Pack;
  try { pack = JSON.parse(text) as Pack; } catch { return empty("IMP-01: JSON 형식이 아닙니다."); }
  if (!pack || pack.format !== PACK_FORMAT) return empty("IMP-01: 이 앱의 팩 파일이 아닙니다.");
  if (typeof pack.formatVersion !== "number" || pack.formatVersion > PACK_FORMAT_VERSION) return empty("IMP-01: 지원하지 않는 팩 버전입니다. 앱을 최신으로 업데이트하세요.");
  if (!Array.isArray(pack.items) || !pack.manifest || typeof pack.manifest !== "object") return empty("IMP-01: 팩 구조가 올바르지 않습니다.");
  if (pack.items.length > IMPORT_LIMITS.maxItems) return empty("IMP-01: 항목이 20,000개를 넘습니다.");

  // IMP-03 (file level): manifest counts and manifestHash must match the items as shipped.
  const integrity = checkPackIntegrity(pack);
  const fileLevel = integrity.fileErrors.filter((e) => e === "counts" || e === "manifestHash" || e === "format" || e === "formatVersion");
  // Item-level hash failures are reported per item (below); a changed item also changes manifestHash, so a
  // pack whose only problem is tampered items is judged item by item rather than rejected wholesale.
  if (fileLevel.includes("counts") || (fileLevel.includes("manifestHash") && integrity.badHashItems.length === 0)) {
    return { ...empty(`IMP-03: 팩 요약(manifest)이 내용과 일치하지 않습니다 (${fileLevel.join(", ")}).`), packId: pack.manifest.packId, pack: pack.manifest, total: pack.items.length };
  }

  const outcomes: ItemOutcome[] = [];
  const byId = new Map<string, ContentRecord[]>();
  for (const r of existing.rows) (byId.get(r.contentId) ?? byId.set(r.contentId, []).get(r.contentId)!).push(r);
  const keyIndex = new Map<string, string>();
  for (const r of existing.rows) keyIndex.set(`${r.kind}|${normalizedKey(r.kind, r.payload)}`, r.contentId);
  const sim = new SimIndex();
  for (const r of existing.rows) if (SIM_KINDS.includes(r.kind)) sim.add(r.contentId, r.kind, simText(r));
  const exposedKeys = new Set<string>();
  for (const r of existing.rows) if (existing.exposed.has(r.contentId)) exposedKeys.add(`${r.kind}|${normalizedKey(r.kind, r.payload)}`);

  const accepted: ContentRecord[] = [];
  const idsInPack = new Set(pack.items.map((i) => (i as ContentRecord)?.contentId).filter(Boolean));
  const batchKeys = new Map<string, string>();

  for (const raw of pack.items as unknown[]) {
    const base = { contentId: String((raw as any)?.contentId ?? "?"), contentVersion: Number((raw as any)?.contentVersion ?? 0), kind: (raw as any)?.kind as Kind };
    const rej = (reason: Reason, detail: string): void => { outcomes.push({ ...base, action: "REJECT", reason, detail }); };

    // IMP-02 schema
    const sch = validateContentRecord(raw);
    if (sch.length) { rej("SCHEMA", sch.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join("; ")); continue; }
    let rec = raw as ContentRecord;
    if (opts.kinds && !opts.kinds.includes(rec.kind)) continue; // type-wise import: silently out of scope
    // IMP-03 item hash
    if (computeContentHash(rec) !== rec.contentHash) { rej("HASH_MISMATCH", "contentHash가 내용과 다릅니다(변조 또는 손상)"); continue; }
    // IMP-04 / 06 / 07 via lint
    const lint: Issue[] = lintRecord(rec);
    const hard = lint.filter((i) => i.code !== "GRAMMAR_ENDING_ONLY");
    if (hard.length) {
      const c = hard[0]!.code;
      const reason: Reason = ["HTML_FORBIDDEN", "URL_FORBIDDEN", "CONTROL_CHAR", "PAYLOAD_TOO_LARGE"].includes(c) ? "UNSAFE" : c === "READING_CHARS" ? "READING_CHARS" : "QUESTION_RULE";
      rej(reason, hard.slice(0, 3).map((i) => `${i.code}@${i.path}`).join("; "));
      continue;
    }
    const warnings: string[] = [];
    let demoted: string | undefined;
    // IMP-05 heuristic -> demote
    if (lint.some((i) => i.code === "GRAMMAR_ENDING_ONLY")) { demoted = "어미만 보고 풀릴 수 있는 문법 문항(IMP-05)"; warnings.push(demoted); }
    // IMP-10 verified claim
    const claim = claimsVerified(rec);
    if (!claim.ok) demoted = demoted ? `${demoted}; ${claim.reason}` : claim.reason;
    if (demoted) rec = { ...rec, verification: { ...rec.verification, status: "UNVERIFIED" } };
    // The verification block of any imported record is unsigned self-attestation.
    rec = { ...rec, verification: { ...rec.verification, selfAttested: true } };

    // IMP-08 references
    const parent = (rec.payload.stimulusId ?? rec.payload.linkedContentId) as string | undefined;
    const refs = [parent, ...(rec.kind === "PASSAGE" ? (rec.payload.questionIds as string[]) : []), ...(rec.kind === "LISTENING" && typeof rec.payload.questionId === "string" ? [rec.payload.questionId as string] : [])].filter((x): x is string => !!x);
    const missing = refs.filter((id) => !idsInPack.has(id) && !byId.has(id));
    if (missing.length) { outcomes.push({ ...base, action: "HOLD", detail: `참조 대상이 없습니다: ${missing.slice(0, 3).join(", ")}` }); continue; }

    // IMP-11 assessment isolation
    const key = `${rec.kind}|${normalizedKey(rec.kind, rec.payload)}`;
    if (rec.pool === "ASSESS" && (exposedKeys.has(key) || existing.exposed.has(rec.contentId))) { rej("ASSESS_ISOLATION", "이미 학습에서 본 문항과 같아 평가 풀에 넣을 수 없습니다"); continue; }

    // IMP-09 merge rules
    const same = byId.get(rec.contentId) ?? [];
    const sameVersion = same.find((x) => x.contentVersion === rec.contentVersion);
    if (sameVersion) {
      if (sameVersion.contentHash === rec.contentHash) { outcomes.push({ ...base, action: "SKIP_SAME" }); continue; }
      outcomes.push({ ...base, action: "REJECT", reason: "INTEGRITY_CONFLICT", detail: "같은 ID·버전인데 내용이 다릅니다" }); continue;
    }
    if (same.length) {
      const top = Math.max(...same.map((x) => x.contentVersion));
      if (rec.contentVersion < top) { outcomes.push({ ...base, action: "REJECT", reason: "INTEGRITY_CONFLICT", detail: `이미 더 높은 버전(${top})이 있습니다` }); continue; }
      if (same.some((x) => x.contentHash === rec.contentHash)) {
        // identical payload under a new version number would only inflate history
        outcomes.push({ ...base, action: "SKIP_SAME", detail: "다른 버전에 같은 내용이 이미 있습니다" }); continue;
      }
      const bothVerified = rec.verification.status === "VERIFIED" && same.filter((x) => x.contentVersion === top).every((x) => x.verification.status === "VERIFIED");
      outcomes.push({ ...base, action: bothVerified ? "ADD_VERSION_ACTIVE" : "ADD_VERSION_CANDIDATE", demoted, warnings });
      accepted.push(rec);
      continue;
    }
    // flagged / retired item re-offered with the same hash
    if (existing.blockedIds.has(rec.contentId)) { outcomes.push({ ...base, action: "SKIP_FLAGGED_SAME_HASH" }); continue; }
    // duplicate by normalized key (different id)
    const dupId = keyIndex.get(key) ?? batchKeys.get(key);
    if (dupId && dupId !== rec.contentId) { outcomes.push({ ...base, action: "SKIP_DUPLICATE_KEY", existingId: dupId }); continue; }
    // near duplicates
    if (SIM_KINDS.includes(rec.kind) && !opts.forceAdd?.has(rec.contentId)) {
      const hit = sim.find(rec.kind, simText(rec), SIMILARITY_THRESHOLD, rec.contentId);
      if (hit) { outcomes.push({ ...base, action: "SKIP_SIMILAR", existingId: hit.id, score: hit.score }); continue; }
    }
    outcomes.push({ ...base, action: "ADD", demoted, warnings });
    accepted.push(rec);
    batchKeys.set(key, rec.contentId);
    if (SIM_KINDS.includes(rec.kind)) sim.add(rec.contentId, rec.kind, simText(rec));
  }

  // A passage/question pair must be written together: drop accepted records whose parent was rejected.
  const rejectedIds = new Set(outcomes.filter((o) => o.action === "REJECT" || o.action === "HOLD").map((o) => o.contentId));
  const finalAccepted = accepted.filter((r) => {
    const parent = (r.payload.stimulusId ?? r.payload.linkedContentId) as string | undefined;
    if (parent && rejectedIds.has(parent) && !byId.has(parent)) {
      const o = outcomes.find((x) => x.contentId === r.contentId && (x.action === "ADD" || x.action.startsWith("ADD_VERSION")));
      if (o) { o.action = "HOLD"; o.detail = `부모 항목(${parent})이 거부되어 보류합니다`; }
      return false;
    }
    return true;
  });

  const sum = { added: 0, newVersions: 0, duplicates: 0, conflicts: 0, rejected: 0, held: 0, demoted: 0, byReason: {} as Partial<Record<Reason, number>> };
  for (const o of outcomes) {
    if (o.action === "ADD") sum.added++;
    else if (o.action.startsWith("ADD_VERSION")) sum.newVersions++;
    else if (o.action.startsWith("SKIP")) sum.duplicates++;
    else if (o.action === "HOLD") sum.held++;
    else if (o.action === "REJECT") { if (o.reason === "INTEGRITY_CONFLICT") sum.conflicts++; else { sum.rejected++; sum.byReason[o.reason!] = (sum.byReason[o.reason!] ?? 0) + 1; } }
    if (o.demoted && (o.action === "ADD" || o.action.startsWith("ADD_VERSION"))) sum.demoted++;
  }
  return { ok: true, packId: pack.manifest.packId, pack: pack.manifest, total: pack.items.length, outcomes, toWrite: finalAccepted, summary: sum };
}

export function reportLines(r: ImportReport): string[] {
  if (!r.ok) return [r.fileError ?? "가져올 수 없습니다."];
  const s = r.summary;
  const reasons = Object.entries(s.byReason).map(([k, v]) => `${REASON_LABEL[k as Reason]} ${v}`).join(", ");
  return [`신규 ${s.added + s.newVersions}건 / 중복 ${s.duplicates}건 / 충돌 ${s.conflicts}건 / 거부 ${s.rejected}건${reasons ? ` (${reasons})` : ""} / 보류 ${s.held}건 / 강등 ${s.demoted}건`];
}
export const REASON_LABEL: Record<Reason, string> = { SCHEMA: "형식 오류", HASH_MISMATCH: "해시 불일치", QUESTION_RULE: "문제 규칙 위반", READING_CHARS: "읽기 문자 오류", UNSAFE: "위험한 문자열", INTEGRITY_CONFLICT: "충돌", ASSESS_ISOLATION: "평가 풀 격리" };
