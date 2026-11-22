import "server-only";
import { db } from "@/lib/db";
import type {
  Mode,
  DispatchStep,
  TokenUsage,
  CostBreakdown,
  AgentWorkspace,
  OrchestrationState,
  OrchestrationStage,
  IntentClassification,
} from "@/lib/multi-model-types";

export interface ConversationSummary {
  id: string;
  title: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: {
    id: string;
    role: string;
    content: string;
    trace?: DispatchStep[];
    orchestration?: {
      state?: OrchestrationState;
      stage?: OrchestrationStage;
      workspace?: AgentWorkspace;
      classification?: IntentClassification;
      approvalId?: string;
      highImpactActions?: string[];
      request?: string;
    };
    mode?: string;
    multiAgent: boolean;
    error: boolean;
    createdAt: string;
  }[];
}

export async function listConversations(
  userId: string,
  scope?: string
): Promise<ConversationSummary[]> {
  const rows = await db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const scopedRows = scope
    ? rows.filter((r) => r.mode === scope)
    : rows;
  return scopedRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createConversation(
  userId: string,
  mode: Mode | string = "SINGLE",
  title = "New conversation"
): Promise<ConversationSummary> {
  const row = await db.conversation.create({
    data: { userId, mode, title },
    select: {
      id: true,
      title: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getConversation(
  userId: string,
  conversationId: string
): Promise<ConversationDetail | null> {
  const row = await db.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      trace: m.trace ? (JSON.parse(m.trace) as DispatchStep[]) : undefined,
      orchestration: m.orchestration
        ? JSON.parse(m.orchestration)
        : undefined,
      mode: m.mode || undefined,
      multiAgent: m.multiAgent,
      error: m.error,
      usage: m.usage
        ? (JSON.parse(m.usage) as { tokens?: TokenUsage; cost?: CostBreakdown })
        : undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  await db.conversation.deleteMany({
    where: { id: conversationId, userId },
  });
}

export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string
): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { title },
  });
}

export async function addMessage(
  userId: string,
  conversationId: string,
  msg: {
    role: "user" | "assistant";
    content: string;
    trace?: DispatchStep[];
    orchestration?: {
      state?: OrchestrationState;
      stage?: OrchestrationStage;
      workspace?: AgentWorkspace;
      classification?: IntentClassification;
      approvalId?: string;
      highImpactActions?: string[];
      request?: string;
    };
    mode?: string;
    multiAgent?: boolean;
    error?: boolean;
    usage?: { tokens?: TokenUsage; cost?: CostBreakdown };
  }
): Promise<void> {
  // Verify ownership
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!conv) throw new Error("Conversation not found");

  await db.message.create({
    data: {
      conversationId,
      role: msg.role,
      content: msg.content,
      trace: msg.trace ? JSON.stringify(msg.trace) : null,
      orchestration: msg.orchestration ? JSON.stringify(msg.orchestration) : null,
      mode: msg.mode || null,
      multiAgent: msg.multiAgent || false,
      error: msg.error || false,
      usage: msg.usage ? JSON.stringify(msg.usage) : null,
    },
  });

  // Auto-title the conversation from the first user message
  if (msg.role === "user") {
    const count = await db.message.count({
      where: { conversationId, role: "user" },
    });
    if (count === 1) {
      const title = msg.content.slice(0, 60).trim() || "New conversation";
      await db.conversation.update({
        where: { id: conversationId },
        data: { title },
      });
    }
    // Touch updatedAt
    await db.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}
