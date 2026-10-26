// Column configuration for table widgets: visibility, order and sort, persisted in panel config.

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Show or hide a column; keeps at least one visible. New columns go after their neighbours in `all`. */
export function toggleColumn(cols: string[], key: string, all: string[]): string[] {
  if (cols.includes(key)) return cols.length > 1 ? cols.filter((c) => c !== key) : cols;
  const at = all.indexOf(key);
  // Insert after the last visible column that comes before it in the canonical order.
  let idx = 0;
  cols.forEach((c, i) => {
    if (all.indexOf(c) < at) idx = i + 1;
  });
  return [...cols.slice(0, idx), key, ...cols.slice(idx)];
}

/** Move a visible column one step left or right. */
export function moveColumn(cols: string[], key: string, dir: -1 | 1): string[] {
  const i = cols.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return cols;
  const next = [...cols];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Move a column to sit before `before` (drag and drop in the header). */
export function placeColumn(cols: string[], key: string, before: string | null): string[] {
  const rest = cols.filter((c) => c !== key);
  const i = before === null ? rest.length : rest.indexOf(before);
  return [...rest.slice(0, i < 0 ? rest.length : i), key, ...rest.slice(i < 0 ? rest.length : i)];
}

/** Header click: none → asc → desc → none. Lap times sort fastest first on the first click. */
export function nextSort(cur: SortState | null, key: string): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: "asc" };
  if (cur.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Stable sort by a key extractor; nulls last regardless of direction. */
export function sortBy<T>(rows: T[], get: (r: T) => number | string | null, dir: SortDir): T[] {
  const s = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c * s || a.i - b.i;
    })
    .map((x) => x.r);
}

export interface FitColumn {
  key: string;
  /** Minimum width in px, padding included. */
  width: number;
  /** Lower keeps the column longer when the panel is narrow. */
  priority: number;
}

/**
 * Columns that fit in `avail` px: drop the least important first, keep the configured order.
 * The first column is always kept. `avail` of 0 (not measured yet) keeps everything.
 */
export function fitColumns<T extends FitColumn>(cols: T[], avail: number): { shown: T[]; hidden: T[] } {
  if (!(avail > 0)) return { shown: cols, hidden: [] };
  const keep = new Set(cols);
  let total = cols.reduce((s, c) => s + c.width, 0);
  const byDrop = cols
    .map((c, i) => ({ c, i }))
    .slice(1)
    .sort((a, b) => b.c.priority - a.c.priority || b.i - a.i);
  for (const { c } of byDrop) {
    if (total <= avail) break;
    keep.delete(c);
    total -= c.width;
  }
  return { shown: cols.filter((c) => keep.has(c)), hidden: cols.filter((c) => !keep.has(c)) };
}
