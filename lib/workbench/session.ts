import { getAdapter } from "./adapters";
import { buildLaps, lapsByEntity, withAdvance } from "./derive";
import { Store } from "./store";
import type { Entity, EntityId, Lap, Segment, SessionMeta, WorkerMessage } from "./types";

/** Derived indexes, recomputed on append (cheap at v0 sizes). */
export interface Derived {
  entities: Entity[];
  entityById: Map<EntityId, Entity>;
  segments: Segment[];
  laps: Lap[];
  lapsByEntity: Map<EntityId, Lap[]>;
  /** Reference lap length in metres (max outline distance), if known. */
  lapLength: number | null;
}

export function derive(store: Store, session: SessionMeta): Derived {
  const adapter = getAdapter(session.adapter);
  const entities = adapter.entities(store);
  const parts = adapter.segments?.(store) ?? [];
  const flags = adapter.lapFlags?.(store) ?? [];
  const cls = new Map(entities.map((e) => [e.id, e.class]));
  const laps = buildLaps(store.get("/timing/laps"), parts, flags, (e) => cls.get(e));
  const segments = withAdvance(parts, laps);
  const outline = store.latest<{ distance_m?: number[] }>("/track/outline");
  const lapLength = outline?.distance_m?.length ? Math.max(...outline.distance_m) : null;
  return {
    entities,
    entityById: new Map(entities.map((e) => [e.id, e])),
    segments,
    laps,
    lapsByEntity: lapsByEntity(laps),
    lapLength,
  };
}

/** Apply one worker message to a store. Returns true when data changed. */
export function applyMessage(store: Store, m: WorkerMessage): boolean {
  if (m.type !== "append") return false;
  for (const b of m.rows) store.appendRows(b);
  for (const b of m.streams) store.appendStream(b);
  store.version++;
  return true;
}
