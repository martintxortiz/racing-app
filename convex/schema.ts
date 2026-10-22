import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const sessionTypes = [
  "fp1",
  "fp2",
  "fp3",
  "sprint_qualifying",
  "sprint",
  "qualifying",
  "race",
] as const;

export const sessionType = v.union(
  v.literal("fp1"),
  v.literal("fp2"),
  v.literal("fp3"),
  v.literal("sprint_qualifying"),
  v.literal("sprint"),
  v.literal("qualifying"),
  v.literal("race"),
);

export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_username", ["username"]),
  googleLinkRequests: defineTable({
    userId: v.id("users"),
    sessionId: v.id("authSessions"),
    requestedAt: v.number(),
  }).index("by_session", ["sessionId"]),
  events: defineTable({
    name: v.string(),
    dateStart: v.string(),
  }),
  sessions: defineTable({
    eventId: v.id("events"),
    type: sessionType,
    name: v.string(),
    startTime: v.optional(v.string()),
    storageId: v.id("_storage"),
    fileName: v.string(),
    size: v.number(),
    sessionKey: v.optional(v.number()),
  }).index("by_event", ["eventId"]),
});
