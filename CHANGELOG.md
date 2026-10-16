# Changelog

Sections: Added / Changed / Fixed / Migrated / Content / Compatibility / Known Issues

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
