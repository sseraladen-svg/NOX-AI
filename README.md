# 🌙 NOX AI - Multi-Model Intelligence Platform

<div align="center">

**A Production-Capable Next.js + Prisma Application for Multi-Model Chat**

[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748.svg)](https://www.prisma.io)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC.svg)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

[⚡ Features](#-key-features) • [🚀 Installation](#-local-development) • [🎯 Tech Stack](#-tech-stack) • [📖 Environment](#-environment-variables) • [🔧 Deployment](#-vercel-deployment)

</div>

---

## ✨ Key Features

- 🎯 **Multi-Model Routing** - Single, Multi, and Orchestrator model routing
- 🧠 **Intent Classification** - Host intent classification + specialist dispatch trace
- 🔒 **Security** - Encrypted API keys and HMAC session security
- 💾 **Persistence** - PostgreSQL persistence via Prisma
- 📊 **Analytics** - Token usage and cost tracking dashboard
- 🎨 **Rich UI** - Markdown rendering with copyable code blocks
- 🌐 **Multi-Provider** - OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama, llama.cpp
- 🖼️ **Multimedia** - Image upload, voice I/O, automation, and robotics-focused UI

---

## 🚀 Tech Stack

### Frontend
- **Next.js 16** (App Router) - React framework
- **TypeScript 5** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **shadcn/ui** - Component library
- **Framer Motion** - Animations
- **Zustand** - State management
- **TanStack Query** - Data fetching

### Backend
- **Prisma ORM** - Database toolkit
- **PostgreSQL** - Database
- **AES-GCM** - Key encryption
- **scrypt** - Password hashing
- **HMAC** - Session tokens

---

## 🛠️ Requirements

- **Node.js 20+** or compatible
- **PostgreSQL** database for `DATABASE_URL`
- **npm** package manager
- **Vercel** recommended for deployment

---

## 🚀 Local Development

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Setup Environment

```bash
cp .env.example .env
```

### Step 3: Configure Environment

Update `.env` with your PostgreSQL URL and secrets:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/nox_ai
NOX_AI_SECRET=your-random-secret-key
AUTH_SECRET=your-auth-secret-key
```

### Step 4: Setup Database

```bash
npm run db:push
```

### Step 5: Start Development Server

```bash
npm run dev
```

### Step 6: Access Application

Open `http://localhost:3000` in your browser

---

## 🏗️ Production Build

```bash
npm run vercel-build
```

---

## 🔑 Environment Variables

| Variable | Description | Required |
|----------|-------------|-----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ Yes |
| `POSTGRES_URL` | Fallback database URL | ❌ No |
| `NOX_AI_SECRET` | Secret for API key encryption and session signing | ✅ Yes |
| `AUTH_SECRET` | Additional session/crypto secret | ✅ Yes |

---

## 🌐 Vercel Deployment

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial NOX AI production setup"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

### Step 2: Import to Vercel

1. Import the repository into Vercel
2. Set environment variables in Vercel:
   - `DATABASE_URL`
   - `NOX_AI_SECRET`
   - `AUTH_SECRET`

### Step 3: Deploy

```bash
npm run vercel-build
```

---

## 📁 Project Structure

```
NOX/
├── src/
│   ├── app/              # Next.js routes and pages
│   ├── components/       # UI components
│   ├── hooks/            # Reusable hooks
│   ├── lib/              # Auth, DB, crypto, and service logic
│   └── store/            # Zustand stores
├── prisma/
│   └── schema.prisma     # Database schema
├── public/               # Static assets
├── tests/                # Test files
├── .env.example          # Environment template
├── next.config.ts        # Next.js configuration
├── tailwind.config.ts    # Tailwind configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

---

## 🔐 Security Features

- 🔒 **Encrypted API Keys** - AES-GCM encryption for stored API keys
- 🛡️ **HMAC Session Tokens** - Secure session management
- 🔑 **Scrypt Password Hashing** - Secure password storage
- 🚫 **Environment Variables** - Secrets never committed to git
- ✅ **Input Validation** - Comprehensive input sanitization

---

## 🎯 Supported Providers

NOX AI supports multiple AI providers:

- 🔵 **OpenAI** - GPT-4, GPT-3.5
- 🟣 **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus
- 🟢 **Google Gemini** - Gemini Pro, Gemini Ultra
- 🔴 **Mistral** - Mistral Large, Mistral 7B
- 🟡 **Groq** - Lightning-fast inference
- 🦙 **Ollama** - Local model support
- 🦊 **llama.cpp** - Local inference

---

## 📊 Usage Tracking

NOX AI includes comprehensive usage tracking:

- 📈 **Token Usage** - Track token consumption per model
- 💰 **Cost Analysis** - Monitor API costs across providers
- 📊 **Dashboard** - Visual analytics for usage patterns
- 📋 **Export** - Export usage data for analysis

---

## 🤖 Automation & Robotics

Built-in features for automation and robotics workflows:

- 🤖 **Automation Scripts** - Execute automated tasks
- 🦾 **Robotics Control** - Interface with robotics systems
- 📡 **API Integration** - Connect with external services
- ⚡ **Real-time Processing** - Low-latency response handling

---

## 🧪 Testing

```bash
npm run test
```

---

## 📝 Notes

- ⚠️ This repo is configured for PostgreSQL. Do not use SQLite in production.
- 🔒 Keep `.env` local and do not commit secrets.
- ✅ `.env.example` is safe to commit.
- 🔄 Regular database backups recommended.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org) for the amazing React framework
- [Prisma](https://www.prisma.io) for the excellent ORM
- [Tailwind CSS](https://tailwindcss.com) for the utility-first CSS framework
- [shadcn/ui](https://ui.shadcn.com) for the beautiful components

---

<div align="center">

**Built with 🌙 by the NOX AI Team**

[⬆ Back to Top](#-nox-ai---multi-model-intelligence-platform)

</div>