# NOX AI — Multi-Model Intelligence Platform

NOX AI is a production-capable Next.js + Prisma application for multi-model chat. It supports Single, Multi, and Orchestrator modes, encrypted API keys, user authentication, usage tracking, and provider dispatch routing for modern AI workflows.

## Key Features

- Single, Multi, and Orchestrator model routing
- Host intent classification + specialist dispatch trace
- Encrypted API keys and HMAC session security
- PostgreSQL persistence via Prisma
- Token usage and cost tracking dashboard
- Markdown rendering with copyable code blocks
- Provider support for OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama, llama.cpp
- Image upload, voice I/O, automation, and robotics-focused UI

## Tech Stack

- Next.js 16 (App Router) + TypeScript 5
- Prisma ORM + PostgreSQL
- Tailwind CSS 4 + shadcn/ui + Framer Motion
- Zustand + TanStack Query
- AES-GCM key encryption, scrypt password hashing, HMAC session tokens

## Requirements

- Node.js 20+ or compatible
- PostgreSQL database for `DATABASE_URL`
- `npm` package manager
- Vercel recommended for deployment

## Local Development

1. Install dependencies

```bash
npm install
```

2. Copy the environment template

```bash
cp .env.example .env
```

3. Update `.env` with your PostgreSQL URL and secrets

4. Create or update the database

```bash
npm run db:push
```

5. Start development server

```bash
npm run dev
```

6. Open `http://localhost:3000`

## Production Build

```bash
npm run vercel-build
```

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string
- `POSTGRES_URL` — optional fallback if `DATABASE_URL` is not set
- `NOX_AI_SECRET` — random secret for API key encryption and session signing
- `AUTH_SECRET` — additional session/crypto secret

## Vercel Deployment

1. Push the repository to GitHub
2. Import the repository into Vercel
3. Set environment variables in Vercel:
   - `DATABASE_URL`
   - `NOX_AI_SECRET`
   - `AUTH_SECRET`
4. Deploy with `npm run vercel-build`

## Git Setup

```bash
git init
git add .
git commit -m "Initial NOX AI production setup"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Notes

- This repo is configured for PostgreSQL. Do not use SQLite in production.
- Keep `.env` local and do not commit secrets.
- `.env.example` is safe to commit.

## Project structure

- `src/app/` — Next.js routes and pages
- `src/components/` — UI components
- `src/hooks/` — reusable hooks
- `src/lib/` — auth, db, crypto, and service logic
- `src/store/` — Zustand stores
- `prisma/schema.prisma` — database schema
- `vercel.json` — Vercel build configuration
