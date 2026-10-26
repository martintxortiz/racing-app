import type { Store } from "../store";
import type { Entity, LapFlag, SessionMeta, Segment, TopicKind } from "../types";
import { canonical } from "./canonical";
import { f1OpenF1 } from "./f1";

type Row = Record<string, unknown>;

export interface TopicRule {
  /** Native topic pattern; `{id}` captures the entity id. */
  match: string;
  /** Canonical topic; `{id}` is substituted. */
  to: string;
  schema: string;
  kind: TopicKind;
  /** Stream topics: canonical numeric field <- native message. Return null to drop the sample. */
  stream?: (m: Row) => Record<string, number> | null;
  /** Row topics: canonical row(s) <- native message. Snapshot messages with `rows` may expand. */
  rows?: (m: Row) => Row[];
}

/** Declarative map from native topics to canonical ones, plus derive hooks. Panels never import adapters. */
export interface Adapter {
  id: string;
  detect(meta: Record<string, string>, topics: string[]): boolean;
  topics: TopicRule[];
  /** Native topic globs skipped before JSON.parse. */
  skip: string[];
  /** Session header from the native info message (or metadata strings). */
  session(info: Row): Omit<SessionMeta, "topics" | "notes" | "adapter" | "startNs" | "window" | "session"> & {
    startNs: bigint;
    endNs: bigint;
  };
  entities(store: Store): Entity[];
  segments?(store: Store): Segment[];
  lapFlags?(store: Store): LapFlag[];
}

export const adapters: Adapter[] = [f1OpenF1, canonical];

export function getAdapter(id: string): Adapter {
  const a = adapters.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown adapter ${id}`);
  return a;
}

export function detectAdapter(meta: Record<string, string>, topics: string[]): Adapter | null {
  return adapters.find((a) => a.detect(meta, topics)) ?? null;
}

const ruleRegex = new Map<string, RegExp>();
function regexFor(pattern: string) {
  let re = ruleRegex.get(pattern);
  if (!re) {
    const src = pattern.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace("\\{id\\}", "([^/]+)").replace("{id}", "([^/]+)");
    re = new RegExp(`^${src}$`);
    ruleRegex.set(pattern, re);
  }
  return re;
}

export function globMatch(glob: string, topic: string) {
  if (glob.endsWith("*")) return topic.startsWith(glob.slice(0, -1));
  return glob === topic;
}

export interface ResolvedTopic {
  rule: TopicRule;
  canonical: string;
  entity?: string;
}

/** Map a native topic to its canonical topic, or null when the adapter has no rule. */
export function resolveTopic(adapter: Adapter, native: string): ResolvedTopic | null {
  for (const rule of adapter.topics) {
    const m = regexFor(rule.match).exec(native);
    if (!m) continue;
    const entity = m[1];
    return { rule, canonical: entity ? rule.to.replace("{id}", entity) : rule.to, entity };
  }
  return null;
}
