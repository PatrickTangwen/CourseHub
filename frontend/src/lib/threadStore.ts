/**
 * localStorage 会话存储:线程元数据 + 每线程消息记录。
 * conv_id 不单独建映射 —— 它存在于 answer 元数据里,随消息一起持久化,
 * adapter 从最近一条 assistant 消息中恢复(单一事实来源)。
 */
import type { ExportedMessageRepositoryItem } from "@assistant-ui/react";

export interface StoredThreadMeta {
  remoteId: string;
  title?: string;
  lastMessageAt?: number;
  status: "regular" | "archived";
}

const THREADS_KEY = "coursehub.threads.v1";
const messagesKey = (remoteId: string) => `coursehub.thread.${remoteId}.v1`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function listThreads(): StoredThreadMeta[] {
  return readJson<StoredThreadMeta[]>(THREADS_KEY, []);
}

function saveThreads(threads: StoredThreadMeta[]): void {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

export function upsertThread(meta: StoredThreadMeta): void {
  const threads = listThreads();
  const existing = threads.find((t) => t.remoteId === meta.remoteId);
  if (existing) {
    Object.assign(existing, meta);
  } else {
    threads.unshift(meta);
  }
  saveThreads(threads);
}

export function patchThread(
  remoteId: string,
  patch: Partial<Omit<StoredThreadMeta, "remoteId">>,
): void {
  const threads = listThreads();
  const thread = threads.find((t) => t.remoteId === remoteId);
  if (!thread) return;
  Object.assign(thread, patch);
  saveThreads(threads);
}

export function getThread(remoteId: string): StoredThreadMeta | undefined {
  return listThreads().find((t) => t.remoteId === remoteId);
}

export function deleteThread(remoteId: string): void {
  saveThreads(listThreads().filter((t) => t.remoteId !== remoteId));
  localStorage.removeItem(messagesKey(remoteId));
}

interface RawStoredItem {
  parentId: string | null;
  message: Record<string, unknown> & { id?: string; createdAt?: string };
}

function reviveItem(raw: RawStoredItem): ExportedMessageRepositoryItem {
  return {
    ...raw,
    message: {
      ...raw.message,
      createdAt: raw.message.createdAt ? new Date(raw.message.createdAt) : new Date(),
    },
  } as unknown as ExportedMessageRepositoryItem;
}

export function loadMessages(remoteId: string): ExportedMessageRepositoryItem[] {
  return readJson<RawStoredItem[]>(messagesKey(remoteId), []).map(reviveItem);
}

export function appendMessage(
  remoteId: string,
  item: ExportedMessageRepositoryItem,
): void {
  const raw = readJson<RawStoredItem[]>(messagesKey(remoteId), []);
  raw.push(item as unknown as RawStoredItem);
  localStorage.setItem(messagesKey(remoteId), JSON.stringify(raw));
}

export function updateMessage(
  remoteId: string,
  item: ExportedMessageRepositoryItem,
): void {
  const raw = readJson<RawStoredItem[]>(messagesKey(remoteId), []);
  const id = (item as unknown as RawStoredItem).message.id;
  const index = raw.findIndex((entry) => entry.message.id === id);
  if (index >= 0) {
    raw[index] = item as unknown as RawStoredItem;
    localStorage.setItem(messagesKey(remoteId), JSON.stringify(raw));
  } else {
    appendMessage(remoteId, item);
  }
}
