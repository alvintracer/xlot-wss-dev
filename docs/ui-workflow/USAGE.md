# Tenant UI workflow

The root `guide.md` describes the stages and approval boundary. Start with `AGENTS.md`, then the tenant `ui-kit/README.md` and brief. Source images remain tenant-local. The CLI has no external upload or financial service calls.

```bash
npm run ui:tenant -- doctor
npm run ui:tenant -- discover
npm run ui:tenant -- intake --tenant namu --dry-run
npm run ui:tenant -- intake --tenant namu
npm run ui:tenant -- review --tenant namu
npm run ui:tenant -- capture --tenant namu --case wallet-main
npm run ui:tenant -- compare --tenant namu --case bottom-nav
npm run ui:tenant -- report --tenant namu
npm run ui:tenant -- verify --tenant namu
```

`review` serves the development-only UI at `http://127.0.0.1:5174/namu-review.html`; stop with Ctrl-C. `capture` starts that server temporarily if absent, waits for the page, captures a case with Chrome, and stops only its own process. Set `WSS_CHROME_PATH` if Chrome is elsewhere. Case definitions are in `tenants/namu/ui-kit/qa/cases.json`. Captures, reference crops, diffs, and HTML reports are local ignored files under `.artifacts/`; latest report is `tenants/namu/ui-kit/.artifacts/latest/report.html`.

`intake` supports PNG/JPEG/WebP in nested folders, including Korean and space-containing names. Existing IDs and manual classifications are retained by path or hash. Revisions make approved status stale; no command grants approval. The Namu review is synthetic and is excluded from the production Vite build entry graph. A Namu institution manifest requires approved product and security policy before live runtime activation.
