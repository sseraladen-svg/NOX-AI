import "server-only";

export type {
  ConnectionType,
  Mode,
  FeatureId,
  SpecialistId,
  ModelAssignment,
  MultiModelConfigDoc,
  TestResult,
  ModelLimit,
  ChatMessage,
  DispatchStep,
  DispatchResult,
  TokenUsage,
  CostBreakdown,
  IntentClassification,
  AgentWorkspace,
  VerificationResult,
  OrchestrationState,
  OrchestrationStage,
} from "@/lib/multi-model-types";

export {
  FEATURES,
  SPECIALISTS,
  PROVIDERS,
  DEFAULT_TIMEOUTS,
  MAX_RETRY,
} from "@/lib/multi-model-types";

export { FEATURE_BUILTIN_RULES, needsClientOllama } from "./multi-model/shared";
export { getConfig, getConfigInternal, saveConfig } from "./multi-model/config-repo";
export {
  testAssignment,
  checkLimits,
  testGeminiConnection,
  testOpenAiCompatibleConnection,
  testAnthropicConnection,
  testOllamaConnection,
} from "./multi-model/providers";
export { dispatch, resumeDispatch, agentComplete } from "./multi-model/orchestrator";
export {
  type ConversationSummary,
  type ConversationDetail,
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  renameConversation,
  addMessage,
} from "./multi-model/conversations";
export {
  type UsageRecordInput,
  type UsageSummary,
  type UsageRecordRow,
  saveUsage,
  getUsageSummary,
  getRecentUsage,
} from "./multi-model/usage-logger";
