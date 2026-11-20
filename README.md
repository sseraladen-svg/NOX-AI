# NOX AI

**Multiple AI systems. One controlled platform.**

NOX AI is a multi-model AI chat platform. You bring your own API keys or run local models, choose which model handles which task, and see the model, tokens, latency and cost of every call.

- Live app: https://nox-ai-ten.vercel.app
- Demo video: _add link here_

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6) ![Prisma](https://img.shields.io/badge/Prisma-PostgreSQL-2D3748) ![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC)

---

## The problem

People now use several AI models: one for chat, one for code, one for images. Each has its own app, keys, limits and billing. In practice that means:

- constant switching between platforms
- no single view of what each call actually cost
- local models that take manual setup most people never finish

## The solution

One workspace where you connect your own providers and decide how they are used.

| Mode | What it does |
|---|---|
| **Single** | One model handles every request. Simplest setup. |
| **Multi** | Six independent features (Chat, Voice, Vision, Coding, Automation, Robotics). Each has its own provider, model, key and connection type. The active tab sends the feature ID, so routing is explicit, with no guessing. |
| **Orchestrator** | A Host model classifies the request and shows you the plan. After you confirm, a specialist (Planning, Coding, Vision, Automation or Engineering) runs it and the Host writes the final answer. |

Every response carries a **dispatch trace**: model, provider, local or API, tokens in and out, latency and cost.

## Features

- **10 provider entries.** API: OpenAI, Anthropic, Gemini, Mistral, Groq, OpenRouter, Z.ai. Local: Ollama, llama.cpp, llamafile.
- **Local or API per role.** Choose the connection type separately for each feature, the Host and each specialist.
- **Local Ollama on a hosted app.** Your browser calls your own Ollama directly (see [Using local models](#using-local-models-ollama)). No tunnel and no proxy.
- **Cost tracking.** Cost is computed from provider-reported token counts and a per-model pricing table, with a usage dashboard by model, provider and day.
- **Streaming.** Gemini streams token by token over SSE. Ollama streams in the browser. Other providers currently return the full response at once.
- **Attachments.** Images (for vision-capable models) and text documents (`.txt`, `.md`, `.csv`, `.json`, `.html`, `.xml`) added to the prompt as context.
- **Image generation** (OpenAI) and **voice**: browser speech-to-text and ElevenLabs text-to-speech.
- **Orchestrator workspace.** A VS Code-style IDE inside Orchestrator mode: Monaco editor with tabs, file explorer, resizable panes and an integrated terminal next to the Host chat. See [Orchestrator workspace](#orchestrator-workspace).
- **Coding view.** Extracted code blocks, HTML preview and file download.
- **Fail-fast errors.** Real provider reasons (rate limit, connection refused, missing permissions) instead of generic failures. Model calls are not retried automatically.
- **Guest mode.** Try it without an account (see below).

## How it works

```
Browser (Next.js / React)
  Single, Multi and Orchestrator UI
  SSE stream reader
  Ollama bridge  ->  http://127.0.0.1:11434   (your machine)
        |
API routes (Node runtime)
  auth, rate limiting, dispatch, dispatch-stream, dispatch-resume
        |
Service layer
  resolve plan -> provider adapter -> cost calculation
        |                                  |
Postgres (Prisma)                 Provider APIs
  users, configs, chats, usage    OpenAI, Anthropic, Gemini, ...
```

**Request flow**

1. The browser sends the message to `dispatch-stream`.
2. The server checks auth and rate limits, loads the role's config and decrypts its API key.
3. The server builds the plan. Single and Multi use the role's config directly. Orchestrator classifies the request, asks for your confirmation, runs the specialist, then synthesizes.
4. **API role:** the server calls the provider.
5. **Local Ollama role:** the server returns a `pendingClientExec` signal. Your browser runs the prompt on your own Ollama and posts the result to `dispatch-resume`, and the server continues the pipeline.
6. The trace and usage record are saved and returned.

## Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| Bring your own key | No markup, no compute bill for the platform | Users need their own keys |
| Browser-side Ollama bridge | A hosted server cannot reach a user's `localhost`, and tunnels add an install step | Needs one Ollama setting; llama.cpp and llamafile cannot use it |
| Explicit feature ID in Multi | Deterministic routing | The user picks the tab |
| Model-driven classification plus a confirmation step in Orchestrator | The routing decision is visible and can be stopped | Extra model calls per request |
| Provider-reported tokens for cost | Real numbers instead of estimates | Pricing table must be kept up to date |
| AES-256-GCM for stored keys, masked on read | Keys are never returned in plaintext | One server secret to protect |
| Approvals, resume steps and rate limits in Postgres | In-memory state breaks across serverless instances | One small table and a query per check |
| No automatic retry | Retries were doubling requests into rate limits | A one-off network blip shows as an error |
| Separate timeouts for connection checks and generations | Long answers need more time than a reachability ping | Two values to tune |

## Orchestrator workspace

Orchestrator mode opens as a code workspace (toggle back to the classic chat layout with the button in the header).

- **Editor:** Monaco (the VS Code engine), see [Editor features](#editor-features).
- **Files:** a virtual workspace stored in your browser (IndexedDB), upload support, or **Open folder** to edit a real folder on your computer through the browser File System Access API (Chrome / Edge). Edits to a real folder are written to disk on save (or automatically after 1 second); creating, renaming and deleting files is mirrored immediately. `node_modules`, `.git`, `.next`, `dist` and binary or very large files are skipped.
- **Agents work in the editor, not in chat.** The right pane is the Orchestrator agent: it creates, edits and deletes files in the editor, runs code in the terminal and reports short status. The classic chat layout is still available from the header toggle.
- **Terminal (xterm.js):**
  - *Virtual* shell over the workspace files: `ls`, `cd`, `cat`, `mkdir`, `touch`, `rm`, `mv`, `cp`, `echo > file`, `grep`, `find`, `tree`, `open`, and `node file.js`.
  - `node` and the editor **Run** button execute JavaScript in a sandboxed iframe worker (no cookies, no access to the app's API; 8 second limit). HTML files preview in a sandboxed iframe with relative CSS and JS inlined.
  - *Local shell* runs real commands on the machine hosting the app. It is off by default and only works when `NOX_LOCAL_TERMINAL=1`, you are signed in, the request targets `localhost`, and the app is not on Vercel. Commands run with the server user's permissions, so enable it only on your own computer. Secrets (`AUTH_SECRET`, `NOX_AI_SECRET`, database URLs) are removed from the command environment.

### Editor features

| Area | What you get |
|---|---|
| Editing | Monaco: IntelliSense and diagnostics for JS/TS/JSON/CSS/HTML across all workspace files, multi-cursor, folding, bracket colors, sticky scroll, snippets, minimap, find/replace, format document, format on save |
| Navigation | Quick Open `Ctrl+P` (fuzzy), command palette `Ctrl+Shift+P`, go to line `Ctrl+G`, go to symbol `Ctrl+Shift+O`, breadcrumbs, tabs with drag reorder, close others/all, copy path |
| Search | Find in Files `Ctrl+Shift+F` with regex, case, whole word, include/exclude globs, replace in file or everywhere |
| Changes | Source-control style view of everything changed since the workspace was opened, side-by-side diffs, discard per file, accept all |
| Problems | Problems panel and status bar counts from the editor's diagnostics; click to jump |
| Terminals | Several terminals (virtual shell, optional Local shell), run JavaScript, sandboxed HTML preview |
| Cursor-style AI | `Ctrl+K` edit the selection with your Coding model (undo with `Ctrl+Z`); optional ghost-text inline completions (off by default, uses tokens) |
| Look and feel | 8 themes, font size, tab size, word wrap, line numbers, status bar with line/column, language, changes and problems |
| Shortcuts | `Ctrl+S` save, `Ctrl+B` sidebar, ``Ctrl+` `` terminal, `Ctrl+Shift+M` problems, `Ctrl+Shift+A` focus the agent |

Not included: a debugger, extensions marketplace, language servers for Python/Java/etc. (they get syntax highlighting only), real git, and split editor groups.

### Agent: AI that edits your files

The **Agent** tab (default in the workspace) works like VS Code agent mode. You describe a task; the agents create, edit, read, rename and delete files in the workspace themselves, run JavaScript to check their work, and show every step. Nothing is pasted into chat for you to copy.

**Flow**

1. **Analyze (rules first, 0 tokens).** The request is classified by rules into intent (question, create, change, clean-up, automation, plan-only), size (small, medium, large) and the agents it needs. If the rules are unsure (match under 60%) and your Host model is suitable, one tiny Host call (about 150 tokens) classifies it instead; vision-only Host models are skipped.
2. **Plan check popup.** Before anything runs you see the agents that will be used, why each is needed, and whether its model is ready. It checks live: API key saved, Ollama reachable, model installed, and whether the model suits coding. Unavailable agents show an alternative (use the Coding model, or `ollama pull qwen2.5-coder:7b`). You can switch each agent's model, turn optional steps off, and then press **Run agents**. A setting controls when it appears: always, bigger tasks only, or never.
3. **Run.** Plan (Planning model) for large tasks, then Build (Coding or Automation model) using a pre-written creation playbook, then automatic checks, then Review (Engineering model) only when it is useful. Each step is a single model call.
4. **Result.** Summary, files changed, model calls used, and **Keep / Undo / Review changes** (diff view).

| Task | Agents | Steps |
|---|---|---|
| Question ("explain this") | Coding, read-only | up to 3 |
| Small create/change | Coding | up to 4 |
| Medium | Coding, optional Review | up to 8 |
| Large | Planning, Coding, Review | up to 12 |
| "Plan …" | Planning only | 1 |

**Creation playbooks and quality checks** (`playbooks.ts`, `validators.ts`)

- The builder starts with a short playbook for the detected kind (web page, JavaScript script, Python, React, server, docs, config) and topic (calculator, to-do, timer, form, game, landing page, dashboard, API client): file layout, accessibility, edge cases and how to verify.
- After building, zero-token checks run on every changed file: JavaScript syntax, JSON validity, CSS braces, broken `src`/`href`/`import` references, leftover placeholders, plus the editor's own diagnostics. Problems are sent straight back to the builder to fix, then re-checked (1 round for small tasks, 2 for larger).

**Efficiency rules** (`AGENT_RULEBOOK` in `src/lib/workspace/agent-prompts.ts`, enforced in code)

- Rules decide intent and agents, not a model call.
- Only needed agents run; Review only when 2+ files changed or a run failed.
- Questions are read-only; writes are rejected.
- Context diet: file tree plus open files; the planner sees the tree only; bodies of files the agent changed are dropped from later steps.
- Old file contents and tool results are trimmed before each call.
- Actions are batched; a small task finishes without an extra call after a clean write.
- Step, context and output limits scale with task size; the Ollama context is sized to the real prompt.
- Agents pass a compact handoff (plan, changed files, run output, open issues) instead of the whole conversation.
- If an agent's model is unavailable the next best one is used, or you choose in the popup.

**Actions** the agents use: `<nox:write>`, `<nox:edit>` (exact find and replace), `<nox:delete>`, `<nox:rename>`, `<nox:mkdir>`, `<nox:read>`, `<nox:list>`, `<nox:search>`, `<nox:run>`, `<nox:shell>`, `<nox:done>`. A fenced block starting with `// file: /path` is accepted as a fallback for small models. The prompts live in the same file; edit them to change behaviour.

**Safety:** `.env`, keys, `.git` and `node_modules` are never read, sent to a model or modified. Agents cannot delete folders. Shell commands are off by default and need the Local shell plus a confirmation for each command.

**Models:** local Ollama models run directly in your browser; API models go through `/api/workspace/agent-turn`. For reliable editing use a coder model of 7B or more (for example `qwen2.5-coder:7b`); very small models often break the action format, and vision models such as `moondream` are flagged as unsuitable.

## Getting started

Requires a current Node.js LTS (20+) and a PostgreSQL database.

```powershell
git clone https://github.com/sseraladen-svg/NOX-AI.git
cd NOX-AI
npm install
Copy-Item .env.example .env
# edit .env (see below)
npm run db:push
npm run dev
```

Open http://localhost:3000.

> `npm run db:push` syncs the schema without migrations. Use it on a development database only. Run `npm run db:push` once after pulling to create the `EphemeralState` table that stores approvals, resume steps and rate-limit counters.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `POSTGRES_URL` | Yes (Vercel) | Same database, used by the Vercel integration |
| `NOX_AI_SECRET` | Yes | Encrypts stored API keys |
| `AUTH_SECRET` | Yes | Signs session tokens |
| `ELEVENLABS_API_KEY` | No | Enables text-to-speech |
| `ELEVENLABS_VOICE_ID` | No | Voice used for text-to-speech |
| `NOX_LOCAL_TERMINAL` | No | Set to `1` to enable the Local shell tab (local machine only) |
| `NOX_WORKSPACE_ROOT` | No | Root folder for the Local shell (defaults to the app's working directory) |

Use long random strings for both secrets and keep them out of version control.

### Deploying to Vercel

Set the variables above in the project settings. The build command is `npm run vercel-build` (`prisma generate && next build`). Use a database region and a deployment region your AI providers support.

## Development

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (unused code and hook dependency warnings are on)
npm test            # node:test unit tests
npm run build       # production build
```

CI runs the same four commands on every pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Accounts and guest mode

- **Account:** configs, conversations and usage are stored per user in the database. API keys are encrypted.
- **Guest:** settings and conversation history stay in your browser storage. No usage metrics are recorded, Orchestrator is unavailable, and hosted models need an API key entered for each request. Guest requests are limited to 10 MB.

## Using local models (Ollama)

Your browser talks to Ollama on your own machine, so the site must be allowed to call it.

1. Install Ollama and pull a model that fits your hardware:
   ```powershell
   ollama pull llama3.2:latest
   ```
2. Allow your NOX AI origin permanently (replace with your own domain, or `http://localhost:3000` for local development):
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "https://nox-ai-ten.vercel.app", "User")
   ```
3. Quit Ollama completely (also from the system tray) and start it again so it picks up the variable.
4. In NOX AI choose **Local CLI**, provider **Ollama**, endpoint `http://127.0.0.1:11434`, pick the model and press **Test**.

Troubleshooting:

- **Port already in use:** Ollama starts in the background at login. Stop it with `Stop-Process -Name "ollama*" -Force`, then start it again.
- **HTTP 400 when sending an image:** the model is text-only. Use a vision model such as `llama3.2-vision` or `moondream`.
- **Out-of-memory on load:** the model is too large for your RAM or GPU. Try a smaller one.

## Security

- API keys are encrypted at rest with AES-256-GCM and masked whenever they are sent back to the browser.
- Passwords are hashed with scrypt. Sessions are signed tokens.
- All configs, conversations and usage records are scoped to the signed-in user.
- Per-IP rate limiting on auth, dispatch and test routes, shared across serverless instances through Postgres.
- Custom provider endpoints are validated: only http(s), no embedded credentials, no cloud-metadata hosts, and no private or loopback hosts for API connections in production.
- Passwords must be at least 8 characters on signup and reset. Responses carry `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` headers.
- Error messages and traces never include API keys.

## Project structure

```
src/
  app/            pages (single, multi, orchestrator, usage) and API routes
  components/nox/ mode pages, config forms, chat UI, confirmation dialog
  components/nox/workspace/ editor, explorer, terminal, preview, IDE layout
  hooks/          use-chat.ts (SSE handling, confirmation and resume flow)
  store/          Zustand stores (config, conversations)
  lib/            multi-model-service.ts, multi-model-types.ts, crypto.ts, api-key-mask.ts,
                  auth.ts, rate-limit.ts, ephemeral-state.ts, endpoint-guard.ts, logger.ts,
                  local-ollama.ts, guest-session.ts, engineering-workspace.ts,
                  workspace/ (virtual file system, shell, sandboxed JS runner, editor context)
prisma/           schema.prisma
tests/            node:test unit tests
.github/          CI workflow and pull request template
```

## API overview

| Group | Routes |
|---|---|
| Auth | `/api/auth/signup`, `login`, `logout`, `me`, `reset-password` |
| Config | `/api/multi-model/config`, `providers`, `test`, `limits`, `export-import` |
| Dispatch | `/api/multi-model/dispatch`, `dispatch-stream`, `dispatch-resume` |
| Conversations | `/api/conversations/list`, `create`, `get`, `rename`, `delete`, `save-message` |
| Usage | `/api/usage/summary`, `/api/usage/recent` |
| Workspace | `/api/workspace/exec` (Local shell; disabled unless enabled and local), `/api/workspace/agent-turn` (one agent model call, API roles) |
| Health | `/api/health` (liveness and database check) |
| Guest | `/api/guest/dispatch`, `dispatch-resume`, `test` |
| Voice | `/api/voice/elevenlabs` |

## Known limitations

- **Streaming** is real for Gemini and for Ollama in the browser. Other providers return the full response.
- **Document attachments are not RAG.** The text is added to the prompt (capped at 100,000 characters). There is no chunking, embedding or retrieval.
- **llama.cpp and llamafile** need the binary on the machine running the server, so they do not work on a hosted deployment.
- **Engineering specialist** works on the project folder of the machine running the server. It is meant for local use, not as an agent for a user's own repository on the hosted app.
- **Image generation** supports OpenAI only.
- **No quota fallback.** If a provider runs out of quota the call fails; it does not switch to another model.
- **No admin or team view.** Each user sees only their own usage.

- **Workspace** terminal and editor were verified with unit tests, a production build and API tests for the Local shell, but not driven in a real browser during development. Real-folder access works only in Chromium browsers. Terminal line editing supports typing, backspace and history, not cursor movement. Monaco loads from a CDN, so the editor needs internet access.

## Roadmap

- Automatic fallback to another configured model when a provider fails or hits its quota
- Streaming for the remaining providers
- Retrieval over uploaded documents (chunking and embeddings)
- Image generation on more providers
- Tool calling for agents beyond the Engineering specialist

## Author

Built by [Sera](https://github.com/sseraladen-svg).
