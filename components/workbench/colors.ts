"use client";

import { useMemo } from "react";

import { slotOf, type Selection } from "@/lib/workbench/selection";
import type { Entity, EntityId } from "@/lib/workbench/types";
import { useWB } from "./state";

/** Design tokens the charts need, read from CSS so charts follow the theme. */
export interface Palette {
  bg: string;
  chrome: string;
  split: string;
  rule: string;
  text1: string;
  text2: string;
  text3: string;
  grid: string;
  axis: string;
  crosshair: string;
  accent: string;
  a: string;
  b: string;
  /** Comparison slot colours (series-1 … series-10). */
  series: string[];
  purple: string;
  green: string;
  font: string;
  mono: string;
  flag: Record<string, string>;
  tyre: Record<string, string>;
  /** Tooltip surface. */
  inverseBg: string;
  inverseText: string;
  inverseText2: string;
}

const FALLBACK: Palette = {
  bg: "#fff", chrome: "#f6f6f6", split: "#d4d4d4", rule: "#ebebeb", text1: "#161616", text2: "#474747",
  text3: "#666", grid: "#ececec", axis: "#8d8d8d", crosshair: "#393939", accent: "#0f62fe", a: "#0f62fe",
  b: "#eb6200", series: ["#0f62fe", "#eb6200", "#198038", "#8a3ffc", "#d02670", "#007d79", "#b28600", "#6929c4", "#a2191f", "#005d5d"], purple: "#8a3ffc", green: "#198038", font: "IBM Plex Sans", mono: "IBM Plex Mono",
  flag: {}, tyre: {}, inverseBg: "#262626", inverseText: "#f4f4f4", inverseText2: "#c6c6c6",
};

export function readPalette(el: Element | null): Palette {
  if (!el) return FALLBACK;
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--pw-bg"), chrome: v("--pw-chrome"), split: v("--pw-split"), rule: v("--pw-rule"),
    text1: v("--pw-text-1"), text2: v("--pw-text-2"), text3: v("--pw-text-3"),
    grid: v("--pw-grid"), axis: v("--pw-axis"), crosshair: v("--pw-crosshair"), accent: v("--pw-accent"),
    a: v("--pw-series-1"), b: v("--pw-series-2"),
    series: Array.from({ length: 10 }, (_, i) => v(`--pw-series-${i + 1}`) || FALLBACK.series[i]),
    purple: v("--pw-sector-purple"), green: v("--pw-sector-green"),
    font: v("--pw-font"), mono: v("--pw-font-mono"),
    flag: {
      GREEN: v("--pw-flag-green"), YELLOW: v("--pw-flag-yellow"), "DOUBLE YELLOW": v("--pw-flag-yellow"),
      RED: v("--pw-flag-red"), BLUE: v("--pw-flag-blue"), CLEAR: v("--pw-text-3"), CHEQUERED: v("--pw-text-1"),
    },
    tyre: {
      SOFT: v("--pw-tyre-soft"), MEDIUM: v("--pw-tyre-medium"), HARD: v("--pw-tyre-hard"),
      INTERMEDIATE: v("--pw-tyre-inter"), WET: v("--pw-tyre-wet"),
    },
    inverseBg: v("--pw-inverse-bg"), inverseText: v("--pw-inverse-text"), inverseText2: v("--pw-inverse-text-2"),
  };
}

/** Palette for the current theme. */
export function usePalette(): Palette {
  const theme = useWB((s) => s.theme);
  return useMemo(
    () => (typeof document === "undefined" ? FALLBACK : readPalette(document.querySelector(".wb"))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );
}

// ---------- entity colours ----------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

/** Team colour nudged until it has at least 3:1 contrast with the panel background. */
export function readableColour(hex: string, bg: string): string {
  let rgb = hexToRgb(hex);
  const lb = lum(hexToRgb(bg || "#ffffff"));
  const contrast = (c: [number, number, number]) => {
    const l = lum(c);
    return (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05);
  };
  const target = lb > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 20 && contrast(rgb) < 3; i++) {
    rgb = rgb.map((c, k) => c + (target[k] - c) * 0.12) as [number, number, number];
  }
  return toHex(rgb);
}

export interface EntityStyle {
  colour: string;
  /** The teammate with the higher car number: dashed line, hollow dot. */
  second: boolean;
}

export function useEntityStyles(): Map<EntityId, EntityStyle> {
  const entities = useWB((s) => s.derived?.entities);
  const p = usePalette();
  return useMemo(() => entityStyles(entities ?? [], p.bg), [entities, p.bg]);
}

export function entityStyles(entities: Entity[], bg: string): Map<EntityId, EntityStyle> {
  const byTeam = new Map<string, Entity[]>();
  for (const e of entities) {
    const k = e.team ?? e.id;
    byTeam.set(k, [...(byTeam.get(k) ?? []), e]);
  }
  const out = new Map<EntityId, EntityStyle>();
  for (const e of entities) {
    const mates = byTeam.get(e.team ?? e.id) ?? [];
    const lowest = Math.min(...mates.map((m) => m.number ?? Number(m.id)));
    out.set(e.id, {
      colour: readableColour(e.colour || "#888888", bg),
      second: mates.length > 1 && (e.number ?? Number(e.id)) !== lowest,
    });
  }
  return out;
}

export type ColourBy = "team" | "slot";

/**
 * Line colour of an entity in a panel. "slot" uses the comparison slot (1st compared = series-1 …),
 * which keeps teammates apart; "team" uses the readable team colour. Entities outside the
 * comparison fall back to their team colour.
 */
export function colourOf(
  e: EntityId,
  by: ColourBy,
  sel: Selection,
  styles: Map<EntityId, EntityStyle>,
  p: Palette,
): { colour: string; dashed: boolean } {
  const st = styles.get(e);
  if (by === "slot") {
    const k = slotOf(sel, e);
    if (k >= 0) return { colour: p.series[k % p.series.length], dashed: false };
  }
  return { colour: st?.colour ?? p.text3, dashed: by === "team" && !!st?.second };
}

/** Black or white text, whichever reads better on a filled cell of this colour. */
export function onColour(hex: string): string {
  return lum(hexToRgb(hex)) > 0.36 ? "#161616" : "#ffffff";
}

/** Style for a team chip (`.wb-chip`): solid team colour with readable text. */
export function chipStyle(colour: string | undefined): React.CSSProperties {
  const c = colour || "#8d8d8d";
  return { ["--c" as string]: c, ["--fg" as string]: onColour(c) };
}
