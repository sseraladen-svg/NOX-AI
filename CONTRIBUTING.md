<h1 align="center">Contributing to NOX-AI</h1>

<p align="center"><b>Small, focused pull requests that keep typecheck, lint and tests green.</b></p>

<p align="center">
  <a href="https://github.com/sseraladen-svg/NOX-AI">Repository</a> ·
  <a href="https://nox-ai-ten.vercel.app">Live app</a> ·
  <a href="#setup">Setup</a> ·
  <a href="#architectural-guardrails">Guardrails</a> ·
  <a href="#repository-map">Repository map</a> ·
  <a href="#quality-checks">Quality checks</a> ·
  <a href="#pull-request-checklist">PR checklist</a>
</p>

---

## Open contribution

NOX-AI is open for contribution. You do not need permission to start: fork the repository, create a branch from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`), and open a pull request.

The project was researched, planned, built and debugged by one person, Sera ([@sseraladen-svg](https://github.com/sseraladen-svg)). Every pull request is reviewed by hand, so small and focused changes get merged fastest.

## Setup

Needs Node.js 20 or later (22 or later for `npm test`) and a PostgreSQL database.

```powershell
git clone https://github.com/<your-username>/NOX-AI.git
cd NOX-AI
git remote add upstream https://github.com/sseraladen-svg/NOX-AI.git
npm ci
npx prisma generate
Copy-Item .env.example .env
# set DATABASE_URL, NOX_AI_SECRET (or AUTH_SECRET) in .env
npx prisma db push
npm run dev
```

Open http://localhost:3000.

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
2. Keep one concern per pull request.
3. Run the [quality checks](#quality-checks).
4. Open a pull request. The template in `.github/pull_request_template.md` lists what to include.

**Database changes.** Edit `prisma/schema.prisma`, run `npm run db:migrate` and commit the generated migration. Never point `db:push` at a database you care about.

**Dependencies.** Do not add a dependency without using it in the same pull request.

## Architectural guardrails

Read these before editing.

1. **Keep local Ollama browser-direct** (`src/lib/local-ollama.ts`). Local calls go from the user's browser to `127.0.0.1:11434` through `OLLAMA_ORIGINS`. Do not add a server proxy or tunnel for local model traffic.
2. **Respect server and client boundaries.**
   - `src/lib/multi-model/`, `src/lib/auth.ts`, `src/lib/crypto.ts` and `src/lib/db.ts` must keep `import "server-only";`.
   - Shared types and catalogs live in `src/lib/multi-model-types.ts`. Never import server-only modules there.
3. **API route conventions** (`src/app/api/`).
   - Declare `export const runtime = "nodejs";` on Node-dependent routes.
   - Authenticate with `getCurrentUser()` (return `401` when missing). Enforce `isRateLimited()` (return `429`) on mutating or model-dispatch routes.
   - Return the standard envelope: `{ ok: true, ... }` or `{ ok: false, error: string }`.
   - Keep telemetry (`saveUsage()`) in its own `try/catch` so a logging failure never breaks a user response.
4. **Workspace and agent changes** (`src/lib/workspace/`).
   - Preserve `isSensitivePath()` in `agent-protocol.ts` and `agent-exec.ts`.
   - Keep `<nox:edit>` backward-compatible.
   - Put pure logic in testable modules such as `topo-sort.ts`, `agent-routing.ts` and `multi-mode-workflows.ts`.
5. **Secrets.** Never log API keys or tokens. Error messages and traces must not include them.

## Repository map

| Path | Responsibility |
|---|---|
| `src/app/` | App Router pages (`/`, `/single`, `/multi`, `/orchestrator`, `/usage`) and `/api/*` routes |
| `src/components/nox/` | Mode pages, `feature-uis.tsx`, `mode-picker.tsx`, `usage-dashboard.tsx`, `workspace/` |
| `src/lib/multi-model/` | Server engine: `cache`, `shared`, `config-repo`, `providers`, `orchestrator`, `conversations`, `usage-logger` |
| `src/lib/workspace/` | Virtual FS (`vfs.ts`), `<nox:...>` protocol, `topo-sort.ts`, `agent-runner.ts`, `editor-bridge.ts`, `validators.ts` |
| `src/store/` | Zustand client stores |
| `prisma/schema.prisma` | PostgreSQL schema: `User`, `MultiModelConfig`, `Conversation`, `Message`, `UsageRecord`, `EphemeralState` |
| `tests/` | `node:test` suites: `agent`, `endpoint-guard`, `guest-session`, `workspace`, `routing-and-topo` |

## Adding a provider

1. Add the adapter in `src/lib/multi-model/providers`, modelled on an existing one.
2. Add its models and prices to the pricing table so cost tracking works.
3. Add it to the provider catalog in `src/lib/multi-model-types.ts` and to the config UI.
4. Confirm its key goes through `crypto.ts` and is masked on read.
5. If it takes a custom endpoint, run it through `assertSafeEndpoint()`.
6. Update the provider table in the README.

## Quality checks

These match `.github/workflows/ci.yml`.

```powershell
npm run typecheck   # 0 TypeScript errors
npm run lint        # 0 ESLint errors
npm test            # Node 22+, runs tests/*.test.mjs
npm run build       # production build
```

Add or update tests in `tests/` for any change to routing, the agent protocol, caching or workflows.

## Pull request checklist

- [ ] `typecheck`, `lint`, `test` and `build` pass
- [ ] One concern per pull request
- [ ] Tests added or updated for routing, protocol, cache or workflow changes
- [ ] No `.env`, API keys, tokens or database files in the diff
- [ ] Server-only modules still have `import "server-only";`
- [ ] New API routes follow the auth, rate-limit and envelope conventions
- [ ] README updated if behavior or configuration changed
- [ ] Screenshots attached for interface changes
- [ ] Related issue linked, for example `Closes #12`

## Reporting issues

Open an issue at https://github.com/sseraladen-svg/NOX-AI/issues with what you expected, what happened, steps to reproduce, the mode and provider, your OS, Node version and browser, and logs with keys removed.

**Do not report vulnerabilities in public issues.** Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree your work is released under the project's MIT license.
