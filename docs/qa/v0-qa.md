# v0.1.0 QA record (execution_plan T09, plan.md §11.1–11.4)

Environment of every automated result below: macOS 14 (Darwin 23.6), Node v22.16.0, Google Chrome 155.0.8059.84 **headless on PC** (Playwright core driving system Chrome), `npm run check` = typecheck + level-neutral lint + secret scan + 262 tests + build.
**Not available in this session:** Android Chrome device, a Google OAuth Client ID, a registered HTTPS origin, test spreadsheets, a published Pages URL.
Legend: **PASS** = verified as stated · **PASS(FAKE)** = verified only against an in-memory fake Google/Sheets (code path, not Google) · **BLOCKED(x)** = needs x that was not available · **미확인** = not checked.

## §11.1 automated tests

| ID | Result | Evidence |
|---|---|---|
| TST-RUNTIME-01 file mode | PASS | `tests/unit/runtime.test.ts`; `tests/ui/google.ui.test.ts` (file:// → exact notice, 0 Google requests); `tests/ui/quiz.ui.test.ts` (file:// → no network request outside file://) |
| TST-RUNTIME-02 https mode | PASS(FAKE) / BLOCKED(GOOGLE) | detection is unit tested; "login button active on https" exercised on localhost dev mode with a stub GIS script |
| TST-PACK-01 single file | PASS | `tests/unit/build.test.ts`; `scripts/measure-size.mjs` externalRefs = [] |
| TST-PACK-02 size budget | PASS | 203,427 bytes (198.7 KiB) ≤ 300 KiB |
| TST-SCHEMA-01 | PASS | `tests/unit/schema.test.ts` (5 levels, N5/N4 two scoring sections, record validation) |
| TST-DATE-01/02/03 | PASS | `tests/unit/target.test.ts` (2027/07→07-04, 2027/12→12-05, 2028/07→07-02; 262 h / 416 h; change keeps history) |
| TST-DIAG-01/02 | PASS | `tests/unit/domain.test.ts`, `tests/ui/flow.ui.test.ts` (28 questions, routes, resume, no second submit) |
| TST-PLAN-01 | PASS | `tests/unit/domain.test.ts` (≤60, deduction, excluded listening not counted as done) |
| TST-QUIZ-01 | PASS | `tests/ui/quiz.ui.test.ts` (10.5 s no auto-advance, 10 rapid taps) |
| TST-QUIZ-02 | PASS | 4 choices fixed, per-wrong-choice why/how shown; lint blocks missing explanations |
| TST-QUIZ-03 | PASS (local) | S/M/L/XL × ruby modes; settings events and projection. Remote restore of *settings* through the sheet: PASS(FAKE) path only (events), not run against Google |
| TST-CONTENT-01 | PASS(FAKE) | pack import and sheet content pull add items without any rebuild (`tests/ui/content.ui.test.ts`, `tests/google/connection.test.ts`) |
| TST-CONTENT-02 | PASS(FAKE) | `tests/google/google.test.ts` (second init adds 0 tabs/rows) |
| TST-CONTENT-03 | PASS | new versions are new rows; packs without per-wrong-choice reasons are rejected (`tests/content/import.test.ts`). Audio rights: not applicable before v2.0.0 |
| TST-SYNC-01 | PASS | `tests/storage/storage.test.ts` |
| TST-SYNC-02 | PASS(FAKE) | lost response / 5xx after write: no duplicate (`tests/google/sync.test.ts`) |
| TST-SYNC-03 | PASS(FAKE) | union of two devices, latest `occurredAt` wins, toast callback (execution_plan §2 replaces "ask the user") |
| TST-MIG-01 | 미확인 | needs a v1 fixture; first relevant at v1.0.0 |
| TST-READINESS-01 | n/a | v3.0.0 |

## §11.2 UI and device QA

| Case | Result |
|---|---|
| PC Chrome file:// | PASS (headless): renders, local-mode notice exact, OAuth never attempted |
| Android Chrome file:// / content:// | **BLOCKED(DEVICE)** — not run; no claim of mobile file-mode support |
| Android Chrome HTTPS (Google login, sheet write, reload, font/furigana kept) | **BLOCKED(GOOGLE, DEVICE)** |
| GitHub Pages single-file publish | **BLOCKED(USER APPROVAL)** — `npm run deploy` stages `site/` only; publishing needs approval (git push / repo visibility / Pages) |
| Viewports 320×568, 360×640, 390×844 | PASS (emulated viewports in desktop Chrome): all 28 real diagnostic screens question+feedback at font XL 320×568; S/M/L/XL demo matrix. **Real-device check: BLOCKED(DEVICE)** |
| Answer/feedback transition | PASS: 4 choices stay, font size unchanged, wrong-choice detail on tap |
| User advance | PASS: no auto-advance after 10.5 s; 10 rapid taps |
| Keyboard / screen reader | 부분: touch targets ≥ 44 px asserted, focus ring in CSS, `aria-live` regions; **manual screen-reader pass 미확인** |
| Browser process kill with pending events | 부분: reload keeps IndexedDB events (PASS); real process kill 미확인 |
| Real ja-JP voices | n/a (audio starts v2.0.0) |

## §11.3 Google Sheets integration

Every row: **code path PASS(FAKE)** (`tests/google/*`, `tests/ui/google.ui.test.ts`), **real Google BLOCKED(GOOGLE)**. See `docs/qa/t07-real-e2e-checklist.md` for the run sheet.

| Case | Fake result |
|---|---|
| New empty sheet | 5 tabs + headers + META + seed; user tabs byte-identical; no Picker code exists |
| Sheet with existing data | `_JLPT_*` only; existing tabs diff 0 |
| Second run | 0 new tabs/seed rows |
| HTML replaced | n/a at v0.1.0 (single release) |
| Other device | adopts profile, restores target/diagnostic/content |
| 401/403/404/consent denied | exact messages (`tests/google/google.test.ts`) |
| 429/5xx/lost response | backoff, check-before-resend, no duplicates |
| No permission / typo URL | no write, no fallback to another id |
| Meta conflict / newer schema | read-only, 0 writes |
| Concurrent devices | union; latest target wins + toast |
| Content expansion | no HTML change needed |
| Disconnect | token/binding forgotten, data kept |
| file:// backup merge into HTTPS | PASS (local): backup→restore, preview, no duplicates (`tests/storage/storage.test.ts`, `tests/ui/storage.ui.test.ts`) |

## §11.4 V0 gate

| Gate item | Status |
|---|---|
| One-file build, desktop file mode | PASS |
| Android HTTPS UX | BLOCKED(DEVICE, GOOGLE) |
| 28 diagnostic questions "reviewed" | All 45 seed items auto-verified (sonnet generated, opus verified, `docs/STATUS.md`); **no human language/rights review done** — treat as unreviewed by a person |
| Target year/month change | PASS |
| Sheet init + write + read-back | PASS(FAKE) / BLOCKED(GOOGLE) |
| Upgrade settings restore | n/a (first release) |

**Release decision:** P0 items remain open (real Google E2E, Android device, human content review, user-approved publish). **The `v0.1.0` tag is NOT created** (execution_plan T09: tag withheld while a P0 is open).
