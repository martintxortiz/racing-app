import { McapIndexedReader } from "@mcap/core";
import type { IReadable } from "@mcap/core";
import { decompress } from "fzstd";

import { detectAdapter, globMatch, resolveTopic, type ResolvedTopic } from "./adapters";
import type { RowBatch, SessionMeta, StreamBatch, TopicInfo, WorkerMessage } from "./types";

const NS = BigInt(1e9);
const decompressHandlers = {
  zstd: (data: Uint8Array, size: bigint) => decompress(data, new Uint8Array(Number(size))),
};

export function bufferReadable(buf: Uint8Array): IReadable {
  return {
    size: async () => BigInt(buf.byteLength),
    read: async (offset, length) => buf.subarray(Number(offset), Number(offset + length)),
  };
}

export function blobReadable(blob: Blob): IReadable {
  return {
    size: async () => BigInt(blob.size),
    read: async (offset, length) =>
      new Uint8Array(await blob.slice(Number(offset), Number(offset + length)).arrayBuffer()),
  };
}

interface Acc {
  topic: string;
  stream: boolean;
  t: number[];
  cols: Record<string, number[]>;
  rows: Record<string, unknown>[];
}

/**
 * One pass over an indexed MCAP: summary first, then static/snapshot topics, then
 * everything else in time order, posted as transferable batches every ~50 ms.
 */
