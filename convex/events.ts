import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { sessionTypes } from "./schema";

function splitDateTime(value: string) {
  const offset = value.match(/(?:Z|[+-]\d{2}:\d{2})$/)?.[0];
  return {
    date: value.slice(0, 10),
    time: `${value.slice(11, 19)} ${offset && offset !== "Z" ? `GMT${offset}` : "UTC"}`,
  };
}

async function sessionNames(ctx: QueryCtx, eventId: Id<"events">) {
  const docs = await ctx.db
    .query("sessions")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();
  return docs
    .sort((a, b) => sessionTypes.indexOf(a.type) - sessionTypes.indexOf(b.type))
    .map((doc) => doc.name);
}

async function toLibraryEvent(ctx: QueryCtx, doc: Doc<"events">) {
  const { date, time } = splitDateTime(doc.dateStart);
  return {
    id: String(doc._id),
    name: doc.name,
    dateStart: doc.dateStart,
    startDate: date,
    startTime: time,
    sessions: await sessionNames(ctx, doc._id),
  };
}

function eventName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("Enter an event name.");
  return trimmed;
}

function insertEvent(
  ctx: MutationCtx,
  name: string,
  dateStart: string | undefined,
) {
  return ctx.db.insert("events", {
    name: eventName(name),
    dateStart: dateStart?.trim() || new Date().toISOString(),
  });
}

export const create = mutation({
  args: {
    name: v.string(),
    dateStart: v.optional(v.string()),
  },
  handler: async (ctx, { name, dateStart }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You must be signed in.");
    return await insertEvent(ctx, name, dateStart);
  },
});

export const upsert = internalMutation({
  args: {
    name: v.string(),
    dateStart: v.optional(v.string()),
    id: v.optional(v.id("events")),
  },
  handler: async (ctx, { name, dateStart, id }) => {
    const trimmed = eventName(name);
    const nextDate = dateStart?.trim();
    // shortcut: scan then insert, index by name if two ingestions run at once.
    const events = await ctx.db.query("events").collect();

    if (id) {
      if (!events.some((event) => event._id === id)) {
        throw new ConvexError("Event not found.");
      }
      if (events.some((event) => event._id !== id && event.name === trimmed)) {
        throw new ConvexError("An event with that name already exists.");
      }
      await ctx.db.patch(id, {
        name: trimmed,
        ...(nextDate ? { dateStart: nextDate } : {}),
      });
      return id;
    }

    const existing = events.find((event) => event.name === trimmed);
    if (existing) {
      if (nextDate) await ctx.db.patch(existing._id, { dateStart: nextDate });
      return existing._id;
    }

    return await insertEvent(ctx, trimmed, nextDate);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const docs = await ctx.db.query("events").collect();
    const rows = await Promise.all(docs.map((doc) => toLibraryEvent(ctx, doc)));
    return rows.sort(
      (a, b) => Date.parse(b.dateStart) - Date.parse(a.dateStart),
    );
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const eventId = ctx.db.normalizeId("events", id);
    if (!eventId) return null;

    const doc = await ctx.db.get(eventId);
    if (!doc) return null;
    return await toLibraryEvent(ctx, doc);
  },
});
