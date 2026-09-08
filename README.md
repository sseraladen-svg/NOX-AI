# NOX AI

<video controls playsinline width="100%" style="max-width: 100%; border-radius: 16px; margin: 16px 0 20px;">
  <source src="https://raw.githubusercontent.com/sseraladen-svg/NOX-AI/main/public/videos/nox-demo.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

A production-ready multi-model AI platform built with Next.js, TypeScript, Prisma, and Tailwind CSS.

NOX AI helps you route prompts across multiple providers and model types through a clean, structured interface. It supports single-model use, feature-specific multi-model routing, and orchestrated specialist workflows with auth, conversation persistence, cost tracking, and safety checks built in.

<div align="center">

[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748.svg)](https://www.prisma.io)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC.svg)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

</div>

---

## Overview

NOX AI is designed for users who want more control over their AI workflows than a single-model chatbot provides. The platform lets you decide how work should be routed:

- Single mode: one model handles all tasks
- Multi mode: each feature uses the best-fit model/provider
- Orchestrator mode: a host model assigns work to specialists and synthesizes the final answer

The app includes user authentication, saved conversations, per-role model configuration, provider testing, rate limiting, cost tracking, and a usage dashboard.

## Demo Video

A local demo video is included in the project and is rendered directly on the landing page using a native HTML5 video player, without relying on an external URL.

Source:

```text
public/videos/nox-demo.mp4
```

---

## Key Features

- Multi-model routing with three operating modes:
  - Single
  - Multi
  - Orchestrator
- Feature-specific experiences for:
  - Chat
  - Voice
  - Vision
  - Coding
  - Automation
  - Robotics
- Multi-provider support:
  - OpenAI
  - Anthropic
  - Gemini
  - Mistral
  - Groq
  - Ollama
  - local CLI runtimes
- Secure local auth with signup/login/logout
- User-scoped conversations and config persistence
- Encrypted storage for API keys
- Model connection testing and validation
- Pre-flight confirmation and safety checks
- Honest reachability checks and retry/timeout controls
- Usage tracking for tokens and estimated cost
- Usage dashboard with summary and recent activity
- Rate limiting on sensitive routes
- Rich markdown rendering with copyable code blocks

---

## Tech Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- Zustand
- TanStack Query

### Backend
- Prisma ORM
- PostgreSQL-compatible database
- Next.js API routes
- Server-side encryption
- Secure session handling

---

## Application Modes

### Single Mode
Use one model for the entire workflow. Best for streamlined chat, direct Q&A, and simple prompts.

### Multi Mode
Route tasks to specialized models depending on the active feature. This lets you assign different models for coding, vision, automation, and more.

### Orchestrator Mode
A host model decides how to route a request, delegates to specialists, and then synthesizes the answer into a final response.

---

## Security Features

- Encrypted API key storage
- Masked keys in the UI
- User-scoped storage access
- Secure cookie/session cookies
- Secret-based encryption and signing
- Route-level protections and rate limiting
- Validation before saving broken configuration

---

## Requirements

- Node.js 20+
- npm
- PostgreSQL-compatible database
- Access to one or more AI providers or local model runtimes

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Create the environment file

```bash
cp .env.example .env
```

### 3. Configure environment variables

Update `.env` with your database and secrets:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/nox_ai"
NOX_AI_SECRET="your-random-secret"
AUTH_SECRET="your-auth-secret"
```

### 4. Set up Prisma

```bash
npm run db:push
```

### 5. Start the app

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

---

## Environment Variables

```env
DATABASE_URL=your-postgresql-connection-string
NOX_AI_SECRET=secret-for-encryption-and-session-signing
AUTH_SECRET=extra-authentication-secret
```

---

## Project Structure

```text
NOX-AI/
├── src/
│   ├── app/                 # App Router pages and API routes
│   ├── components/          # Reusable UI and NOX experience modules
│   ├── hooks/               # Shared chat and state logic
│   ├── lib/                 # Auth, crypto, config, service logic
│   ├── store/               # Zustand stores
│   └── ...
├── prisma/
│   └── schema.prisma
├── public/
│   └── videos/
│       └── nox-demo.mp4
├── tests/
├── .env.example
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── README.md
└── ...
```

---

## Cost Tracking

NOX AI includes token and cost tracking for model usage.

It captures:
- prompt tokens
- completion tokens
- total tokens
- provider/model metadata
- latency and retries
- error status
- estimated cost

This data is persisted to the database and exposed through usage APIs and a dashboard UI.

---

## Rate Limiting

Sensitive routes are protected with rate limits for:
- login
- signup
- model dispatch
- model testing

This reduces brute-force attacks and API abuse.

---

## Deployment

The project is built to run well in modern hosting environments such as Vercel.

```bash
npm run vercel-build
```

---

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to your fork
5. Open a pull request

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Summary

NOX AI is a complete multi-model AI platform combining modern UI, secure auth, model configuration, orchestration logic, cost tracking, and production-oriented hardening. It is ready for further extension, personal use, or deployment.
