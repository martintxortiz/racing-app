// Generic workbench model (spec: "Core concepts and data model").
// Nothing in here is F1-specific; adapters map native topics onto it.

export type EntityId = string;
/** Seconds relative to session.startNs (float64). */
export type Sec = number;

export type TopicKind = "static" | "snapshot" | "stream" | "event";

export interface TopicInfo {
  name: string;
  schema: string;
  kind: TopicKind;
  entity?: EntityId;
  count: number;
  rateHz?: number;
}

export interface Entity {
  id: EntityId;
  number?: number;
  code: string;
  name: string;
  team?: string;
  /** Class or category in multi-class sessions (LMH, LMP2, GT3 …). */
  class?: string;
  colour: string;
}

export interface SessionMeta {
  title: string;
  series: string;
  event: string;
  venue: string;
  kind: "practice" | "qualifying" | "race" | "test";
  /** ns since epoch, as a decimal string (bigint is not structured-clone friendly everywhere). */
  startNs: string;
  /** Scrub window in Sec: session start − 5 min … end + 10 min. */
  window: [Sec, Sec];
  /** Official session start/end in Sec. */
  session: [Sec, Sec];
  /** Track local offset from UTC in seconds. */
  utcOffsetSec: number;
  adapter: string;
  topics: TopicInfo[];
  notes: string[];
}

export interface Segment {
  id: string;
  t0: Sec;
  t1: Sec | null;
  /** Entities that go through to the next part (knockout formats), when the data shows it. */
  advance?: number;
}

export interface Lap {
  entity: EntityId;
  n: number;
  t0: Sec;
  t1: Sec | null;
  time: Sec | null;
  /** Sector times in order; as many as the feed publishes (sector_1_s … sector_n_s). */
  sectors: (Sec | null)[];
  outLap: boolean;
  /** Driver in the car for this lap, when the feed names one (driver swaps). */
  driver?: string;
  deleted: boolean;
  deletedReason?: string;
  segment: string | null;
  timed: boolean;
  /** Lap that ends in the pit lane (the next lap is an out lap). */
  inLap?: boolean;
  /** Speed traps and intermediates the feed publishes per lap (`*_kph` fields). */
  speeds?: Record<string, number>;
}

export type LapRef = "best" | "last" | "cursor" | { n: number };


export interface Cursor {
  t: Sec;
  playing: boolean;
  speed: number;
}

/** Messages a stream topic keeps as typed columns; everything else keeps rows. */
export interface StreamBatch {
  topic: string;
  t: Float64Array;
  cols: Record<string, Float32Array>;
}

export interface RowBatch {
  topic: string;
  t: Float64Array;
  rows: Record<string, unknown>[];
}

export type WorkerRequest =
  | { type: "open"; source: { kind: "url"; url: string } | { kind: "file"; file: File } };

export type WorkerMessage =
  | { type: "summary"; session: SessionMeta }
  | { type: "progress"; bytes: number; total: number; phase: string }
  | { type: "append"; streams: StreamBatch[]; rows: RowBatch[] }
  | { type: "done"; ms: number }
  | { type: "error"; message: string };

/** A lap deletion parsed from race control. Matched by lap time, then offence time, then lap number. */
export interface LapFlag {
  entity: EntityId;
  reason: string;
  time?: number;
  at?: Sec;
  lap?: number;
}
