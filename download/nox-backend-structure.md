# NOX AI — Backend Connection Structure (CLI + API per Mode)

This document describes the actual backend architecture as implemented in the codebase: file layout, connection types, how each mode routes through them, and the dispatch flow.

---

## 1. File Structure

```
src/
├── lib/
│   ├── auth.ts                    # scrypt password hashing + HMAC session cookies
│   ├── crypto.ts                  # AES-256-GCM encryption for API keys at rest
│   ├── db.ts                      # Prisma client singleton
│   ├── multi-model-types.ts       # Client-safe types + PROVIDERS/FEATURES/SPECIALISTS catalogs
│   └── multi-model-service.ts     # Server-only logic: getConfig, saveConfig, testAssignment,
│                                  #   checkLimits, dispatch, conversation CRUD
│
├── app/api/
│   ├── auth/
│   │   ├── signup/route.ts        # POST  create user, set session cookie
│   │   ├── login/route.ts         # POST  verify password, set session cookie
│   │   ├── logout/route.ts        # POST  clear session cookie
│   │   └── me/route.ts            # GET   return current user or null
│   │
│   ├── multi-model/
│   │   ├── config/route.ts        # GET (masked) / PUT (encrypts) — user-scoped
│   │   ├── providers/route.ts     # GET   provider + feature + specialist catalogs
│   │   ├── test/route.ts          # POST  ping a model, validate version, return fix steps
│   │   ├── limits/route.ts        # POST  per-model quota/capacity summary
│   │   ├── dispatch/route.ts      # POST  route a message through the active mode
│   │   └── export-import/route.ts # POST  action=export|import|reset
│   │
│   └── conversations/
│       ├── list/route.ts          # GET   list user's conversations
│       ├── create/route.ts        # POST  create new conversation with mode
│       ├── get/route.ts           # GET   load conversation + all messages + traces
│       ├── delete/route.ts        # POST  delete conversation
│       ├── rename/route.ts        # POST  rename conversation
│       └── save-message/route.ts  # POST  persist a user/assistant message with trace
│
└── prisma/
    └── schema.prisma              # User, MultiModelConfig, Conversation, Message
```

**Key separation principle:**
- `multi-model-types.ts` is **client-safe** — no DB, no SDK, no fs. Imported by both client components and server code.
- `multi-model-service.ts` is **server-only** (`import "server-only"`) — imports Prisma, crypto, z-ai-web-dev-sdk. Only imported by API routes.

---

## 2. Database Schema (Prisma)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String                     // scrypt(salt + 64-byte hash)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  multiModelConfigs MultiModelConfig[]
  conversations     Conversation[]
}

model MultiModelConfig {
  id      String @id @default(cuid())
  userId  String                        // ← every config belongs to one user
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  scope   String @default("default")    // sentinel — one config per user
  mode    String @default("SINGLE")     // SINGLE | MULTI | ORCHESTRATOR

  globalConfig      String?             // JSON: ModelAssignment (SINGLE mode)
  featureConfigs    String?             // JSON: Record<FeatureId, ModelAssignment> (MULTI mode)
  hostConfig        String?             // JSON: ModelAssignment (ORCHESTRATOR mode)
  specialistConfigs String?             // JSON: Record<SpecialistId, ModelAssignment> (ORCHESTRATOR)
  timeoutOverrides  String?             // JSON: { LOCAL?: number, API?: number } in ms

  @@unique([userId, scope])             // one row per user
}

model Conversation {
  id        String   @id @default(cuid())
  userId    String
  title     String   @default("New conversation")
  mode      String   @default("SINGLE")  // captured per-conversation
  messages  Message[]
  @@index([userId, updatedAt])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  role           String                 // user | assistant
  content        String
  trace          String?                // JSON: DispatchStep[] (model, provider, latency, etc.)
  mode           String?
  multiAgent     Boolean @default(false)
  error          Boolean @default(false)
}
```

---

## 3. The Two Connection Types

Every model assignment — whether for Single, a Multi feature, or an Orchestrator role — is a `ModelAssignment` with one of two `connectionType` values:

### `ModelAssignment` schema

```typescript
interface ModelAssignment {
  connectionType: "LOCAL" | "API";
  provider: string;        // e.g. "openai" | "ollama"
  modelName: string;       // e.g. "gpt-4o-mini" | "llama3.1:8b"

