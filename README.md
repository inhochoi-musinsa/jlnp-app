# jlpt-app

JLPT study app. The shipped app is a single file, `dist/index.html`. Listening audio is separate static files under `audio/`. Content is generated outside the app by the CLI in `tools/content/` and imported as packs.

- Plan (highest priority): `docs/execution_plan.md`, then `docs/plan.md`, `docs/research_revised.md`
- User guide: `docs/USER_GUIDE.md`
- Progress / resume file: `docs/STATUS.md`

## Developer commands

```bash
npm install          # uses a project-local npm cache (.npmrc)
npm run build        # -> dist/index.html (exactly one file)
npm run serve        # http://localhost:8080 (dev/verification only)
npm run size         # byte size, gzip, sha256, external-ref check
npm run check        # typecheck + tests + build
```

Execution modes: opening `dist/index.html` with `file://` is LOCAL_FILE mode (no Google sign-in). Google features run only on a registered HTTPS origin (or `http://localhost:8080` for development).
