// LocalStorage utilities for NOX AI - No login required
// All data stored in browser localStorage

const STORAGE_PREFIX = "nox_ai_";

export interface LocalStorageData {
  multiModelConfig: any;
  conversations: any[];
  userPreferences: {
    theme?: "light" | "dark";
    language?: string;
  };
}

// Get item from localStorage
export function getLocalStorageItem<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const item = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
}

// Set item in localStorage
export function setLocalStorageItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch (error) {
    console.error("Failed to save to localStorage:", error);
  }
}

// Remove item from localStorage
export function removeLocalStorageItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch (error) {
    console.error("Failed to remove from localStorage:", error);
  }
}

// Clear all NOX AI data from localStorage
export function clearLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(STORAGE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error("Failed to clear localStorage:", error);
  }
}

// MultiModel Config storage
export function saveMultiModelConfig(config: any): void {
  setLocalStorageItem("config", config);
}

export function getMultiModelConfig(): any {
  return getLocalStorageItem("config");
}

// Conversations storage
export function saveConversations(conversations: any[]): void {
  setLocalStorageItem("conversations", conversations);
}

export function getConversations(): any[] {
  return getLocalStorageItem("conversations") || [];
}

// Individual conversation storage
export function saveConversation(conversationId: string, conversation: any): void {
  const conversations = getConversations();
  const index = conversations.findIndex((c) => c.id === conversationId);
  if (index >= 0) {
    conversations[index] = conversation;
  } else {
    conversations.push(conversation);
  }
  saveConversations(conversations);
}

export function getConversation(conversationId: string): any | null {
  const conversations = getConversations();
  return conversations.find((c) => c.id === conversationId) || null;
}

export function deleteConversation(conversationId: string): void {
  const conversations = getConversations();
  const filtered = conversations.filter((c) => c.id !== conversationId);
  saveConversations(filtered);
}

// API Keys storage (encrypted at rest would be better, but this is basic)
export function saveApiKey(provider: string, apiKey: string): void {
  const keys = getLocalStorageItem<Record<string, string>>("api_keys") || {};
  keys[provider] = apiKey;
  setLocalStorageItem("api_keys", keys);
}

export function getApiKey(provider: string): string | null {
  const keys = getLocalStorageItem<Record<string, string>>("api_keys") || {};
  return keys[provider] || null;
}

export function removeApiKey(provider: string): void {
  const keys = getLocalStorageItem<Record<string, string>>("api_keys") || {};
  delete keys[provider];
  setLocalStorageItem("api_keys", keys);
}

// User preferences
export function saveUserPreferences(preferences: any): void {
  setLocalStorageItem("preferences", preferences);
}

export function getUserPreferences(): any {
  return getLocalStorageItem("preferences") || {};
}

// Check if localStorage is available
export function isLocalStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const test = "__storage_test__";
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

// Get total storage size
export function getLocalStorageSize(): number {
  if (typeof window === "undefined") return 0;
  let total = 0;
  Object.keys(localStorage)
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .forEach((key) => {
      total += localStorage.getItem(key)?.length || 0;
    });
  return total;
}
