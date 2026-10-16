# T07 real Google E2E checklist (NOT YET RUN)

Status: **BLOCKED(GOOGLE)** — no OAuth Client ID, no registered HTTPS origin, no test sheets, no Android device were available.
Everything in `tests/google/*` and `tests/ui/google.ui.test.ts` uses a FAKE Sheets API and a stub GIS script. Those results prove code paths only.

When the prerequisites (execution_plan §11 A, C, D) exist, run and record here (pseudonymous sheet ids only, no tokens):

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Open the Pages URL in PC Chrome, `설정 > 시트 연결 > Google 계정으로 연결` | Consent screen lists the Sheets scope; no Picker appears | not run |
| 2 | Paste the empty test sheet URL, `연결 확인`, `초기화 승인` | 5 `_JLPT_*` tabs, headers, META, seed rows; other tabs unchanged | not run |
| 3 | Same flow on the sample-data sheet | Existing tabs/cells identical before and after (diff = 0) | not run |
| 4 | Study 10 questions, change font size, set a target | Badge shows `동기화 완료` only after the read-back; rows visible in `_JLPT_EVENTS` | not run |
| 5 | Reload, reconnect, same sheet | No duplicate tabs or seed rows; settings/target/diagnostic restored | not run |
| 6 | Second device (Android Chrome HTTPS) joins the same sheet | Profile adopted, history restored, diagnostic not restarted | not run |
| 7 | Wait for token expiry (~1 h) while studying | `다시 연결 필요`, events stay local, reconnect resumes | not run |
| 8 | Airplane mode while studying | `오프라인` + `연결이 끊겼습니다. N건이 기기에만 저장되어 있습니다.`; later auto-send | not run |
| 9 | Open the app via `file://` | Local-mode notice, no Google request | PC headless Chrome: PASS (fake-free, see tests/ui/google.ui.test.ts); Android: not run |
| 10 | Share the sheet read-only to the test account | `이 스프레드시트에 앱 기록을 쓸 수 없습니다.` | not run |
| 11 | Quota: measure real write/read limits and the time for 3,000 content rows on Android (storage gate) | Record numbers in `docs/decisions/storage-gate.md` | not run |
| 12 | `_JLPT_EVENTS` cell/row growth: 5,000 events | still within limits | not run |

Unverified assumptions in the code that this run must confirm: the shape of Google's 403 error bodies (`SCOPE_INSUFFICIENT`, `SERVICE_DISABLED`), the exact `updatedRange` format of `values.append`, `valueRenderOption=UNFORMATTED_VALUE` keeping long hex checksums as text, and the per-cell character limit.
