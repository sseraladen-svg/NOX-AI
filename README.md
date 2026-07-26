# NOX AI — Multi-Model Intelligence Platform

NOX AI is a multi-model AI chat platform that lets you assign different AI models to different tasks within a single conversation. Three modes: **Single** (one model for everything), **Multi** (different model per feature), and **Orchestrator** (Host routes prompts to specialists).

## Features

- **3 Modes**: Single, Multi (6 feature tabs), Orchestrator (Host + 5 specialists)
- **Model-driven intent classification**: Orchestrator mode uses a Host model call (not keyword regex) to classify intent and route to specialists. Includes confidence threshold, JSON parsing, and keyword fallback on failure.
- **8 Providers**: OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama, llama.cpp, llamafile
- **Per-role connections**: Each role independently API Key or Local CLI
- **Real vision**: Upload images, sent to vision-capable models (GPT-4o, Claude 3.5, Gemini)
- **Real voice**: Browser-native STT (SpeechRecognition) + TTS (speechSynthesis)
- **Cost tracking**: Token usage + USD cost per call, usage dashboard with charts
- **Markdown rendering**: Code blocks with copy buttons, tables, lists, blockquotes
- **Security**: AES-256-GCM API key encryption, scrypt passwords, HMAC sessions, rate limiting
- **6 feature UIs**: Chat (bubbles), Coding (split editor), Voice (mic+TTS), Vision (image upload), Automation (node canvas), Robotics (sensor grid)
- **Context truncation**: Long conversations are truncated to fit specialist context windows
- **Classification trace**: The Host's classification call is logged in the dispatch trace with tokens, cost, and latency — same as any other pipeline step
- **Cached classification**: When the user confirms a multi-agent task, the classification is cached and passed back to avoid re-running the classification call
- **Heartbeat for LOCAL calls**: Ollama (streaming mode) and CLI subprocesses (spawn with stdout monitoring) reset the timeout on each data chunk, up to 3x the configured timeout — slow-but-working local models are no longer killed mid-generation
- **Host pre-verification**: Orchestrator mode checks Host reachability before spending a classification call — if the Host is unreachable, returns immediately with a clear error instead of silently wasting a call

## Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Database**: SQLite via Prisma ORM (5 models)
- **Auth**: scrypt password hashing + HMAC session tokens
- **Styling**: Tailwind CSS 4 + shadcn/ui + Framer Motion
- **State**: Zustand (client) + TanStack Query (server)

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Create .env file
echo 'DATABASE_URL=file:./db/custom.db' > .env
echo 'NOX_AI_SECRET=change-this-to-a-random-32-char-string' >> .env

# 3. Initialize database
bun run db:push

# 4. Start dev server
bun run dev
```

Open `http://localhost:3000`, sign up, configure your API key in Advanced, and start chatting.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite file path or PostgreSQL URL |
| `NOX_AI_SECRET` | Yes | Encrypts API keys at rest + signs session tokens |

## Deployment

### Vercel (recommended)
1. Push to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Set `NOX_AI_SECRET` env var (generate a random 32+ char string)
4. Set `DATABASE_URL` to a Vercel Postgres connection string (update `prisma/schema.prisma` provider to `postgresql`)
5. Deploy

### Railway / Render
1. Push to GitHub
2. Connect the repo
3. Set env vars
4. Deploy

### VPS (DigitalOcean, Hetzner, etc.)
```bash
git clone <your-repo>
cd nox-ai
bun install
echo 'DATABASE_URL=file:./db/custom.db' > .env
echo 'NOX_AI_SECRET=your-secret' >> .env
bun run db:push
bun run build
bun run start
```

## Important Notes

- **Region restrictions**: OpenAI and Gemini block Hong Kong / mainland China. Deploy in US/EU/India for these providers to work.
- **API keys**: Keys are encrypted at rest. The `NOX_AI_SECRET` env var is the encryption key — if you change it, existing keys become unreadable.
- **SQLite**: Fine for single-instance dev. For production with multiple users, switch to PostgreSQL.

## Project Structure

```
src/
├── app/
│   ├── api/              # 19 API routes (auth, multi-model, conversations, usage)
│   ├── layout.tsx        # Root layout with ThemeProvider + Toaster
│   └── page.tsx          # Router: mode picker / single / multi / orchestrator / usage
├── components/
│   ├── nox/              # NOX AI components (12 files)
│   └── ui/               # shadcn/ui primitives
├── hooks/
│   └── use-chat.ts       # Shared chat logic (sendMessage, persist, confirmation)
├── lib/
│   ├── auth.ts           # scrypt + HMAC sessions
│   ├── auth-fetch.ts     # Fetch wrapper with x-nox-session header
│   ├── crypto.ts         # AES-256-GCM encrypt/decrypt/mask
│   ├── db.ts             # Prisma client singleton
│   ├── multi-model-service.ts  # Server-only: dispatch, test, config, usage
│   ├── multi-model-types.ts    # Client-safe types + provider catalog + pricing
│   ├── rate-limit.ts     # In-memory sliding-window rate limiter
│   └── utils.ts          # cn() helper
├── store/
│   ├── auth-store.ts     # Zustand: user, login, logout
│   ├── conversations-store.ts  # Zustand: conversation list + messages
│   └── multi-model-store.ts    # Zustand: config, test, save, confirmation
└── prisma/
    └── schema.prisma     # User, MultiModelConfig, Conversation, Message, UsageRecord
```

## License

Private project. All rights reserved.
