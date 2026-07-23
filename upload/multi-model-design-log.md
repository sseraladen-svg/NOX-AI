# Multi-Model Advanced Customization — Design Documentation

This document records the full design process for the Multi-Model feature inside Advanced Customization: what was asked, what was proposed, what problems came up, and how each was solved — in the order it happened.

---

## 1. Initial Feature Request

**Exact prompt given:**
> "now in the adanced customization option create this feature multimodel combination we can assign the one model to all features and diffrent model to each of the features like diffrent model for chat and voice and vision and coding and automation and robotics each can assign differnt model.create the backend for the advanced customazition in the multimodel combination we can connect local CLI or API key for each feature and we can use the single model for all feature by connecting it local CLI or API."

**What this meant (confirmed understanding):**
- Two modes needed: **Global Mode** (one model for all features) and **Per-Feature Mode** (each feature gets its own model)
- Every assignment — global or per-feature — needed to support **two connection types**: Local CLI (ollama/llama.cpp/llamafile) or API Key (OpenAI/Anthropic/etc.)
- Needed backend: DB schema, config routes, and routing logic (`multi_model_service.dispatch`)

**Output given:**
- DB schema for `multi_model_config` (mode, global_config, feature_configs)
- API routes: `GET/PUT /api/multi-model/config`, `GET /api/multi-model/providers`, `POST /api/multi-model/test`
- Config resolution logic inside `dispatch(feature, messages)`
- Requirement: API keys encrypted at rest, masked on GET

---

## 2. Frontend Layout Request

**Exact prompt given:**
> "and also i need that in the advanced option like how i imagine"

**Output given:** A visual layout of the Advanced Customization panel:
- Mode switch toggle at top (Global vs Per-Feature)
- Global mode → single config card
- Per-Feature mode → 6 independent cards (Chat, Voice, Vision, Coding, Automation, Robotics), each with its own connection type, fields, and Test button
- Export/Import/Reset buttons retained at the bottom

---

## 3. Build Prompt Request (existing folder, no new structure)

**Exact prompt given:**
> "on the frontend" → followed by: "i laready what already in now give the prompt that to build what exactly need in the backend and also the frontend and front name is alreday created it is agavanced dont mess with new folder"

**Problem identified:** Risk of creating duplicate/new folders instead of extending the existing "Advanced" section.

**Solution:** Wrote an explicit build prompt for opencode with a hard constraint: *"DO NOT create a new folder or new page — extend the EXISTING Advanced section only."* Covered backend (schema, routes, dispatch integration) and frontend (mode toggle, global card, 6 per-feature cards, Export/Import/Reset) in one prompt, backend-first ordering.

---

## 4. Pipeline Visualization Requests

**Exact prompt given:**
> "Show me an linear or a sequential pipeline how they're working inside for the multi modal combination and a single model combination."

Followed by:
> "I I I need as a simple terms. Right? Don't get to go for or complex. I need it in a simple way to... anybody can understand it."

Followed by a specific format example (conveyor belt / defect inspection pipeline with `│ ▼` arrows).

**Problem identified:** First version was too technical/wordy for general understanding; needed a specific ASCII vertical-arrow format.

**Solution:** Rebuilt both pipelines (Global Mode and Per-Feature Mode) as clean vertical step-by-step diagrams using the exact `│ / ▼` format requested, matching the style of the reference conveyor-belt diagram.

---

## 5. Host Orchestrator Mode (new concept introduced)

**Exact prompt given:**
> "and another option multi model combination like making one model as host for the indentifyinign the prompt context and seprating task to differnt model if coding means the host model calls the coding model and give answer to host and host responec to as if i tell to plan the host analyze the prompt it it will reach the plan model and get response from it to host and if the tell to build it host do the same it will plan it givego to information to coding and it will go to another agent"

**What this meant:** A third mode — one "Host" model reads the user's prompt, decides what kind of task it is (planning, coding, vision, etc.), routes the task to the correct specialist model, receives the specialist's answer, and replies to the user. This is a router/orchestrator pattern.

**Output given:** Full pipeline diagram (setup phase + runtime phase) plus a concrete step-by-step example: "Plan a login system" → Host routes to Planning model → response returns to Host → Host replies. Then "Now build it" → Host routes to Coding model (with plan as context) → response returns to Host → Host replies.

---

## 6. Mixed Connection Types Within Host Mode

**Exact prompt given:**
> "over main feature in the combine use model we can use local cli for one model and api for another model for all models"

**What this meant:** Within Host Orchestrator mode, each role (Host, Planning, Coding, Vision, Automation, Robotics) needed its own independent connection type — some Local CLI, some API — not one connection type for the whole system.

**Output given:** Updated Host pipeline showing each role choosing its connection type separately, with a concrete example table (Host=API, Planning=Local, Coding=API, Vision=Local, Automation=API, Robotics=Local), and runtime logic showing the Host looking up each role's connection type individually before dispatching.

---

## 7. Feedback Request on Overall Structure

**Exact prompt given:**
> "tell feedback about the struture i build"

**Feedback given, organized into three parts:**

**Strong points:**
1. Global → Per-Feature → Host Orchestrator is a well-layered progression of complexity
2. Decoupling connection type from role (instead of one global switch) was the correct architectural call
3. The Host Orchestrator pattern matches real-world multi-agent frameworks (LangGraph/CrewAI-style routing)

