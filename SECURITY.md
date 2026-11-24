<h1 align="center">Security Policy</h1>

<p align="center"><b>NOX-AI stores provider API keys and user credentials. Reports are taken seriously.</b></p>

<p align="center">
  <a href="https://github.com/sseraladen-svg/NOX-AI">Repository</a> ·
  <a href="https://nox-ai-ten.vercel.app">Live deployment</a> ·
  <a href="#reporting-a-vulnerability">Report</a> ·
  <a href="#implemented-controls">Controls</a> ·
  <a href="#scope">Scope</a> ·
  <a href="#handling-of-secrets">Secrets</a>
</p>

---

## Supported versions

Security fixes are applied to `main` and deployed continuously to https://nox-ai-ten.vercel.app.

| Branch | Supported |
|---|---|
| `main` (latest) | Yes |
| Older feature branches and forks | No |

## Reporting a vulnerability

**Do not open a public issue** with exploit details or exposed credentials.

| Route | Where |
|---|---|
| GitHub Security Advisories | https://github.com/sseraladen-svg/NOX-AI/security/advisories/new |
| Email | sseraladen@gmail.com, subject `NOX-AI security report` |

Include:

- the affected file path, route or component
- steps to reproduce or a proof of concept
- the potential impact and a suggested fix, if you have one

Do not include real user data or live API keys.

| Stage | Target |
|---|---|
| Acknowledgement | within 48 hours |
| Fix | released on `main` as soon as the issue is verified |

## Implemented controls

| Area | Implementation | Source |
|---|---|---|
| **Passwords and sessions** | `crypto.scryptSync` with per-user salts. 30-day `nox_session` cookie. Passwords must be at least 8 characters on signup and reset. | `src/lib/auth.ts` |
| **API keys at rest** | AES-256-GCM with a 32-byte SHA-256 key derived from `NOX_AI_SECRET` or `AUTH_SECRET`. Keys are masked (`maskApiKey`) whenever sent to the browser and preserved on config updates. | `src/lib/crypto.ts`, `src/lib/multi-model/config-repo.ts` |
| **SSRF protection** | `assertSafeEndpoint()` allows only http(s), no embedded credentials, no cloud-metadata hosts, and no private or loopback hosts for server-side API endpoints in production. `127.0.0.1` is allowed only for browser-direct local Ollama. | `src/lib/endpoint-guard.ts`, `src/lib/multi-model/shared.ts` |
| **Rate limiting and replay defense** | Per-IP rate limits (`429`) on auth, dispatch and test routes. Single-use approval tokens stored atomically in PostgreSQL `EphemeralState` (`rememberApproval` / `consumeApproval`). Shared across serverless instances. | `src/lib/rate-limit.ts`, `src/lib/ephemeral-state.ts` |
| **Data isolation** | Configs, conversations and usage records are scoped to the signed-in user. | `src/lib/multi-model/*` |
| **Workspace path guardrails** | `isSensitivePath()` blocks read, write, delete and rename on `.git`, `node_modules`, `.env.*` (allowing `.env.example`, `.sample`, `.template`), `.npmrc`, `.netrc`, SSH keys, and `*.pem`, `*.key`, `*.p12`, `*.pfx`. Agents cannot delete folders. | `src/lib/workspace/agent-protocol.ts`, `agent-exec.ts` |
| **Gated local shell** | Off by default. Needs `NOX_LOCAL_TERMINAL=1`, a signed-in user, a `localhost` request and a non-Vercel host, plus per-command confirmation for agents. Secrets are removed from the command environment. | `src/lib/engineering-workspace.ts` |
| **Sandboxed execution** | Editor Run and `node file.js` execute in a sandboxed iframe worker with no cookies, no access to the app's API, and an 8 second limit. | `src/lib/workspace/*` |
| **HTTP headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`, `poweredByHeader: false`. | `next.config.ts` |
| **Error hygiene** | Error messages and traces never include API keys. | `src/lib/logger.ts` |

## Scope

**In scope**

- authentication, sessions and password handling
- storage, encryption and masking of provider API keys
- the API routes, including guest routes
- rate-limit and approval-token bypass
- SSRF through custom provider endpoints
- access to another user's configs, conversations or usage
- workspace path-guardrail bypass and agent protocol abuse
- local shell enablement or escape
- injection, XSS and CSRF

**Out of scope**

- flaws in third-party providers (OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, Z.ai)
- attacks that need physical access or an already compromised machine
- volumetric denial of service
- missing headers with no demonstrated impact
- social engineering
- outdated forks

## Handling of secrets

- Never commit `.env` files, API keys or tokens. `.env.example` holds names only.
- `NOX_AI_SECRET` encrypts stored provider keys. `AUTH_SECRET` signs sessions. Use long random values, different per environment.
- If either secret was exposed, rotate both, then have users re-enter provider keys.
- Losing `NOX_AI_SECRET` makes stored provider keys unrecoverable.

## Honest limits

- Requests sent to a cloud provider reach that provider. Use local Ollama for data that must not leave your machine.
- Guest mode keeps settings and history in browser storage. Anyone with access to that browser can read it.
- The Local shell runs commands with the server user's permissions. Enable it only on your own computer.
- The workspace terminal and editor were verified with unit tests, a production build and API tests for the Local shell, but not driven in a real browser during development.

## Self-hosting checklist

- [ ] Long random `NOX_AI_SECRET` and `AUTH_SECRET`, different per environment
- [ ] `.env` and database credentials never committed
- [ ] HTTPS only
- [ ] `NOX_LOCAL_TERMINAL` unset on any shared or hosted deployment
- [ ] Database not exposed to the public internet
- [ ] `npm audit` run regularly and dependencies kept updated
- [ ] Provider keys rotated at once if exposure is suspected

## Safe harbor

Good-faith research that follows this policy will not face legal action. Do not access other users' data, degrade the service, or disclose the issue before a fix.
