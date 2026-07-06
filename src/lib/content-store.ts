import { randomUUID } from "node:crypto";
import { validationError } from "./errors.js";

export const DEFAULT_CONTENT_STORE_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_CONTENT_STORE_MAX_ENTRIES = 50;

export interface StoredContent {
  content: string;
  contentType: string;
  extractor: string;
  title: string;
  url: string;
}

interface StoredContentEntry extends StoredContent {
  expiresAt: number;
}

export interface ContentSlice extends StoredContent {
  contentId: string;
  offset: number;
  returnedChars: number;
  totalChars: number;
  nextOffset?: number;
  truncated: boolean;
}

export interface ContentStoreOptions {
  maxEntries?: number;
  now?: () => number;
  ttlMs?: number;
  createId?: () => string;
}

export class ContentStore {
  private readonly createId: () => string;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly store = new Map<string, StoredContentEntry>();
  private readonly ttlMs: number;

  constructor(options: ContentStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.maxEntries = options.maxEntries ?? DEFAULT_CONTENT_STORE_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_CONTENT_STORE_TTL_MS;
  }

  put(content: StoredContent): string {
    this.cleanup();

    const contentId = this.createId();
    this.store.set(contentId, {
      ...content,
      expiresAt: this.now() + this.ttlMs,
    });
    this.trim();
    return contentId;
  }

  get(contentId: string): StoredContent | undefined {
    this.cleanup();

    const entry = this.store.get(contentId);
    if (!entry) return undefined;

    this.store.delete(contentId);
    this.store.set(contentId, entry);
    const { expiresAt: _expiresAt, ...content } = entry;
    return content;
  }

  slice(contentId: string, offset: number, limit: number): ContentSlice {
    const content = this.get(contentId);
    if (!content) throw validationError("Unknown or expired content_id");

    const totalChars = content.content.length;
    if (offset > totalChars) throw validationError("offset cannot exceed stored content length");

    const end = Math.min(offset + limit, totalChars);
    const nextOffset = end < totalChars ? end : undefined;

    return {
      ...content,
      contentId,
      content: content.content.slice(offset, end),
      offset,
      returnedChars: end - offset,
      totalChars,
      nextOffset,
      truncated: nextOffset !== undefined,
    };
  }

  get size(): number {
    this.cleanup();
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  private cleanup(): void {
    const now = this.now();
    for (const [contentId, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(contentId);
    }
  }

  private trim(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) return;
      this.store.delete(oldest);
    }
  }
}

export const contentStore = new ContentStore();
