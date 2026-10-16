import type { ContentRecord, Kind } from "./schema";

/**
 * Checks that must be recorded as PASS before a record may claim VERIFIED.
 * Interpretation of IMP-10: BLIND_SOLVE and DISTRACTOR_CHECK need choices, so they are
 * required for QUESTION only; other kinds require SCHEMA_LINT + QUALITY_CHECK.
 */
export function requiredChecks(kind: Kind): string[] {
  return kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"];
}

const FAMILY = /(sonnet|opus|haiku|fable|mythos)/i;
const family = (m: string): string | null => FAMILY.exec(m)?.[1]?.toLowerCase() ?? null;

/** True only when we can tell the two models differ. Unknown/ambiguous -> false. */
export function modelsDiffer(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const na = a.trim().toLowerCase(), nb = b.trim().toLowerCase();
  if (na === nb) return false;
  const fa = family(na), fb = family(nb);
  if (!fa || !fb) return false;
  if (fa !== fb) return true;
  const va = na.replace(/[^0-9]/g, ""), vb = nb.replace(/[^0-9]/g, "");
  return va !== "" && vb !== "" && va !== vb;
}

export interface ClaimResult { ok: boolean; reason?: string }

export function claimsVerified(rec: Pick<ContentRecord, "kind" | "provenance" | "verification">): ClaimResult {
  const v = rec.verification;
  if (v.status !== "VERIFIED") return { ok: true };
  if (!modelsDiffer(rec.provenance.generatorModel, v.verifierModel)) return { ok: false, reason: "generator and verifier models are not provably different" };
  for (const id of requiredChecks(rec.kind)) {
    if (!v.checks.some((c) => c.id === id && c.result === "PASS")) return { ok: false, reason: `required check ${id} is not PASS` };
  }
  return { ok: true };
}
