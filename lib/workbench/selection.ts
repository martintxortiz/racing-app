// Workspace selection: a focused entity, an ordered comparison set, an optional reference,
// hidden entities and per-entity lap picks. Replaces the old fixed A/B pair; any number of
// entities can be compared. Pure functions so menus and keys share one tested behaviour.

import type { EntityId, LapRef } from "./types";

export interface Selection {
  /** The entity panels centre on. Always a member of `compare` when set. */
  focus: EntityId | null;
  /** Entities compared in charts, in the order they were added (this order picks colours). */
  compare: EntityId[];
  /** Delta baseline. null = the focused entity. */
  reference: EntityId | null;
  /** Entities left out of field-wide panels. */
  hidden: EntityId[];
  /** Lap each entity shows in lap-based panels; missing = best. */
  laps: Record<EntityId, LapRef>;
}

export const MAX_COMPARE = 8;

export const emptySelection = (): Selection => ({ focus: null, compare: [], reference: null, hidden: [], laps: {} });

/** Focus an entity. A new entity takes the focused entity's place in the comparison. */
export function focus(s: Selection, e: EntityId): Selection {
  if (s.compare.includes(e)) return { ...s, focus: e };
  const compare = [...s.compare];
  const i = s.focus ? compare.indexOf(s.focus) : -1;
  if (i >= 0) compare[i] = e;
  else compare.unshift(e);
  const reference = s.reference === s.focus ? null : s.reference;
  return { ...s, focus: e, compare: compare.slice(0, MAX_COMPARE), reference };
}

/** Add to or remove from the comparison (Shift+click). */
export function toggleCompare(s: Selection, e: EntityId): Selection {
  return s.compare.includes(e) ? removeCompare(s, e) : addCompare(s, e);
}

export function addCompare(s: Selection, e: EntityId): Selection {
  if (s.compare.includes(e)) return s;
  const compare = [...s.compare, e].slice(-MAX_COMPARE);
  return { ...s, compare, focus: s.focus && compare.includes(s.focus) ? s.focus : compare[0] };
}

export function removeCompare(s: Selection, e: EntityId): Selection {
  const compare = s.compare.filter((x) => x !== e);
  return {
    ...s,
    compare,
    focus: s.focus === e ? (compare[0] ?? null) : s.focus,
    reference: s.reference === e ? null : s.reference,
  };
}

/** Compare only this entity. */
export function isolate(s: Selection, e: EntityId): Selection {
  return { ...s, compare: [e], focus: e, reference: null };
}

/** Use an entity as the delta baseline; it joins the comparison. */
export function setReference(s: Selection, e: EntityId | null): Selection {
  if (e === null) return { ...s, reference: null };
  const next = addCompare(s, e);
  return { ...next, reference: e };
}

/** The entity deltas are measured against. */
export const referenceOf = (s: Selection): EntityId | null => s.reference ?? s.focus ?? s.compare[0] ?? null;

/** Move focus through the comparison (X key). */
export function cycleFocus(s: Selection, dir: 1 | -1 = 1): Selection {
  if (s.compare.length < 2) return s;
  const i = s.focus ? s.compare.indexOf(s.focus) : -1;
  return { ...s, focus: s.compare[(i + dir + s.compare.length) % s.compare.length] };
}

export function toggleHidden(s: Selection, e: EntityId): Selection {
  return s.hidden.includes(e) ? { ...s, hidden: s.hidden.filter((x) => x !== e) } : { ...s, hidden: [...s.hidden, e] };
}

export function setLap(s: Selection, e: EntityId, ref: LapRef): Selection {
  const laps = { ...s.laps };
  if (ref === "best") delete laps[e];
  else laps[e] = ref;
  return { ...s, laps };
}

export const lapOf = (s: Selection, e: EntityId): LapRef => s.laps[e] ?? "best";

/** Keep only ids the session knows (after loading a new session or a stale URL). */
export function sanitize(s: Selection, known: Set<EntityId>): Selection {
  const compare = s.compare.filter((e) => known.has(e));
  return {
    focus: s.focus && compare.includes(s.focus) ? s.focus : (compare[0] ?? null),
    compare,
    reference: s.reference && compare.includes(s.reference) ? s.reference : null,
    hidden: s.hidden.filter((e) => known.has(e)),
    laps: Object.fromEntries(Object.entries(s.laps).filter(([e]) => known.has(e))),
  };
}

/**
 * Entities a panel shows. Panels follow the workspace selection by default; a panel can show
 * the whole field or pin its own list in `config.drivers`.
 */
export function panelEntities(
  config: Record<string, unknown>,
  s: Selection,
  field: EntityId[],
  fallback: "selection" | "field" = "selection",
): EntityId[] {
  const d = config.drivers ?? fallback;
  if (Array.isArray(d)) return d.filter((e): e is string => typeof e === "string" && field.includes(e));
  if (d === "field") return field.filter((e) => !s.hidden.includes(e));
  return s.compare.filter((e) => field.includes(e));
}

/** Colour slot (0-based) of an entity in the comparison, or -1. */
export const slotOf = (s: Selection, e: EntityId): number => s.compare.indexOf(e);

/** Encode / decode the selection for the URL: sel=1,16&focus=1&ref=16. */
export function toQuery(s: Selection): Record<string, string | null> {
  return {
    sel: s.compare.length ? s.compare.join(",") : null,
    focus: s.focus && s.focus !== s.compare[0] ? s.focus : null,
    ref: s.reference,
  };
}

export function fromQuery(q: { sel?: string; focus?: string; ref?: string; a?: string; b?: string }): Selection | null {
  const compare = q.sel ? q.sel.split(",").filter(Boolean) : [q.a, q.b].filter((x): x is string => !!x);
  if (!compare.length) return null;
  return {
    ...emptySelection(),
    compare,
    focus: q.focus && compare.includes(q.focus) ? q.focus : compare[0],
    reference: q.ref && compare.includes(q.ref) ? q.ref : null,
  };
}
