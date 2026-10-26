import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "../../api/src/db/client.js";
import { pgSessionStorage } from "../src/session.js";

describe("Postgres session storage", () => {
  afterAll(() => closeDb());

  it("reads, writes, overwrites and deletes", async () => {
    const s = pgSessionStorage<{ userId?: number }>(sql());
    expect(await s.read("u1")).toBeUndefined();
    await s.write("u1", { userId: 5 });
    await s.write("u1", { userId: 6 });
    expect(await s.read("u1")).toEqual({ userId: 6 });
    await s.delete("u1");
    expect(await s.read("u1")).toBeUndefined();
  });
});
