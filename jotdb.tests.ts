import { assert, describe, it, beforeEach } from "bun:test";
import { JotDB } from "./src/index.ts";

// Fake DurableObjectState stub for unit testing
function createFakeState(): any {
  let store: Record<string, any> = {};
  return {
    storage: {
      get: async (k: string) => store[k],
      put: async (k: string, v: any) => { store[k] = v },
    }
  };
}

describe("JotDB", () => {
  let jot: JotDB;

  beforeEach(() => {
    jot = new JotDB(createFakeState());
  });

  it("should set and get a value", async () => {
    await jot.set("foo", "bar");
    const val = await jot.get("foo");
    assert(val === "bar");
  });

  it("should support setAll and getAll", async () => {
    await jot.setAll({ a: 1, b: true });
    const all = await jot.getAll();
    assert(all.a === 1);
    assert(all.b === true);
  });

  it("should enforce schema after inference", async () => {
    await jot.setAll({ x: "yes", y: 2 });
    await assert.rejects(() => jot.set("y", "not a number"));
  });

  it("should strip unknowns if autoStrip is on", async () => {
    await jot.setAll({ known: "yes" });
    await jot.setOptions({ autoStrip: true });
    await jot.setAll({ known: "ok", extra: "skip" });
    const data = await jot.getAll();
    assert(data.known === "ok");
    assert(!("extra" in data));
  });

  it("should block writes if readOnly is on", async () => {
    await jot.setAll({ z: 9 });
    await jot.setOptions({ readOnly: true });
    await assert.rejects(() => jot.set("z", 10));
  });

  it("should track audit logs", async () => {
    await jot.set("a", 1);
    await jot.setAll({ b: 2, c: 3 });
    const log = await jot.getAuditLog();
    assert(log.length >= 2);
    assert(log[0].action === "setAll");
    assert(log[1].action === "set");
  });
});
