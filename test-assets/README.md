# test-assets

Minimum-viable PDFs with the exact dimensions Lob's API enforces for buckslips, cards, and postcard creatives. These are used by `tests/harness-live.mjs` / `tests/harness.mjs` to exercise tools whose underlying Lob endpoints validate file dimensions before accepting the request.

Regenerate with:

```bash
node test-assets/generate.mjs
```

The PDFs are intentionally minimal (light gray background + small label) — just enough to pass Lob's PDF-format and dimension checks. They contain no private data and are safe to keep in a public repo.

**npm:** excluded from the published tarball via the `files` array in `package.json` (only `build/` ships).