  // API connection fields (only when connectionType === "API")
  apiKey?: string;         // plaintext on input → encrypted at rest → masked on read
  endpoint?: string;       // optional custom base URL

  // LOCAL CLI fields (only when connectionType === "LOCAL")
  cliPath?: string;        // e.g. "/usr/local/bin/ollama"
  cliArgs?: string;        // e.g. "--port 11434"

  // Status (set by the Test endpoint)
  status?: "untested" | "ready" | "error";
  version?: string;
}
```

### API connection

| Field | Required | Purpose |
|---|---|---|
| `provider` | yes | One of: openai, anthropic, mistral, gemini, groq |
| `modelName` | yes | e.g. `gpt-4o-mini`, `claude-3-5-sonnet-latest` |
| `apiKey` | yes (≥ 8 chars) | Encrypted with AES-256-GCM before DB write; decrypted only inside `dispatch`; masked (`sk-••••7890`) on GET |
| `endpoint` | no | Custom base URL (e.g. for Azure OpenAI proxies) |

### LOCAL CLI connection

| Field | Required | Purpose |
|---|---|---|
| `provider` | yes | One of: ollama, llamacpp, llamafile |
| `modelName` | yes | e.g. `llama3.1:8b`, `local-model.gguf` |
| `cliPath` | yes | Absolute path to the binary (validated non-empty) |
| `cliArgs` | no | Extra flags passed to the binary |

---

## 4. Provider Catalog

Defined in `multi-model-types.ts` — shared by frontend dropdowns and backend validation.

| Provider ID | Label | Type | Default Model | Known Models |
|---|---|---|---|---|
| `openai` | OpenAI | API | gpt-4o-mini | gpt-4o, gpt-4o-mini, gpt-4-turbo, o1-mini |
| `anthropic` | Anthropic | API | claude-3-5-sonnet-latest | claude-3-5-sonnet-latest, claude-3-5-haiku-latest, claude-3-opus-latest |
| `mistral` | Mistral | API | mistral-large-latest | mistral-large-latest, mistral-small-latest |
| `gemini` | Google Gemini | API | gemini-1.5-flash | gemini-1.5-flash, -flash-8b, -pro, gemini-2.0-flash, -flash-exp, gemini-2.5-pro, -flash |
| `groq` | Groq | API | llama-3.3-70b-versatile | llama-3.3-70b-versatile, llama-3.1-8b-instant |
| `ollama` | Ollama (Local CLI) | LOCAL | llama3.1:8b | llama3.1:8b, llama3.1:70b, qwen2.5:7b, mistral-nemo |
| `llamacpp` | llama.cpp (Local CLI) | LOCAL | local-model.gguf | local-model.gguf |
| `llamafile` | llamafile (Local CLI) | LOCAL | local-model.llamafile | local-model.llamafile |

---

## 5. API Key Lifecycle (encrypt → store → mask → decrypt)

```
User types API key in frontend
        │
        ▼
PUT /api/multi-model/config
        │
        ▼
saveConfig(userId, doc)
        │
        ├── encryptApiKey(plaintext)          ← AES-256-GCM
        │   returns "ivHex:tagHex:cipherHex"
        │
        ▼
DB row: globalConfig / featureConfigs / hostConfig / specialistConfigs
        stores the encrypted blob as a JSON string
        │
        ▼
GET /api/multi-model/config  (later)
        │
        ▼
getConfig(userId)
        │
        ├── decryptApiKey(blob) → plaintext   ← only to re-mask for display
        ├── maskApiKey(plaintext) → "sk-••••7890"
        │
        ▼
Returns masked config to frontend  (never plaintext)

POST /api/multi-model/dispatch  (when user sends a message)
        │
        ▼
getConfigInternal(userId)
        │
        ├── decryptApiKey(blob) → plaintext   ← real key, used for the actual call
        │
        ▼
dispatch(userId, messages)
        │
        ▼
realCall(assignment, messages)
        uses the decrypted key to call the provider
