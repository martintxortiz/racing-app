import { defineTestApp } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../convex/schema";
import * as events from "../convex/events";
import * as authFunctions from "../convex/auth";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  events,
  auth: authFunctions,
});

describe("events", () => {
  it("create requires auth and a name", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.events.create, { name: "Test GP" }),
    ).rejects.toThrow(/signed in/i);

    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    const asUser = t.withIdentity({ subject: userId });
    await expect(
      asUser.mutation(api.events.create, { name: "  " }),
    ).rejects.toThrow(/event name/i);

    const id = await asUser.mutation(api.events.create, {
      name: "  Test GP  ",
    });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({ name: "Test GP" });
    expect(doc?.dateStart).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("create uses provided dateStart when set", async () => {
    const t = createTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    const id = await t
      .withIdentity({ subject: userId })
      .mutation(api.events.create, {
        name: "Test GP",
        dateStart: "2026-03-15T14:00:00Z",
      });
    const doc = await t.run((ctx) => ctx.db.get(id));
    expect(doc).toMatchObject({
      name: "Test GP",
      dateStart: "2026-03-15T14:00:00Z",
    });
  });

  it("list returns empty when signed out", async () => {
    const t = createTest();
    await t.run((ctx) =>
      ctx.db.insert("events", {
        name: "Hidden",
        dateStart: "2026-03-15T14:00:00Z",
      }),
    );
    expect(await t.query(api.events.list, {})).toEqual([]);
  });

  it("list maps events with empty sessions", async () => {
    const t = createTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    await t.run((ctx) =>
      ctx.db.insert("events", {
        name: "Test GP",
        dateStart: "2026-03-15T14:00:00Z",
      }),
    );

    const rows = await t
      .withIdentity({ subject: userId })
      .query(api.events.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Test GP",
      dateStart: "2026-03-15T14:00:00Z",
      startDate: "2026-03-15",
      sessions: [],
    });
    expect(rows[0].startTime).toContain("14:00:00");
  });

  it("upsert reuses an event by name and can rename it by id", async () => {
    const t = createTest();
    const id = await t.mutation(internal.events.upsert, {
      name: "  singapore  ",
      dateStart: "2026-10-21T07:11:20.728Z",
    });
    const again = await t.mutation(internal.events.upsert, {
      name: "singapore",
      dateStart: "2026-10-11T07:00:00Z",
    });
    expect(again).toBe(id);

    const renamed = await t.mutation(internal.events.upsert, {
      id,
      name: "round_17_singapore_2026-10-11",
    });
    expect(renamed).toBe(id);
    const docs = await t.run((ctx) => ctx.db.query("events").collect());
    expect(docs).toMatchObject([
      {
        _id: id,
        name: "round_17_singapore_2026-10-11",
        dateStart: "2026-10-11T07:00:00Z",
      },
    ]);

    await expect(
      t.mutation(internal.events.upsert, { name: "  " }),
    ).rejects.toThrow(/event name/i);
    const missing = await t.run(async (ctx) => {
      const gone = await ctx.db.insert("events", {
        name: "gone",
        dateStart: "2026-10-11T07:00:00Z",
      });
      await ctx.db.delete(gone);
      return gone;
    });
    await expect(
      t.mutation(internal.events.upsert, {
        id: missing,
        name: "round_18_monaco_2026-05-24",
      }),
    ).rejects.toThrow(/event not found/i);

    const other = await t.mutation(internal.events.upsert, {
      name: "round_18_monaco_2026-05-24",
      dateStart: "2026-05-24T13:00:00Z",
    });
    await expect(
      t.mutation(internal.events.upsert, {
        id: other,
        name: "round_17_singapore_2026-10-11",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("list includes session names for the event", async () => {
    const t = createTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    const eventId = await t.run((ctx) =>
      ctx.db.insert("events", {
        name: "Round 1 Melbourne",
        dateStart: "2026-03-15T04:00:00Z",
      }),
    );
    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["mcap"])),
    );
    await t.run((ctx) =>
      ctx.db.insert("sessions", {
        eventId,
        type: "race",
        name: "Race",
        storageId,
        fileName: "race.mcap",
        size: 4,
      }),
    );

    const rows = await t
      .withIdentity({ subject: userId })
      .query(api.events.list, {});
    expect(rows[0]?.sessions).toEqual(["Race"]);
  });

  it("get returns null for bad ids", async () => {
    const t = createTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    expect(
      await t.withIdentity({ subject: userId }).query(api.events.get, {
        id: "not-an-id",
      }),
    ).toBeNull();
  });
});