**Problems identified:**
1. **No timeout/retry strategy for local CLI calls** — subprocess calls can hang indefinitely
2. **No handling for a per-feature model being unreachable** (e.g. Coding assigned to a local CLI that isn't running)
3. No defined context handoff between Host and specialist models (does Host forward full history or a summary?)
4. No cost/usage tracking across multiple paid API calls per request
5. Unclear whether Global / Per-Feature / Host modes are three separate systems or one unified schema

---

## 8. Problem 1 & 2 Solved: Timeout, Retry, and Connection Validation

**Exact prompt given:**
> "the problems :(No mention of a timeout/retry strategy for local CLI calls (subprocess calls can hang),The per-feature model assigned to Coding is a local CLI, and the CLI isn't running?) the solution is :we build the timetaken features that before doing anything the host first analaze the prompt and if it going to use multiple agents it will ask the confirmation to user if the user accepted the requirement asked by model it will give a certain time to complete the task,next for the timeout the host continously automate without the use of human need if it going to timeout the host automatically send signal to not timout if it timeout the host automatically activate the retry and next thing we will ensure when we connceting model evrything working properly according to the model and version ,when the user connect its and we automatically active and get the respobse message from that model the response come we start working or if not we disple the message to the user and why it is occured and what user need to do"

**Proposed solution (as given by user):**
1. Host asks for user confirmation before running a multi-agent task
2. After confirmation, a time limit is set for task completion
3. Host auto-manages the timeout without needing the user
4. If about to time out, Host sends a signal to prevent it
5. If it does time out, Host auto-retries
6. When a model is connected, the system checks it works correctly (model + version) — shows success or a clear error with reason and fix steps

**Gaps found in this solution:**
- "Give a certain time" had no defined default or rule
- "Host sends signal to not timeout" is not something an AI model can technically do — timeouts are backend-enforced, not model-controlled
- "Auto-retry" had no retry limit, risking infinite loops
- Version-mismatch handling wasn't specified (block save vs. save with warning)

**Final solved structure:**
```
Backend sets a max wait time (default per connection type; user can override)
   ↓
Backend heartbeat-checks the process while running
   ↓
Still producing output → extend wait
No response/frozen → timeout triggered
   ↓
Timeout triggered → auto-retry (capped at 2 attempts)
   ↓
Still fails → stop, show user what failed, why, and what to do
```
```
On connecting a new model:
Backend sends an immediate test ping
   ↓
Responds correctly + version matches → save config, mark "Ready"
   ↓
No response OR version mismatch → block save, show error + reason + fix steps
```

---

## 9. Problem 3 Solved: Model Limits Before Multi-Agent Execution

**Exact prompt given:**
> "Multi-agent task detected by Host ↓ Ask user: "This needs multiple models, confirm?" ↓ User confirms → set timeout (default per connection type, user can override it between the model check the limits after user confirmend for using multiagent it goes to all model the check the limist and show the eacg model limit remaining ,if it can finish the task under limit after analyzing by host it will provide option to continue if not it will below that the task cannot be finshed beacuse limit in which model and providing two option one is go to setting change the model or use global mode in the setting"

**What this added:** Before running a confirmed multi-agent task, the system should check every involved model's remaining capacity (rate limit/quota/tokens for API, busy-status for local), show the user a per-model limit summary, and only let them continue if every model can realistically complete its part. If not, offer options to fix it.

**Gaps found:**
- "Check the limits" needed to be split by connection type (API = quota/rate/tokens; Local = busy-status + rough capacity estimate) since they're checked differently
- Host "predicting if it can finish" can only ever be an estimate, not a guarantee — needed to be framed honestly in the UI
- Two fallback options were given; a third (skip the specialist and let Host handle that sub-task directly, if capable) was added as an optional extra

**Final solved structure:**
```
Multi-agent task detected by Host
   ↓
Ask user: "This needs multiple models, confirm?"
   ↓
User confirms
   ↓
Backend checks every involved model:
   ├─ API models   → remaining quota / rate limit / token limit
   └─ Local models → busy or free + rough capacity estimate
   ↓
Host estimates task size vs. each model's remaining limit
   ↓
Show per-model limit summary to user
   ↓
   Can all models finish? 
   ├─ YES → show "Continue" → task runs (with timeout/retry from Section 8)
   └─ NO  → show which model is insufficient and why
             → offer: (1) change that model in Settings
                      (2) switch to Global Mode for this task
                      (3) [optional] let Host handle that sub-task directly
```

**Open decision flagged, not yet resolved:** whether limits are checked only once before starting, or also re-checked mid-task for long multi-step jobs. Recommendation given: check once upfront for the first build; don't over-engineer this yet.

---

## Summary of Final Architecture

| Mode | Behavior | Connection Flexibility |
|---|---|---|
| **Global** | One model handles all 6 features | Single connection type (Local or API) |
| **Per-Feature** | Each of the 6 features has its own model | Each feature independently Local or API |
| **Host Orchestrator** | Host model routes tasks to specialist models based on prompt intent | Each role (Host + specialists) independently Local or API |

**Safety layers added on top of all three modes:**
- Pre-flight user confirmation for multi-agent tasks
- Per-connection-type timeout defaults + backend heartbeat checks (not model-controlled)
- Capped auto-retry (2 attempts) on timeout
- Connection + version validation at the moment a model is connected, with save blocked on failure
- Per-model capacity/limit check before running a multi-agent task, with a clear summary and fallback options if any model can't complete its part

**Still open / not yet built:**
- Context handoff rules between Host and specialist models (full history vs. summary)
- Cost/usage tracking across multiple paid models per request
- Whether Global / Per-Feature / Host share one unified DB schema or separate ones (recommended: unified, with Host mode treated as Per-Feature + a routing layer)
