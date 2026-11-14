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
  hooks/          use-chat.ts (SSE handling, confirmation and resume flow)
  store/          Zustand stores (config, conversations)
  lib/            multi-model-service.ts, multi-model-types.ts, crypto.ts, api-key-mask.ts,
                  auth.ts, rate-limit.ts, ephemeral-state.ts, endpoint-guard.ts, logger.ts,
                  local-ollama.ts, guest-session.ts, engineering-workspace.ts
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

## Roadmap

- Automatic fallback to another configured model when a provider fails or hits its quota
- Streaming for the remaining providers
- Retrieval over uploaded documents (chunking and embeddings)
- Image generation on more providers
- Tool calling for agents beyond the Engineering specialist

## Author

Built by [Sera](https://github.com/sseraladen-svg).