```

**Rule:** the plaintext API key only ever exists in two places:
1. The user's browser (during input)
2. Server memory inside `getConfigInternal()` + `realCall()` — never logged, never returned in any response

---

## 6. How Each Mode Routes Through the Backend

All three modes share the same `dispatch(userId, messages)` entry point. The mode is read from the user's saved config. The `resolvePlan()` function decides which `ModelAssignment`(s) to use.

### Mode 1: SINGLE

```
User sends message
        │
        ▼
dispatch(userId, messages)
        │
        ▼
getConfigInternal(userId) → doc
        │
        ▼
resolvePlan(doc, messages)
        mode === "SINGLE"
        │
        ├── assignment = doc.globalConfig  (the one model)
        │
        ▼
assignments = [{ id: "global", label: "Single Model", assignment }]
multiAgent = false
        │
        ▼
(no confirmation needed — single model)
        │
        ▼
callModel(assignment, messages, { timeoutMs, role: "Single Model" })
        │
        ├── timeout = timeoutOverrides[assignment.connectionType]
        │             || DEFAULT_TIMEOUTS[assignment.connectionType]
        │   (API → 30s, LOCAL → 60s — user can override)
        │
        ├── Promise.race([
        │     realCall(assignment, messages, role, intent),
        │     timeout reject
        │   ])
        │
        ├── on failure → retry up to MAX_RETRY (2) with backoff
        │
        ▼
realCall()
        │
        ├── dynamic import z-ai-web-dev-sdk (server-only)
        ├── system prompt: "You are NOX AI. Respond helpfully and concisely."
        ├── zai.chat.completions.create({ messages, thinking: disabled })
        │
        ▼
Returns DispatchResult {
        ok: true,
        mode: "SINGLE",
        steps: [{ role: "Single Model", model, provider, connectionType, latencyMs, retries }],
        finalReply: "...",
        multiAgent: false
}
```

**Config used:** `globalConfig` only (1 `ModelAssignment`). Can be API or LOCAL.

---

### Mode 2: MULTI

```
User sends message
        │
        ▼
dispatch(userId, messages)
        │
        ▼
getConfigInternal(userId) → doc
        │
        ▼
resolvePlan(doc, messages)
        mode === "MULTI"
        │
        ├── detect feature from prompt keywords:
        │     /code|function|bug|regex/  → "coding"
        │     /image|picture|photo|ocr/  → "vision"
        │     /voice|speak|speech|audio/ → "voice"
        │     /automate|workflow|pipeline/ → "automation"
        │     /robot|move|arm|sensor/    → "robotics"
        │     (default)                  → "chat"
        │
        ├── assignment = doc.featureConfigs[feature]
        │                || doc.featureConfigs.chat
        │                || emptyAssignment()
        │
        ▼
assignments = [{ id: feature, label: feature, assignment }]
multiAgent = false  (still one model — just picked per-feature)
        │
        ▼
(no confirmation needed)
        │
        ▼
callModel(assignment, messages, { timeoutMs, role: feature, intent: feature })
        │
        ├── system prompt: "You are NOX {feature} specialist (intent: {feature})..."
        │
        ▼
Returns DispatchResult {
        ok: true,
        mode: "MULTI",
        steps: [{ role: feature, model, provider, connectionType, intent: feature, ... }],
        finalReply: "...",
        multiAgent: false
}
```

**Config used:** `featureConfigs` — a map of 6 features → `ModelAssignment`. Each feature can independently be API or LOCAL. Example:

```json
{
  "chat":       { "connectionType": "API",   "provider": "openai",    "modelName": "gpt-4o-mini" },
  "coding":     { "connectionType": "API",   "provider": "anthropic", "modelName": "claude-3-5-sonnet-latest" },
  "vision":     { "connectionType": "API",   "provider": "gemini",    "modelName": "gemini-2.0-flash" },
  "voice":      { "connectionType": "LOCAL", "provider": "ollama",    "modelName": "llama3.1:8b", "cliPath": "/usr/local/bin/ollama" },
  "automation": { "connectionType": "API",   "provider": "groq",      "modelName": "llama-3.3-70b-versatile" },
  "robotics":   { "connectionType": "LOCAL", "provider": "llamacpp",  "modelName": "local-model.gguf", "cliPath": "/usr/bin/llama-cli" }
}
```

---

### Mode 3: ORCHESTRATOR

```
User sends message
        │
        ▼
dispatch(userId, messages, { confirmMultiAgent? })
        │
        ▼
