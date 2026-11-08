import type { ChatMessage } from "./types.js";
import type { OrtDb } from "./dashboard/db.js";

export interface ChatSession {
  id: string;
  operator: string;
  history: ChatMessage[];
  createdAt: number;
  lastUsedAt: number;
  access: number;
  persist?: () => void;
}

const DEFAULT_MAX_SESSIONS = 200;
const DEFAULT_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, ChatSession>();
  private readonly max: number;
  private readonly idleMs: number;
  private readonly db?: OrtDb;
  private counter = 0;

  constructor(opts?: { max?: number; idleMs?: number; db?: OrtDb }) {
    this.max = opts?.max ?? DEFAULT_MAX_SESSIONS;
    this.idleMs = opts?.idleMs ?? DEFAULT_IDLE_MS;
    this.db = opts?.db;
    if (this.db) {
      this.db.pruneSessions(Date.now() - SESSION_TTL_MS);
    }
  }

  create(operator: string): ChatSession {
    this.evict(1);
    const session: ChatSession = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      operator,
      history: [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      access: ++this.counter,
    };
    if (this.db) {
      this.db.upsertSession(session.id, operator, "[]");
      session.persist = () => {
        this.db!.upsertSession(session.id, session.operator, JSON.stringify(session.history));
      };
    }
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ChatSession | undefined {
    this.evict(0);
    const cached = this.sessions.get(id);
    if (cached) {
      cached.lastUsedAt = Date.now();
      cached.access = ++this.counter;
      return cached;
    }
    if (this.db) {
      const row = this.db.getSession(id);
      if (row) {
        const session: ChatSession = {
          id: row.id,
          operator: row.operator,
          history: parseMessages(row.messages),
          createdAt: row.created_at,
          lastUsedAt: Date.now(),
          access: ++this.counter,
        };
        session.persist = () => {
          this.db!.upsertSession(session.id, session.operator, JSON.stringify(session.history));
        };
        this.sessions.set(id, session);
        return session;
      }
    }
    return undefined;
  }

  reset(id: string): boolean {
    const cached = this.sessions.get(id);
    if (cached) {
      cached.history = [];
      cached.persist?.();
      return true;
    }
    if (this.db) {
      const row = this.db.getSession(id);
      if (row) {
        this.db.upsertSession(id, row.operator, "[]");
        return true;
      }
    }
    return false;
  }

  size(): number {
    return this.sessions.size;
  }

  private evict(room: number): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsedAt > this.idleMs) this.sessions.delete(id);
    }
    const limit = this.max - room;
    while (this.sessions.size > limit) {
      let oldestId: string | undefined;
      let oldestAccess = Infinity;
      for (const [id, session] of this.sessions) {
        if (session.access < oldestAccess) {
          oldestAccess = session.access;
          oldestId = id;
        }
      }
      if (oldestId === undefined) break;
      this.sessions.delete(oldestId);
    }
  }
}

function parseMessages(raw: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m): m is ChatMessage =>
          typeof m === "object" && m !== null && typeof (m as ChatMessage).content === "string",
      );
    }
  } catch {
    /* fall through */
  }
  return [];
}
