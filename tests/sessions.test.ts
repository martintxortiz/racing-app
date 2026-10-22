import { defineTestApp } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../convex/schema";
import * as events from "../convex/events";
import * as sessions from "../convex/sessions";
import * as authFunctions from "../convex/auth";

const { api, internal, createTest } = defineTestApp({ schema }).defineModules({
  events,
  sessions,
  auth: authFunctions,
});

async function seedEvent(t: ReturnType<typeof createTest>) {
  return await t.run((ctx) =>
    ctx.db.insert("events", {
      name: "Round 1 Melbourne",
      dateStart: "2026-03-15T04:00:00Z",
    }),
  );
}

async function storeFile(t: ReturnType<typeof createTest>, contents = "mcap") {
  return await t.run((ctx) => ctx.storage.store(new Blob([contents])));
}

describe("sessions", () => {
  it("generateUploadUrl returns a url", async () => {
    const t = createTest();
    const url = await t.mutation(internal.sessions.generateUploadUrl, {});
    expect(url).toEqual(expect.any(String));
    expect(url.length).toBeGreaterThan(0);
  });

  it("upsert attaches a file and replaces the same session type", async () => {
    const t = createTest();
    const eventId = await seedEvent(t);
    const first = await storeFile(t, "fp1");
    const second = await storeFile(t, "fp1-again");

    const id = await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "fp1",
      storageId: first,
      fileName: "fp1.mcap",
      sessionKey: 9222,
    });
    const replaced = await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "fp1",
      storageId: second,
      fileName: "  fp1-new.mcap  ",
      name: "Practice 1",
      startTime: "2026-03-13T01:30:00Z",
    });

    expect(replaced).toBe(id);
    const docs = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      eventId,
      type: "fp1",
      name: "Practice 1",
      fileName: "fp1-new.mcap",
      storageId: second,
      startTime: "2026-03-13T01:30:00Z",
    });
    expect(docs[0]?.sessionKey).toBeUndefined();
    expect(docs[0]?.size).toBeGreaterThan(0);
    expect(await t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
  });

  it("keeps a second session type on the same event", async () => {
    const t = createTest();
    const eventId = await seedEvent(t);
    const race = await storeFile(t);
    const qualifying = await storeFile(t, "quali");

    await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "race",
      storageId: race,
      fileName: "race.mcap",
    });
    await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "qualifying",
      storageId: qualifying,
      fileName: "qualifying.mcap",
    });

    const docs = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(docs.map((doc) => doc.type).sort()).toEqual(["qualifying", "race"]);
    expect(docs.find((doc) => doc.type === "race")?.name).toBe("Race");
  });

  it("rejects a missing event, a missing file, and a non-mcap name", async () => {
    const t = createTest();
    const eventId = await seedEvent(t);
    const storageId = await storeFile(t);
    const missingEvent = await t.run(async (ctx) => {
      const id = await ctx.db.insert("events", {
        name: "Gone",
        dateStart: "2026-03-15T04:00:00Z",
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(internal.sessions.upsert, {
        eventId: missingEvent,
        type: "race",
        storageId,
        fileName: "race.mcap",
      }),
    ).rejects.toThrow(/event not found/i);
    await expect(
      t.mutation(internal.sessions.upsert, {
        eventId,
        type: "race",
        storageId: await t.run((ctx) => ctx.storage.store(new Blob([""]))),
        fileName: "race.mcap",
      }),
    ).rejects.toThrow(/empty/i);
    await expect(
      t.mutation(internal.sessions.upsert, {
        eventId,
        type: "race",
        storageId,
        fileName: "race.csv",
      }),
    ).rejects.toThrow(/\.mcap/i);
  });

  it("list and get require a signed-in user and return a file url", async () => {
    const t = createTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "a@b.com" }),
    );
    const eventId = await seedEvent(t);
    const otherEventId = await t.run((ctx) =>
      ctx.db.insert("events", {
        name: "Other",
        dateStart: "2026-03-22T04:00:00Z",
      }),
    );
    const storageId = await storeFile(t, "race-bytes");
    const otherFile = await storeFile(t, "other");
    const sessionId = await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "race",
      storageId,
      fileName: "race.mcap",
      startTime: "2026-03-15T05:00:00Z",
      sessionKey: 9467,
    });
    await t.mutation(internal.sessions.upsert, {
      eventId,
      type: "fp1",
      storageId: await storeFile(t, "fp1"),
      fileName: "fp1.mcap",
    });
    await t.mutation(internal.sessions.upsert, {
      eventId: otherEventId,
      type: "race",
      storageId: otherFile,
      fileName: "other.mcap",
    });

    const asUser = t.withIdentity({ subject: userId });
    expect(await t.query(api.sessions.list, { eventId })).toEqual([]);
    expect(await t.query(api.sessions.get, { id: sessionId })).toBeNull();
    expect(
      await asUser.query(api.sessions.list, { eventId: "not-an-id" }),
    ).toEqual([]);

    const rows = await asUser.query(api.sessions.list, { eventId });
    expect(rows.map((row) => row.type)).toEqual(["fp1", "race"]);
    expect(rows[1]).toMatchObject({
      id: sessionId,
      eventId,
      name: "Race",
      fileName: "race.mcap",
      startTime: "2026-03-15T05:00:00Z",
      sessionKey: 9467,
    });
    expect(rows[1]?.url).toEqual(expect.any(String));

    expect(
      await asUser.query(api.sessions.get, { id: "not-an-id" }),
    ).toBeNull();
    expect(
      await asUser.query(api.sessions.get, { id: sessionId }),
    ).toMatchObject({ id: sessionId, fileName: "race.mcap" });
  });
});
