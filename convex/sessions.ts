import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { sessionType, sessionTypes } from "./schema";

type SessionType = (typeof sessionTypes)[number];

const sessionLabels: Record<SessionType, string> = {
  fp1: "FP1",
  fp2: "FP2",
  fp3: "FP3",
  sprint_qualifying: "Sprint Qualifying",
  sprint: "Sprint",
  qualifying: "Qualifying",
  race: "Race",
};

async function toSession(ctx: QueryCtx, doc: Doc<"sessions">) {
  return {
    id: String(doc._id),
    eventId: String(doc.eventId),
    type: doc.type,
    name: doc.name,
    startTime: doc.startTime ?? null,
    fileName: doc.fileName,
    size: doc.size,
    sessionKey: doc.sessionKey ?? null,
    url: await ctx.storage.getUrl(doc.storageId),
  };
}

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const upsert = internalMutation({
  args: {
    eventId: v.id("events"),
    type: sessionType,
    storageId: v.id("_storage"),
    fileName: v.string(),
    name: v.optional(v.string()),
    startTime: v.optional(v.string()),
    sessionKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const fileName = args.fileName.trim();
    if (!fileName) throw new ConvexError("Enter a file name.");
    if (!fileName.toLowerCase().endsWith(".mcap")) {
      throw new ConvexError("File must be a .mcap.");
    }

    const name =
      args.name === undefined ? sessionLabels[args.type] : args.name.trim();
    if (!name) throw new ConvexError("Enter a session name.");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Event not found.");

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) throw new ConvexError("Uploaded file not found.");
    if (metadata.size <= 0) throw new ConvexError("Uploaded file is empty.");

    const startTime = args.startTime?.trim();
    const doc = {
      eventId: args.eventId,
      type: args.type,
      name,
      storageId: args.storageId,
      fileName,
      size: metadata.size,
      ...(startTime ? { startTime } : {}),
      ...(args.sessionKey !== undefined ? { sessionKey: args.sessionKey } : {}),
    };

    // shortcut: lookup then insert, a unique index if two ingestions run at once.
    const existing = (
      await ctx.db
        .query("sessions")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .collect()
    ).find((session) => session.type === args.type);

    if (!existing) return await ctx.db.insert("sessions", doc);

    await ctx.db.replace(existing._id, doc);
    if (existing.storageId !== args.storageId) {
      await ctx.storage.delete(existing.storageId);
    }
    return existing._id;
  },
});

export const list = query({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const id = ctx.db.normalizeId("events", eventId);
    if (!id) return [];

    const docs = await ctx.db
      .query("sessions")
      .withIndex("by_event", (q) => q.eq("eventId", id))
      .collect();
    docs.sort(
      (a, b) => sessionTypes.indexOf(a.type) - sessionTypes.indexOf(b.type),
    );
    return await Promise.all(docs.map((doc) => toSession(ctx, doc)));
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const sessionId = ctx.db.normalizeId("sessions", id);
    if (!sessionId) return null;

    const doc = await ctx.db.get(sessionId);
    if (!doc) return null;
    return await toSession(ctx, doc);
  },
});