getConfigInternal(userId) → doc
        │
        ▼
resolvePlan(doc, messages)
        mode === "ORCHESTRATOR"
        │
        ├── host = doc.hostConfig  (always used)
        │
        ├── detect specialist from prompt keywords:
        │     /plan|design|architect|roadmap/  → "planning"
        │     /code|function|bug|build|implement/ → "coding"
        │     /image|picture|photo|ocr/        → "vision"
        │     /automate|workflow|pipeline|chain/ → "automation"
        │     /robot|move|arm|sensor/          → "robotics"
        │     (none matched)                   → null (host answers directly)
        │
        ├── if specialist:
        │     assignments = [host, specialist]
        │     multiAgent = true
        │   else:
        │     assignments = [host]
        │     multiAgent = false
        │
        ▼
IF multiAgent AND !confirmMultiAgent:
        │
        ├── checkLimits(assignments, "medium")
        │     for each assignment:
        │       API → { remainingQuota, rateLimitPerMin, remainingTokens, canFinish }
        │       LOCAL → { busy, estimatedCapacity, canFinish }
        │
        ▼
Returns DispatchResult {
        ok: false,
        confirmationRequired: true,
        limits: ModelLimit[],
        multiAgent: true
}
        │
        ▼  (frontend shows Multi-Agent confirmation dialog)
        │
        ▼  user clicks "Continue"
        │
dispatch(userId, messages, { confirmMultiAgent: true })
        │
        ▼
IF multiAgent AND confirmMultiAgent:
        │
        ├── re-check limits
        ├── if any model canFinish === false → return error with reason
        │
        ▼  (limits OK — run the 3-step pipeline)

STEP 1: Host analyzes
        callModel(host, messages, { role: "host", intent: plan.intent })
        │
        ▼
STEP 2: Specialist handles
        specialistMessages = [...messages, "[Host routed this to {specialist}. Fulfill.]"]
        callModel(specialist, specialistMessages, { role: specialist, intent })
        │
        ▼
STEP 3: Host synthesizes
        finalMessages = [...messages, "Specialist responded with: {answer}. Reply to user."]
        callModel(host, finalMessages, { role: "host" })
        │
        ▼
