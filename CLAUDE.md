# JLPT App Implementation Rules

Read docs/execution_plan.md first (highest priority), then docs/plan.md and
docs/research_revised.md. Resume from docs/STATUS.md. Do not re-ask decisions
D1-D8 in execution_plan.md section 1.

Shipped app artifact: dist/index.html only (inline CSS/JS, minimal approved
seed). Listening audio is separate static files under audio/, deployed with the
app to GitHub Pages (index.html + audio/). Build-time TypeScript/esbuild and
modular sources are allowed. Report byte size every release.

file:// is LOCAL_FILE mode: no Google OAuth, no Sheets sync claims. Google
features run only on a registered HTTPS origin (or http://localhost for dev),
using GIS token flow and the sensitive spreadsheets scope on exactly the
user-pasted Sheet. No Picker, no drive.file, no client_secret, no tokens in
storage/logs/git.

Sheet is canonical for content AND user state. Never touch non-_JLPT_ tabs.
Events are batched (20 events / 60s / hide / session end), appended with RAW,
and acknowledged only after readback of eventId+checksum. Content is
append-only with immutable versions and incremental row-cursor loading.

Content is generated outside the app by tools/content (CLI). The app only
imports/exports packs (*.jlptpack.json). Generator model != verifier model.
LLM calls go through an LlmProvider interface with two implementations, "api"
(Anthropic API) and "headless" (claude -p in an empty cwd, fresh session per
call, text only), selectable per role in config.local.json.
Never copy official JLPT problems, recordings or textbook text. Imported
content is validated (IMP-01..11) before any write.

Quiz UX: no time limit by default; after submit wait for the user's
"다음 계속하기"; same 4 choices on question and feedback screens; never shrink
text or hide choices; every wrong choice explains WHY wrong and HOW to
correct; grammar items need real sentence context; settings for font size and
furigana on mobile. Dictation is the only input-type exception.

Level-neutral: never hardcode a JLPT level (N3 etc.) in identifiers, file or repo
names, sheet tabs, events or UI strings. Use targetLevel (setting), the item
level field and ExamSpec[level]. Per-level data lives in targets/<LEVEL>.json.
Run npm run lint:level-neutral.

Never convert raw scores into official JLPT scaled scores or pass
probabilities. Listening readiness always shows the TTS-source badge.

Keep docs/USER_GUIDE.md accurate: when UI labels, commands, error messages or
flows change, update the guide in the same commit.

For every task: implement -> run real tests -> check mobile layout -> commit ->
update docs/STATUS.md -> report. Mocks do not prove real Google integration.
Stop and ask only for: git push/Pages publish/repo visibility, cost above
MAX_USD_PER_RUN, requirement conflicts, rights issues.