export async function decodeMcap(
  readable: IReadable,
  post: (m: WorkerMessage, transfer?: Transferable[]) => void,
  opts: { batchMs?: number } = {},
) {
  const started = Date.now();
  const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

  const meta: Record<string, string> = {};
  for await (const m of reader.readMetadata({ name: "session" })) {
    for (const [k, v] of m.metadata) meta[k] = v;
  }
  const gaps: string[] = [];
  for await (const m of reader.readMetadata({ name: "gaps" })) {
    for (const [, v] of m.metadata) {
      try {
        const parsed = JSON.parse(v) as Array<Record<string, unknown>>;
        for (const g of Array.isArray(parsed) ? parsed : [parsed]) {
          gaps.push([g.kind, g.item ?? g.field ?? g.table, g.note].filter(Boolean).join(": "));
        }
      } catch {
        gaps.push(v);
      }
    }
  }

  const channels = [...reader.channelsById.values()];
  const adapter = detectAdapter(meta, channels.map((c) => c.topic));
  if (!adapter) throw new Error("No adapter recognises this recording's topics.");

  // Session info: metadata strings when present, else the info message.
  let info: Record<string, unknown> = meta;
  if (!meta.date_start_ns) {
    for await (const m of reader.readMessages({ topics: ["/session/info"], validateCrcs: false })) {
      info = JSON.parse(new TextDecoder().decode(m.data));
    }
  }
  const s = adapter.session(info);
  const startNs = s.startNs;
  const toSec = (ns: bigint) => Number(ns - startNs) / 1e9;
  const sessionEnd = toSec(s.endNs);

  // Published start/end can be off (Singapore 2026 ran 30 min later than its schedule),
  // so widen the window to the chunks that hold timing data (laps finish after the flag).
  let activeStart = 0;
  let activeEnd = sessionEnd;
  const timingIds = new Set(
    channels.filter((c) => resolveTopic(adapter, c.topic)?.rule.schema === "rtc.laps").map((c) => c.id),
  );
  for (const ci of reader.chunkIndexes) {
    if (![...ci.messageIndexOffsets.keys()].some((id) => timingIds.has(id))) continue;
    activeStart = Math.min(activeStart, toSec(ci.messageStartTime));
    activeEnd = Math.max(activeEnd, toSec(ci.messageEndTime));
  }
  const window: [number, number] = [activeStart - 300, activeEnd + 600];

  // Channel plan: canonical name, storage and whether to skip before parse.
  const plan = new Map<number, ResolvedTopic>();
  const counts = reader.statistics?.channelMessageCounts;
  const recStart = reader.statistics?.messageStartTime ?? startNs;
  const recEnd = reader.statistics?.messageEndTime ?? s.endNs;
  const recDur = Math.max(1, Number(recEnd - recStart) / 1e9);
  const topics: TopicInfo[] = [];
  for (const ch of channels) {
    if (adapter.skip.some((g) => globMatch(g, ch.topic))) continue;
    const r = resolveTopic(adapter, ch.topic);
    if (!r) continue;
    plan.set(ch.id, r);
    const count = Number(counts?.get(ch.id) ?? 0);
    topics.push({
      name: r.canonical,
      schema: r.rule.schema,
      kind: r.rule.kind,
      entity: r.entity,
      count,
      rateHz: r.rule.kind === "stream" ? count / recDur : undefined,
    });
  }
  topics.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const session: SessionMeta = {
    title: s.title,
    series: s.series,
    event: s.event,
    venue: s.venue,
    kind: s.kind,
    utcOffsetSec: s.utcOffsetSec,
    startNs: startNs.toString(),
    window,
    session: [0, sessionEnd],
    adapter: adapter.id,
    topics,
    notes: gaps,
  };
  post({ type: "summary", session });

  const accs = new Map<string, Acc>();
  const decoder = new TextDecoder();
  let lastFlush = Date.now();
  const batchMs = opts.batchMs ?? 50;

  const flush = () => {
    const streams: StreamBatch[] = [];
    const rows: RowBatch[] = [];
    const transfer: Transferable[] = [];
    for (const a of accs.values()) {
      if (!a.t.length) continue;
      const t = Float64Array.from(a.t);
      transfer.push(t.buffer);
      if (a.stream) {
        const cols: Record<string, Float32Array> = {};
        for (const [k, v] of Object.entries(a.cols)) {
          cols[k] = Float32Array.from(v);
          transfer.push(cols[k].buffer);
          a.cols[k] = [];
        }
        streams.push({ topic: a.topic, t, cols });
      } else {
        rows.push({ topic: a.topic, t, rows: a.rows });
        a.rows = [];
      }
      a.t = [];
    }
    if (streams.length || rows.length) post({ type: "append", streams, rows }, transfer);
    lastFlush = Date.now();
  };

  const handle = (channelId: number, logTime: bigint, data: Uint8Array) => {
    const r = plan.get(channelId);
    if (!r) return;
    const t = toSec(logTime);
    const isStream = !!r.rule.stream;
    // Streams outside the scrub window are dropped before JSON.parse.
    if (isStream && (t < window[0] || t > window[1])) return;
    const msg = JSON.parse(decoder.decode(data)) as Record<string, unknown>;
    let a = accs.get(r.canonical);
    if (!a) {
      a = { topic: r.canonical, stream: isStream, t: [], cols: {}, rows: [] };
      accs.set(r.canonical, a);
    }
    if (isStream) {
      const v = r.rule.stream!(msg);
      if (!v) return;
      a.t.push(t);
      for (const k in v) (a.cols[k] ??= []).push(v[k]);
    } else {
      for (const row of r.rule.rows ? r.rule.rows(msg) : [msg]) {
        a.t.push(t);
        a.rows.push(row);
      }
    }
  };

  // Pass 1: static and snapshot topics, stamped at session start or end (one chunk each).
  const staticIds = new Set<number>();
  for (const [id, r] of plan) if (r.rule.kind === "static" || r.rule.kind === "snapshot") staticIds.add(id);
  const staticTopics = channels.filter((c) => staticIds.has(c.id)).map((c) => c.topic);
  const seen = new Set<number>();
  for (const at of [startNs, s.endNs]) {
    for await (const m of reader.readMessages({ topics: staticTopics, startTime: at, endTime: at, validateCrcs: false })) {
      if (seen.has(m.channelId)) continue;
      seen.add(m.channelId);
      handle(m.channelId, m.logTime, m.data);
    }
  }
  flush();

  // Pass 2: events from an hour before the start (pre-session notes), streams in the window.
  const rest = channels
    .filter((c) => plan.has(c.id) && !seen.has(c.id))
    .map((c) => c.topic);
  let n = 0;
  for await (const m of reader.readMessages({
    topics: rest,
    startTime: startNs + BigInt(Math.round(window[0] - 3600)) * NS,
    endTime: startNs + BigInt(Math.round(window[1])) * NS,
    validateCrcs: false,
  })) {
    handle(m.channelId, m.logTime, m.data);
    if ((++n & 4095) === 0 && Date.now() - lastFlush > batchMs) flush();
  }
  flush();
  post({ type: "done", ms: Date.now() - started });
}
