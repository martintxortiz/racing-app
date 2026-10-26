"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { PanelState } from "@/lib/workbench/layout";
import { panelEntities } from "@/lib/workbench/selection";
import type { EntityId, Sec } from "@/lib/workbench/types";
import { chipStyle } from "../colors";
import { useWB, type MenuItem } from "../state";

export interface PanelProps {
  id: string;
  panel: PanelState;
  setConfig: (patch: Record<string, unknown>) => void;
}

export interface Slot {
  /** Accepted schemas; "kind:event" accepts any topic of that kind. */
  schemas: string[];
  required: boolean;
  default: string;
  /** Entity topics: offer {A}, {B}, * and pinned ids. */
  pattern?: boolean;
}

export interface SettingDef {
  key: string;
  label: string;
  options: { value: unknown; label: string }[];
}

/** What a panel's own menu builder gets. Read live state from `useWB.getState()`. */
export interface PanelMenuCtx {
  id: string;
  panel: PanelState;
  setConfig: (patch: Record<string, unknown>) => void;
}

export interface PanelDef {
  type: string;
  title: string;
  description: string;
  icon: string;
  slots: Record<string, Slot>;
  /** Slot shown as the header topic chip. */
  primary: string;
  defaultConfig: Record<string, unknown>;
  /** Simple radio settings, shown as submenus in the panel menu. */
  settings?: SettingDef[];
  /** Extra panel-specific menu items (shown after local items, before the generic ones). */
  menu?: (ctx: PanelMenuCtx) => MenuItem[];
  /** The panel shows a set of entities chosen with config.drivers ("selection" | "field" | ids). */
  entities?: "selection" | "field";
  /** Topic names (exact or patterns) the widget needs, for dimming in the picker. */
  needs?: string[];
  Component: (p: PanelProps) => React.ReactNode;
}

/** The panel header's readout area; panels portal live readouts into it. */
export const HeaderSlot = createContext<HTMLElement | null>(null);

export function Readout({ children }: { children: React.ReactNode }) {
  const el = useContext(HeaderSlot);
  return el ? createPortal(children, el) : null;
}

/** Cursor time, throttled to `hz` while playing or scrubbing; immediate at rest. */
export function useThrottledT(hz = 10): Sec {
  const [t, setT] = useState(() => useWB.getState().t);
  useEffect(() => {
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      last = performance.now();
      setT(useWB.getState().t);
    };
    const unsub = useWB.subscribe((s, prev) => {
      if (s.t === prev.t) return;
      clearTimeout(timer);
      const wait = 1000 / hz - (performance.now() - last);
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [hz]);
  return t;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="pw-empty">
      <div className="pw-empty__title">{title}</div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="wb-skeleton" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ width: `${60 + ((i * 37) % 35)}%` }} />
      ))}
    </div>
  );
}

/** Loading / missing-topic states shared by panels. Returns null when the topic has data. */
export function useTopicState(topic: string | null): "loading" | "missing" | "ready" {
  const status = useWB((s) => s.status);
  const version = useWB((s) => s.version);
  const store = useWB((s) => s.store);
  const session = useWB((s) => s.session);
  void version;
  if (!topic) return "missing";
  if (store.get(topic)?.length) return "ready";
  const known = session?.topics.some((x) => x.name === topic);
  if (status === "loading" && (known || !session)) return "loading";
  return "missing";
}

/** Entities a panel shows, following its `drivers` config and the shared selection. */
export function usePanelEntities(config: Record<string, unknown>, fallback: "selection" | "field"): EntityId[] {
  const sel = useWB((s) => s.sel);
  const entities = useWB((s) => s.derived?.entities);
  const drivers = config.drivers;
  return useMemo(
    () => panelEntities({ drivers }, sel, (entities ?? []).map((e) => e.id), fallback),
    [drivers, sel, entities, fallback],
  );
}

/** Team colour chip around a driver code: the one place a table shows team colour. */
export function Chip({ code, colour, title }: { code: React.ReactNode; colour?: string; title?: string }) {
  return (
    <span className="wb-chip" style={chipStyle(colour)} title={title}>
      {code}
    </span>
  );
}

/** Width of an element in px, tracked with a ResizeObserver (0 until measured). */
export function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    // The observer reports the first size right after observe().
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}
