## Definition of Done
- [ ] README covers: what it is, how to run locally (Docker Compose), how it's deployed (if applicable)
- [ ] CLAUDE.md skeleton filled in (What this is / Commands / Architecture invariants / Gotchas)
- [ ] Runs via `docker compose up -d --build` with no undocumented manual steps
- [ ] FE and BE are separately runnable/testable (no accidental coupling)
- [ ] Hosting, if any, is confirmed within AWS Always Free limits
- [ ] Tests pass (`npm test`) — or explicitly noted as "no tests yet, tracked in docs/decisions.md"
- [ ] No secrets committed; anything sensitive is in SSM/`.env`, not source
- [ ] `docs/decisions.md` updated if this PR includes a hard-to-reverse call
- [ ] `/code-review` run and findings resolved or consciously deferred
