# 🌙 NOX AI

<div align="center">

**A Professional Multi-Model AI Platform for Intelligent Workflow Orchestration**

[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748.svg)](https://www.prisma.io)
[![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC.svg)](https://tailwindcss.com)
[![GitHub Stars](https://img.shields.io/github/stars/sseraladen-svg/NOX-AI?style=social)](https://github.com/sseraladen-svg/NOX-AI)

</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Application Modes](#application-modes)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Security Features](#security-features)
- [Usage Tracking](#usage-tracking)
- [Rate Limiting](#rate-limiting)
- [Deployment](#deployment)
- [Development Guidelines](#development-guidelines)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## 🎯 Overview

NOX AI is a sophisticated multi-model AI platform designed for users who demand granular control over their AI workflows. Unlike traditional single-model chatbots, NOX AI provides intelligent routing capabilities across three distinct operational modes, enabling users to leverage the strengths of different AI models for specific tasks.

### 🌟 Why NOX AI?

- **Intelligent Routing**: Automatically route tasks to the most appropriate AI model based on the type of work
- **Multi-Provider Support**: Seamlessly integrate with OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama, and local CLI runtimes
- **Enterprise-Grade Security**: Encrypted API key storage, user-scoped data, and comprehensive authentication
- **Production-Ready**: Built with scalability, monitoring, and deployment in mind
- **Cost Awareness**: Track token usage and estimated costs across all operations

### 🎥 Project Demo

<video controls playsinline width="100%" style="max-width: 100%; border-radius: 16px; margin: 12px 0 20px; display: block;">
  <source src="https://raw.githubusercontent.com/sseraladen-svg/NOX-AI/main/public/videos/nox-demo.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

---

## ✨ Key Features

### 🤖 Multi-Model Routing
- **Single Mode**: One model handles all tasks - streamlined and efficient
- **Multi Mode**: Feature-specific routing to specialized models
- **Orchestrator Mode**: Host model delegates to specialists and synthesizes results

### 🛠️ Feature-Specific Experiences
- **Chat**: General conversation and Q&A
- **Voice**: Speech-to-text and text-to-speech capabilities
- **Vision**: Image analysis and understanding
- **Coding**: Code generation, debugging, and explanation
- **Automation**: Workflow automation and API chaining
- **Robotics**: Motion planning and control systems

### 🔐 Security & Authentication
- Secure local authentication with signup/login/logout
- Encrypted API key storage with server-side encryption
- User-scoped conversations and configuration persistence
- Route-level protections and rate limiting
- Pre-flight confirmation and safety checks

### 📊 Monitoring & Analytics
- Real-time token usage tracking
- Cost estimation and budgeting
- Usage dashboard with historical data
- Performance metrics and latency monitoring
- Error tracking and retry logic

### 🎨 User Experience
- Modern, responsive UI built with shadcn/ui components
- Smooth animations with Framer Motion
- Rich markdown rendering with syntax highlighting
- Copyable code blocks and formatted output
- Multi-language support via next-intl

---

## 🏗️ Architecture

NOX AI follows a modern, scalable architecture designed for performance and maintainability:

### System Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Layer                          │
│  Next.js 16 + React 19 + TypeScript + Tailwind CSS         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (Next.js)                       │
│  - Authentication Routes                                    │
│  - Model Dispatch Routes                                    │
│  - Configuration Management                                 │
│  - Usage Tracking APIs                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Business Logic Layer                       │
│  - Multi-Model Routing Engine                               │
│  - Provider Abstraction Layer                               │
│  - Encryption & Security Services                           │
│  - Rate Limiting & Validation                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer (Prisma)                       │
│  PostgreSQL-compatible Database                             │
│  - User Management                                          │
│  - Conversations & Messages                                 │
│  - Model Configurations                                      │
│  - Usage & Cost Tracking                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                External AI Providers                         │
│  OpenAI | Anthropic | Gemini | Mistral | Groq | Ollama      │
└─────────────────────────────────────────────────────────────┘
```

### Component Architecture
- **State Management**: Zustand for global state with persistence
- **Data Fetching**: TanStack Query for server state management
- **UI Components**: shadcn/ui for consistent, accessible components
- **Styling**: Tailwind CSS with custom design system
- **Animation**: Framer Motion for smooth transitions

---

## 🚀 Application Modes

### 🔵 Single Mode
**Best for**: Streamlined chat, direct Q&A, and simple prompts

**Configuration**: Connect one provider (API key or local CLI) for all features

**Workflow**:
```
User Input → Single Model → Response
```

**Benefits**:
- Simplest setup and configuration
- Fastest response times
- Consistent behavior across all features
- Lower infrastructure requirements

**Use Cases**:
- General conversational AI
- Simple question answering
- Basic text generation
- When you prefer one model's behavior

### 🟣 Multi Mode
**Best for**: Specialized tasks requiring different model strengths

**Configuration**: Set independent connections for each of the 6 features

**Workflow**:
```
User Input → Feature Detection → Specialized Model → Response
```

**Benefits**:
- Optimal model selection per task type
- Cost optimization by using cheaper models where appropriate
- Specialized capabilities (e.g., vision models for images)
- Granular control over each feature

**Use Cases**:
- Development environments (coding with Claude, chat with GPT-4)
- Vision-heavy applications
- Multi-modal workflows
- When different tasks require different model strengths

### 🟠 Orchestrator Mode
**Best for**: Complex, multi-step tasks requiring coordination

**Configuration**: Set connections for Host model + 5 specialist models

**Workflow**:
```
User Input → Host Analysis → Specialist Delegation → Synthesis → Response
```

**Specialists**:
- **Planning**: Task decomposition and strategy
- **Coding**: Code generation and debugging
- **Vision**: Image analysis and understanding
- **Automation**: Workflow and API orchestration
- **Engineering**: System design and architecture

**Benefits**:
- Complex task breakdown and planning
- Multi-agent collaboration
- Quality synthesis from multiple perspectives
- Sophisticated problem-solving capabilities

**Use Cases**:
- Complex system design
- Multi-step automation workflows
- Research and analysis tasks
- When you need coordinated specialist input

---

## 💻 Tech Stack

### Frontend Technologies
| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 16 | React framework with App Router |
| **React** | 19 | UI library |
| **TypeScript** | 5 | Type safety and developer experience |
| **Tailwind CSS** | 4 | Utility-first CSS framework |
| **shadcn/ui** | Latest | Accessible UI component library |
| **Framer Motion** | Latest | Animation library |
| **Zustand** | Latest | State management |
| **TanStack Query** | Latest | Server state management |
| **next-intl** | Latest | Internationalization |

### Backend Technologies
| Technology | Version | Purpose |
|------------|---------|---------|
| **Prisma** | 6 | Type-safe ORM |
| **PostgreSQL** | Compatible | Primary database |
| **Next.js API Routes** | Latest | Backend API layer |
| **bcrypt** | Latest | Password hashing |
| **crypto-js** | Latest | Encryption utilities |

### Development Tools
| Technology | Purpose |
|------------|---------|
| **ESLint** | Code linting and quality |
| **Prettier** | Code formatting |
| **Git** | Version control |
| **npm** | Package management |

---

## 📦 Installation

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 20 or higher
- **npm** (comes with Node.js)
- **PostgreSQL** 14 or higher (or compatible database)
- **Git** for version control

### Step-by-Step Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/sseraladen-svg/NOX-AI.git
cd NOX-AI
```

#### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including Next.js, React, Prisma, and other packages.

#### 3. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration (see [Configuration](#configuration) section).

#### 4. Set Up the Database

First, ensure your PostgreSQL database is running and accessible.

```bash
# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push
```

#### 5. Start the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

#### 6. Create an Account

1. Navigate to `http://localhost:3000`
2. Click "Sign Up" and create your account
3. Configure your AI providers in the settings
4. Start using NOX AI!

---

## ⚙️ Configuration

### Database Configuration

Update your `.env` file with your database connection string:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/nox_ai"
```

### Security Configuration

Generate secure random secrets for encryption and authentication:

```env
NOX_AI_SECRET="your-random-secret-for-encryption"
AUTH_SECRET="your-auth-secret-for-sessions"
```

### AI Provider Configuration

Configure your AI providers through the application UI:

1. Navigate to the Settings page
2. Select your operating mode (Single/Multi/Orchestrator)
3. Add API keys or configure local CLI connections
4. Test connections to ensure they work
5. Save your configuration

### Supported Providers

#### Cloud Providers
- **OpenAI**: GPT-4, GPT-3.5, and other OpenAI models
- **Anthropic**: Claude 3.5, Claude 3, and other Anthropic models
- **Google Gemini**: Gemini Pro, Gemini Ultra, and other Google models
- **Mistral**: Mistral Large, Mistral Medium, and other Mistral models
- **Groq**: Fast inference with various model options

#### Local Providers
- **Ollama**: Run models locally with Ollama
- **Local CLI**: Custom local model runtimes

---

## 🔐 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `NOX_AI_SECRET` | Secret for encryption and session signing | Yes | - |
| `AUTH_SECRET` | Extra authentication secret | Yes | - |
| `NODE_ENV` | Environment (development/production) | No | development |
| `NEXT_PUBLIC_APP_URL` | Public application URL | No | http://localhost:3000 |

### Example `.env` File

```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/nox_ai"

# Security
NOX_AI_SECRET="your-super-secret-random-string-here"
AUTH_SECRET="another-super-secret-random-string-here"

# Environment
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## 📁 Project Structure

```text
NOX-AI/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── single/                   # Single mode page
│   │   ├── multi/                    # Multi mode page
│   │   ├── orchestrator/             # Orchestrator mode page
│   │   ├── usage/                    # Usage dashboard
│   │   ├── api/                      # API routes
│   │   │   ├── auth/                 # Authentication endpoints
│   │   │   ├── conversations/        # Conversation management
│   │   │   ├── multi-model/          # Multi-model operations
│   │   │   └── usage/                # Usage tracking
│   │   ├── layout.tsx                # Root layout
│   │   └── page.tsx                  # Home page
│   ├── components/
│   │   ├── nox/                      # NOX-specific components
│   │   │   ├── mode-picker.tsx       # Mode selection UI
│   │   │   ├── single-mode-page.tsx  # Single mode interface
│   │   │   ├── multi-mode-page.tsx   # Multi mode interface
│   │   │   ├── orchestrator-mode-page.tsx  # Orchestrator interface
│   │   │   ├── feature-uis.tsx       # Feature-specific UIs
│   │   │   ├── shared-chat.tsx       # Shared chat components
│   │   │   └── auth-gate.tsx         # Authentication wrapper
│   │   └── ui/                       # shadcn/ui components
│   ├── hooks/                        # Custom React hooks
│   │   └── use-chat.ts               # Chat functionality hook
│   ├── lib/                          # Utility libraries
│   │   ├── auth.ts                   # Authentication utilities
│   │   ├── crypto.ts                 # Encryption utilities
│   │   ├── multi-model-types.ts      # Type definitions
│   │   └── utils.ts                  # General utilities
│   └── store/                        # State management
│       ├── multi-model-store.ts      # Multi-model state
│       └── conversations-store.ts    # Conversation state
├── prisma/
│   ├── schema.prisma                 # Database schema
│   └── migrations/                   # Database migrations
├── public/
│   ├── videos/
│   │   ├── nox-demo.mp4             # Demo video
│   │   └── nox-demo.vtt             # Video subtitles
│   └── ...                          # Other static assets
├── scripts/
│   └── pre-commit-hook.sh           # Git pre-commit hook
├── tests/                           # Test files
├── upload/                          # Design logs and audit reports
├── .env.example                     # Environment template
├── .gitignore                       # Git ignore rules
├── components.json                  # shadcn/ui configuration
├── eslint.config.mjs                # ESLint configuration
├── next.config.ts                   # Next.js configuration
├── package.json                     # Dependencies and scripts
├── postcss.config.mjs               # PostCSS configuration
├── tailwind.config.ts               # Tailwind CSS configuration
├── tsconfig.json                    # TypeScript configuration
├── README.md                        # This file
└── worklog.md                       # Development log
```

---

## 🔌 API Documentation

### Authentication Endpoints

#### POST `/api/auth/signup`
Create a new user account.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response**:
```json
{
  "success": true,
  "user": {
    "id": "user_id",
    "email": "user@example.com"
  }
}
```

#### POST `/api/auth/login`
Authenticate a user.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response**:
```json
{
  "success": true,
  "user": {
    "id": "user_id",
    "email": "user@example.com"
  }
}
```

### Multi-Model Endpoints

#### POST `/api/multi-model/dispatch`
Dispatch a prompt to the configured AI model(s).

**Request Body**:
```json
{
  "prompt": "Your message here",
  "mode": "SINGLE",
  "feature": "chat",
  "image": "base64_encoded_image" // optional
}
```

**Response**:
```json
{
  "success": true,
  "response": "AI response here",
  "tokens": {
    "input": 100,
    "output": 200,
    "total": 300
  },
  "cost": 0.006
}
```

#### POST `/api/multi-model/test`
Test a model connection.

**Request Body**:
```json
{
  "provider": "openai",
  "connectionType": "API",
  "apiKey": "your-api-key",
  "modelName": "gpt-4"
}
```

**Response**:
```json
{
  "success": true,
  "status": "working",
  "latency": 1250
}
```

### Usage Endpoints

#### GET `/api/usage/summary`
Get usage summary for the current user.

**Response**:
```json
{
  "totalTokens": 50000,
  "totalCost": 1.25,
  "byProvider": {
    "openai": {
      "tokens": 30000,
      "cost": 0.90
    },
    "anthropic": {
      "tokens": 20000,
      "cost": 0.35
    }
  }
}
```

#### GET `/api/usage/recent`
Get recent usage activity.

**Response**:
```json
{
  "activities": [
    {
      "id": "activity_id",
      "timestamp": "2024-01-15T10:30:00Z",
      "mode": "MULTI",
      "feature": "coding",
      "tokens": 150,
      "cost": 0.003
    }
  ]
}
```

---

## 🔒 Security Features

### Encryption & Data Protection
- **API Key Encryption**: All API keys are encrypted using AES-256 encryption before storage
- **Password Hashing**: User passwords are hashed using bcrypt with salt rounds
- **Session Security**: Secure session management with HTTP-only cookies
- **Data Isolation**: User-scoped data with strict access controls

### Authentication & Authorization
- **Local Authentication**: Secure signup/login/logout functionality
- **Session Management**: Automatic session expiration and renewal
- **CSRF Protection**: Cross-site request forgery protection
- **Rate Limiting**: Protection against brute-force attacks

### Input Validation & Sanitization
- **Request Validation**: All API inputs are validated before processing
- **XSS Prevention**: Output sanitization to prevent cross-site scripting
- **SQL Injection Prevention**: Parameterized queries via Prisma ORM
- **File Upload Security**: Strict validation and size limits

### Monitoring & Logging
- **Error Tracking**: Comprehensive error logging and monitoring
- **Audit Logging**: Track sensitive operations and configuration changes
- **Security Headers**: Implementation of security best practices headers

---

## 📊 Usage Tracking

NOX AI provides comprehensive usage tracking to help you monitor costs and optimize your AI workflows.

### Tracked Metrics
- **Token Usage**: Input, output, and total tokens per request
- **Cost Estimation**: Real-time cost calculation based on provider pricing
- **Latency**: Response time tracking for performance monitoring
- **Error Rates**: Failure tracking and retry statistics
- **Provider Usage**: Breakdown by AI provider and model

### Usage Dashboard
- **Summary View**: High-level overview of usage and costs
- **Historical Data**: Time-series data for trend analysis
- **Provider Breakdown**: Usage by provider and model
- **Feature Analysis**: Usage by feature type (chat, coding, etc.)

### Cost Optimization Tips
1. **Use Multi Mode**: Assign cheaper models to less critical tasks
2. **Monitor Token Usage**: Track which features consume the most tokens
3. **Set Budget Alerts**: Configure alerts for cost thresholds
4. **Optimize Prompts**: Reduce token usage through prompt engineering

---

## 🚦 Rate Limiting

To prevent abuse and ensure fair usage, NOX AI implements rate limiting on sensitive endpoints.

### Rate-Limited Endpoints
- **Authentication**: `/api/auth/login`, `/api/auth/signup`
- **Model Dispatch**: `/api/multi-model/dispatch`
- **Model Testing**: `/api/multi-model/test`

### Rate Limit Configuration
Default rate limits (configurable):
- **Authentication**: 5 requests per minute per IP
- **Model Dispatch**: 20 requests per minute per user
- **Model Testing**: 10 requests per minute per user

### Rate Limit Response
When rate limits are exceeded, the API returns:
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

---

## 🚀 Deployment

### Vercel Deployment (Recommended)

1. **Push to GitHub**: Ensure your code is on GitHub
2. **Import to Vercel**: Import your repository to Vercel
3. **Configure Environment Variables**: Add your environment variables in Vercel dashboard
4. **Deploy**: Vercel will automatically deploy your application

### Manual Deployment

#### Build the Application
```bash
npm run build
```

#### Start the Production Server
```bash
npm start
```

#### Database Setup
Ensure your production database is configured and run:
```bash
npm run db:push
```

### Environment Variables for Production
- Use strong, randomly generated secrets
- Configure production database URL
- Set `NODE_ENV=production`
- Configure any production-specific URLs

### Performance Optimization
- Enable CDN for static assets
- Configure database connection pooling
- Enable caching where appropriate
- Monitor performance metrics

---

## 👨‍💻 Development Guidelines

### Code Style
- Follow TypeScript best practices
- Use functional components and hooks
- Maintain consistent naming conventions
- Write descriptive comments for complex logic

### Testing
- Write unit tests for utility functions
- Test API endpoints with integration tests
- Perform manual testing of UI components
- Test with different AI providers

### Git Workflow
1. Create a feature branch from `main`
2. Make your changes with descriptive commits
3. Test thoroughly before pushing
4. Create a pull request for review
5. Address feedback and merge

### Commit Message Format
```
type(scope): description

body

footer
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat(auth): add OAuth2 authentication support

Implement OAuth2 authentication with Google and GitHub providers.
Users can now authenticate using their existing accounts.

Closes #123
```

---

## 🔧 Troubleshooting

### Common Issues

#### Database Connection Issues
**Problem**: Cannot connect to PostgreSQL database

**Solutions**:
- Verify database is running: `psql -U postgres -d nox_ai`
- Check connection string in `.env` file
- Ensure database user has proper permissions
- Check firewall/network settings

#### Authentication Issues
**Problem**: Login/signup not working

**Solutions**:
- Verify `AUTH_SECRET` is set in `.env`
- Check database for user table existence
- Clear browser cookies and try again
- Check console for error messages

#### AI Provider Connection Issues
**Problem**: Cannot connect to AI providers

**Solutions**:
- Verify API keys are correct and active
- Check provider status for outages
- Test connection using provider's API directly
- Ensure sufficient credits/quota

#### Build Errors
**Problem**: Build fails with TypeScript errors

**Solutions**:
- Run `npm run lint` to check for linting issues
- Ensure all dependencies are installed: `npm install`
- Check TypeScript version compatibility
- Clear Next.js cache: `rm -rf .next`

### Getting Help
- Check the [GitHub Issues](https://github.com/sseraladen-svg/NOX-AI/issues) for known problems
- Review the [worklog.md](worklog.md) for development notes
- Open a new issue with detailed error information
- Include environment details and reproduction steps

---

## 🤝 Contributing

We welcome contributions to NOX AI! Here's how you can help:

### Contribution Guidelines
1. **Fork the Repository**: Create your fork on GitHub
2. **Create a Branch**: `git checkout -b feature/your-feature-name`
3. **Make Changes**: Implement your feature or fix
4. **Test Thoroughly**: Ensure your changes work as expected
5. **Commit Changes**: Follow our commit message format
6. **Push to Fork**: `git push origin feature/your-feature-name`
7. **Open Pull Request**: Submit your PR for review

### Code of Conduct
- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

### Areas for Contribution
- **Feature Development**: New features and enhancements
- **Bug Fixes**: Report and fix bugs
- **Documentation**: Improve documentation and examples
- **Testing**: Add tests and improve test coverage
- **UI/UX**: Improve user interface and experience
- **Performance**: Optimize performance and resource usage

---

## 📞 Support & Contact

- **GitHub Issues**: [Report bugs and request features](https://github.com/sseraladen-svg/NOX-AI/issues)
- **Documentation**: Check this README and [worklog.md](worklog.md)
- **Email**: sseraladen@gmail.com

---

## 🗺️ Roadmap

### Planned Features
- [ ] Additional AI provider integrations
- [ ] Advanced analytics and reporting
- [ ] Team collaboration features
- [ ] Mobile application
- [ ] Plugin system for custom providers
- [ ] Advanced automation workflows
- [ ] Voice command interface
- [ ] Real-time collaboration

### Under Development
- [ ] Performance optimizations
- [ ] Enhanced security features
- [ ] Improved error handling
- [ ] Better mobile responsiveness

---

<div align="center">

**Built with ❤️ by [sseraladen-svg](https://github.com/sseraladen-svg)**

**⭐ If you find this project helpful, please consider giving it a star on GitHub!**

</div>
