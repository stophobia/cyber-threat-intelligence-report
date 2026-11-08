import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/sessions.js";
import { openDb } from "../src/dashboard/db.js";

describe("SessionStore", () => {
  it("creates unique sessions with operator and timestamps", () => {
    const store = new SessionStore();
    const a = store.create("alice");
    const b = store.create("alice");
    expect(a.id).not.toBe(b.id);
    expect(a.operator).toBe("alice");
    expect(a.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("gets and resets a session", () => {
    const store = new SessionStore();
    const s = store.create("bob");
    s.history.push({ role: "user", content: "hi" });
    expect(store.get(s.id)?.history).toHaveLength(1);
    expect(store.reset(s.id)).toBe(true);
    expect(store.get(s.id)?.history).toHaveLength(0);
    expect(store.reset("missing")).toBe(false);
  });

  it("evicts idle sessions", () => {
    const store = new SessionStore({ idleMs: 10 });
    const s = store.create("alice");
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(store.get(s.id)).toBeUndefined();
        resolve();
      }, 25);
    });
  });

  it("caps the number of sessions, evicting the oldest", () => {
    const store = new SessionStore({ max: 3 });
    const a = store.create("a");
    const b = store.create("b");
    const c = store.create("c");
    store.get(a.id); // touch a so b is oldest
    store.create("d");
    expect(store.get(a.id)).toBeDefined();
    expect(store.get(b.id)).toBeUndefined();
    expect(store.get(c.id)).toBeDefined();
  });

  it("persists sessions in SQLite across store instances", () => {
    const ort = openDb(":memory:");
    try {
      const first = new SessionStore({ db: ort });
      const session = first.create("alice");
      session.history.push({ role: "user", content: "hello" });
      session.history.push({ role: "assistant", content: "hi there" });
      session.persist?.();

      const second = new SessionStore({ db: ort });
      const loaded = second.get(session.id);
      expect(loaded).toBeDefined();
      expect(loaded!.history).toHaveLength(2);
      expect(loaded!.operator).toBe("alice");

      second.reset(session.id);
      const third = new SessionStore({ db: ort });
      expect(third.get(session.id)?.history).toHaveLength(0);
    } finally {
      ort.close();
    }
  });
});
