import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MSG } from "../../app/src/google/errors";

const root = resolve(__dirname, "../..");
const guide = readFileSync(join(root, "docs/USER_GUIDE.md"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
const appSource = walk(join(root, "app/src")).map((f) => readFileSync(f, "utf8")).join("\n");

// commands the guide mentions that belong to later tasks (T12 fill/plan, T14 audio, triage); listed explicitly so nothing else slips in
const PLANNED = new Set(["content:plan", "content:fill", "content:audio", "content:triage"]);

describe("T09: the guide matches the product", () => {
  it("every npm command in the guide exists (or is explicitly marked as planned)", () => {
    const used = new Set([...guide.matchAll(/npm run ([a-z:-]+)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(8);
    for (const c of used) expect(Boolean(pkg.scripts[c]) || PLANNED.has(c), `npm run ${c}`).toBe(true);
    for (const c of PLANNED) expect(pkg.scripts[c], `${c} should not exist yet`).toBeUndefined();
  });

  it("button and menu names named in the guide exist in the app, and the guide names them", () => {
    const labels = [
      "Google 계정으로 연결", "연결 확인", "초기화 승인", "지금 동기화", "다시 연결", "연결 해제", "배치 진단 시작", "진단 이어서 하기", "진단 시작", "이어서 풀기",
      "목표 변경", "공식 시험일 저장", "공식 시험일 입력 (공고 확인 후)", "정답 확인", "다음 계속하기", "문제 신고", "JSON 내보내기", "가져오기 승인", "팩 내보내기",
      "진도 내보내기", "신고 목록 내보내기", "미검증 콘텐츠 포함 (연습에만 사용)", "그래도 추가", "도움말", "콘텐츠 추가 필요", "남은 학습 분량", "복습 시작", "약점 복습 시작", "시작 전 안내",
    ];
    for (const l of labels) {
      expect(appSource, `app lacks "${l}"`).toContain(l);
      expect(guide, `guide lacks "${l}"`).toContain(l);
    }
  });

  it("plan.md §8.4 messages appear verbatim in the guide's troubleshooting table", () => {
    const fixed = [MSG.LOCAL_FILE, MSG.GIS_FAILED, MSG.EXPIRED, MSG.NO_SCOPE, MSG.READ_ONLY, MSG.NOT_FOUND, MSG.DECLINED, MSG.QUOTA, MSG.UNSURE, MSG.BAD_URL, MSG.FOREIGN_TABS, MSG.PROFILE_MISMATCH, MSG.NEW_SCHEMA];
    const sect = guide.slice(guide.indexOf("## 10. 문제 해결"));
    for (const m of fixed) expect(sect, m).toContain(m);
    expect(sect).toContain("연결이 끊겼습니다. N건이 기기에만 저장되어 있습니다.");
    expect(MSG.OFFLINE(7)).toBe("연결이 끊겼습니다. 7건이 기기에만 저장되어 있습니다.");
  });

  it("screenshots referenced by the guide exist", () => {
    const refs = [...guide.matchAll(/\(screenshots\/([^)]+\.png)\)/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const r of refs) expect(statSync(join(root, "docs/screenshots", r)).size, r).toBeGreaterThan(5000);
  });

  it("the guide tells the user the truth about what is not verified yet", () => {
    expect(guide).toContain("Android 실기기와 실제 Google 연동은 아직 확인하지 못했다");
  });
});
