# Changelog

Sections: Added / Changed / Fixed / Migrated / Content / Compatibility / Known Issues

## 4.0.0 (release candidate, not tagged)
### Added
- Local recovery points; stepwise IndexedDB upgrade to v3; two-device target conflict choice; `deviceSeq` repair; large-log tests.
### Fixed
- `.gitignore` excluded tools/, tests/content/ and app/src/content/ from all earlier commits.
### Compatibility
- Data written by v0.1.0 / v1.0.0 / T14 builds restores without loss (real fixtures). Sheet schema unchanged (1).
### Known Issues
- No `_JLPT_SNAPSHOTS` sheet tab (BLOCKED(GOOGLE)); mobile performance unmeasured.

## 3.0.0 (release candidate, not tagged)
### Added
- Assessment sets (ASSESS pool isolated from learning), readiness (28 days, first exposure, n<20 자료 부족), SVG report, declared official results.
### Fixed
- Duplicate `deviceSeq` for concurrent event writes; stale model right after a quiz; listening audio key lost in revision.
### Known Issues
- Assessment content volume BLOCKED(COST); readiness thresholds are unvalidated operating policy.

## 2.0.0 (T13–T14, not separately tagged)
### Added
- Listening player (generated file > recorded override > browser voice), replay limit, source badge, TTS limit notice, script/replay in feedback.
- Dictation (듣고 쓰기) with kana diff; `content:audio`; settings > 고급.
### Fixed
- A late settings refresh could redraw a running quiz.
### Known Issues
- Real TTS synthesis BLOCKED(TTS); Android playback BLOCKED(DEVICE).

## 1.0.0 (release candidate, not tagged)
### Added
- Review engine (5 stages, cards, 25-minute rule, weak review), grammar principles, confusing-letter quiz.
- content:plan / content:fill / grammar taxonomy; KANA generation and lint.
### Changed
- Daily new-item cap counts words, not cards; runway per area.
### Content
- 20 confusing kana pairs generated and verified (packs/, not committed).
### Known Issues
- Initial vocabulary/grammar/kanji volume BLOCKED(COST). See docs/releases/V1.md.

## 0.1.0 (release candidate, not tagged)
### Added
- Single-file app (dist/index.html), local mode, quiz shell, diagnostic (28 questions), exam target, 60-minute plan.
- Local outbox + IndexedDB, JSON backup/restore, pack import/export (IMP-01..11), reports, progress/flags export, runway.
- Google token flow, Sheets adapter, non-destructive init, batched sync with read-back ACK (verified against a fake API only).
- Content CLI (tools/content): api + headless providers, gen/verify/pack/ledger/catalog/sample/seed/doctor.
- In-app help; deploy script (stages only; publishing needs approval); secret scan.
### Content
- Seed pack: 45 items, auto-verified (generator sonnet, verifier opus).
### Known Issues
- Real Google E2E and Android device QA not done (BLOCKED). See docs/releases/V0.md.

## Unreleased
### Added
- T00 fact-check records (docs/qa, docs/decisions).
- T01 repository, single-file build (`npm run build`), size report, dev server.