Returns DispatchResult {
        ok: true,
        mode: "ORCHESTRATOR",
        steps: [
          { role: "host",        intent: "analyze",    ... },
          { role: "{specialist}", intent: "{specialist}", ... },
          { role: "host",        intent: "synthesize", ... }
        ],
        finalReply: "...",
        multiAgent: true,
        limits: ModelLimit[]
}
```

**Config used:** `hostConfig` + `specialistConfigs` (5 specialists). Each of the 6 roles (Host + 5 specialists) can independently be API or LOCAL. Example:

```json
{
  "hostConfig": { "connectionType": "API", "provider": "openai", "modelName": "gpt-4o" },
  "specialistConfigs": {
    "planning":   { "connectionType": "LOCAL", "provider": "ollama",   "modelName": "llama3.1:70b", "cliPath": "/usr/local/bin/ollama" },
    "coding":     { "connectionType": "API",   "provider": "anthropic","modelName": "claude-3-5-sonnet-latest" },
    "vision":     { "connectionType": "API",   "provider": "gemini",   "modelName": "gemini-2.0-flash" },
    "automation": { "connectionType": "API",   "provider": "openai",   "modelName": "gpt-4o-mini" },
    "robotics":   { "connectionType": "LOCAL", "provider": "llamacpp", "modelName": "local-model.gguf", "cliPath": "/usr/bin/llama-cli" }
  }
}
```

This is the "mixed connection types within Host mode" pattern — Host=API, Planning=LOCAL, Coding=API, Vision=API, Automation=API, Robotics=LOCAL — each role picks its own connection type independently.

---

## 7. Safety Layers (all three modes)

| Layer | Where in code | What it does |
|---|---|---|
| Connect-time validation | `testAssignment()` + `/api/multi-model/test` | Pings the model before save. Returns `Ready` badge or `Error` with `reason` + numbered `fixSteps`. Frontend blocks Save when status is `error`. |
| Per-connection-type timeout | `DEFAULT_TIMEOUTS` + `timeoutOverrides` | API → 30s default, LOCAL → 60s default. User can override per type. Enforced via `Promise.race` in `callModel`. |
| Capped auto-retry | `callModel` loop | On timeout/error, retries up to `MAX_RETRY = 2` with exponential backoff (200ms × attempt). |
| Pre-flight confirmation | `dispatch()` + `/api/multi-model/limits` | In ORCHESTRATOR mode, if `multiAgent` and no `confirmMultiAgent` flag → returns `confirmationRequired: true` + per-model limit summary. Frontend shows dialog. |
| Per-model capacity check | `checkLimits()` | API models: `remainingQuota` / `rateLimitPerMin` / `remainingTokens`. LOCAL models: `busy` / `estimatedCapacity`. If any `canFinish === false` after confirmation → returns error with reason + fallback options (Switch to Single / Change model / Cancel). |

---

## 8. Test Endpoint Behavior by Connection Type

```
POST /api/multi-model/test
Body: { assignment: ModelAssignment }
```

### API path
1. Validate `provider` + `modelName` present
2. Validate `apiKey` present and ≥ 8 chars
3. Look up provider in `PROVIDERS` catalog
4. Check if `modelName` is in the provider's known `models` list
   - If yes → `version = modelName`, `versionMatch = true`
   - If no → `version = "modelName (unknown version)"`, `versionMatch = false`, returns `reason` + `fixSteps`
5. Return `{ ok: true, status: "ready", message: "Connected to {provider} ({model}).", version, latencyMs }`

### LOCAL path
1. Validate `provider` + `modelName` present
2. Validate `cliPath` present (non-empty)
3. Look up provider in catalog
4. Version check (same as API)
5. Return `{ ok: true, status: "ready", message: "Local CLI reachable at {path}. Model \"{model}\" responding.", version, latencyMs }`

### Error cases (both)
- Missing provider/model → `error` with fix steps
- API key too short → `error` with fix steps
- CLI path empty → `error` with fix steps
- Unknown provider → `error` with fix steps

---

## 9. Dispatch Endpoint Summary

```
POST /api/multi-model/dispatch
Body: { messages: ChatMessage[], confirmMultiAgent?: boolean }
Auth: requires session cookie (userId extracted)
```

| Mode | Assignments used | Confirmation? | Steps in trace |
|---|---|---|---|
| SINGLE | `globalConfig` | No | 1 (Single Model) |
| MULTI | `featureConfigs[detected]` | No | 1 (feature) |
| ORCHESTRATOR (general) | `hostConfig` only | No | 1 (host) |
| ORCHESTRATOR (specialist) | `hostConfig` + `specialistConfigs[detected]` | **Yes** — first call returns `confirmationRequired`, second call with `confirmMultiAgent: true` runs the 3-step pipeline | 3 (host analyze → specialist → host synthesize) |

---

## 10. Auth Flow (context for all of the above)

```
Signup/Login → POST /api/auth/{signup,login}
        │
        ├── verify password (scrypt)
        ├── create HMAC-signed session token: "userId|expiresAtMs.signature"
        ├── set httpOnly cookie (30-day TTL, sameSite=lax)
        │
        ▼
Every subsequent API request
        │
        ▼
getCurrentUser()
        │
        ├── read cookie
        ├── verify HMAC signature
        ├── check expiresAt not passed
        ├── look up user in DB
        │
        ▼
Returns { id, email, name } or null
        │
        ▼
Every multi-model + conversations route calls getCurrentUser()
        - null → return 401
        - user → pass user.id to service functions (all data is user-scoped)
```

---

## Summary Table

| Mode | Config field | # of assignments | Connection flexibility | Confirmation flow |
|---|---|---|---|---|
| **SINGLE** | `globalConfig` | 1 | API or LOCAL (single choice) | Never |
| **MULTI** | `featureConfigs` | 1 per message (6 total configurable) | Each feature independently API or LOCAL | Never |
| **ORCHESTRATOR** | `hostConfig` + `specialistConfigs` | 1 (general) or 2 (host + specialist) | Each role independently API or LOCAL | Yes, when specialist is triggered |

**The single rule that makes everything work:** every `ModelAssignment` carries its own `connectionType`, so the dispatch logic never needs to know whether it's calling API or LOCAL — it just reads `assignment.connectionType` for timeouts, limit checks, and trace reporting.
