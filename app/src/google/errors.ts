/** User-facing messages: exactly the wording of plan.md §8.4. */
export const MSG = {
  LOCAL_FILE: "로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다.",
  GIS_FAILED: "Google 로그인 창을 열 수 없습니다. 브라우저 설정과 연결 상태를 확인해 주세요.",
  EXPIRED: "Google 연결이 만료되었습니다. 다시 연결해 주세요.",
  NO_SCOPE: "이 계정에서는 필요한 Google Sheets 권한을 사용할 수 없습니다.",
  READ_ONLY: "이 스프레드시트에 앱 기록을 쓸 수 없습니다.",
  NOT_FOUND: "시트를 찾지 못했거나 현재 계정에서 열 수 없습니다.",
  DECLINED: "연결하지 않았습니다. 학습 내용은 아직 시트에 저장되지 않았습니다.",
  OFFLINE: (n: number) => `연결이 끊겼습니다. ${n}건이 기기에만 저장되어 있습니다.`,
  QUOTA: "Google 요청 한도로 동기화가 지연되고 있습니다.",
  UNSURE: "원격 저장 여부를 확인 중입니다.",
  BAD_URL: "유효한 Google 스프레드시트 링크를 입력해 주세요.",
  FOREIGN_TABS: "기존 기록용 탭이 있어 자동 초기화할 수 없습니다.",
  PROFILE_MISMATCH: "다른 계정의 학습 기록이 연결되어 있습니다.",
  NEW_SCHEMA: "앱 데이터 버전을 확인할 수 없어 쓰기를 중단했습니다.",
} as const;

export type GErrorCode =
  | "LOCAL_FILE" | "GIS_FAILED" | "NEEDS_AUTH" | "NO_SCOPE" | "READ_ONLY" | "NOT_FOUND" | "DECLINED"
  | "OFFLINE" | "RATE_LIMIT" | "UNSURE" | "BAD_URL" | "FOREIGN_TABS" | "PROFILE_MISMATCH" | "NEW_SCHEMA" | "CORRUPT";

export class GoogleError extends Error {
  constructor(readonly code: GErrorCode, message: string, readonly status?: number, readonly retryAfterMs?: number) { super(message); }
}

export type Op = "read" | "write";

/** Maps an HTTP failure to the error matrix. `op` separates "no scope" (reads) from "cannot write" (writes). */
export function mapHttpError(status: number, body: unknown, op: Op, retryAfterMs?: number): GoogleError {
  const err = (body as { error?: { status?: string; message?: string; details?: { reason?: string }[]; errors?: { reason?: string }[] } } | null)?.error;
  const reasons = [...(err?.details ?? []).map((d) => d.reason), ...(err?.errors ?? []).map((d) => d.reason)].filter(Boolean) as string[];
  const text = `${err?.status ?? ""} ${err?.message ?? ""} ${reasons.join(" ")}`;
  if (status === 401) return new GoogleError("NEEDS_AUTH", MSG.EXPIRED, status);
  if (status === 403) {
    const scopeish = /SCOPE_INSUFFICIENT|SERVICE_DISABLED|accessNotConfigured|has not been used|disabled|insufficient authentication scopes|org_internal|admin_policy/i.test(text);
    if (scopeish || op === "read") return new GoogleError("NO_SCOPE", MSG.NO_SCOPE, status);
    return new GoogleError("READ_ONLY", MSG.READ_ONLY, status);
  }
  if (status === 404) return new GoogleError("NOT_FOUND", MSG.NOT_FOUND, status);
  if (status === 429) return new GoogleError("RATE_LIMIT", MSG.QUOTA, status, retryAfterMs);
  if (status >= 500) return new GoogleError("UNSURE", MSG.UNSURE, status);
  return new GoogleError("UNSURE", `Google 응답을 처리하지 못했습니다 (${status}).`, status);
}
