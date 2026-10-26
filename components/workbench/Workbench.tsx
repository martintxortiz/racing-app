"use client";

import { useTheme } from "next-themes";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { emptySelection, fromQuery, sanitize, toQuery } from "@/lib/workbench/selection";
import { applyMessage } from "@/lib/workbench/session";
import type { WorkerMessage, WorkerRequest } from "@/lib/workbench/types";
import { ContextMenu } from "./ContextMenu";
import { PanelPicker } from "./PanelPicker";
import { lastLayout, saveLast, saveLayout } from "./persist";
import { TabBody } from "./Tiles";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import {
  clearComparison,
  closeMenu,
  cycleFocus,
  loadLayout,
  notify,
  openPicker,
  refreshDerived,
  resetData,
  setT,
  stepLap,
  stepSpeed,
  toggleMaximize,
  togglePlay,
  useWB,
} from "./state";
import "./pitwall.css";
import "./workbench.css";

export type Source = { kind: "url"; url: string } | { kind: "file"; file: File };

export interface UrlState {
  t?: number;
  /** Comparison: sel=1,16 (legacy a/b still read). */
  sel?: string;
  focus?: string;
  ref?: string;
  a?: string;
  b?: string;
  tab?: string;
  layout?: string;
  theme?: "light" | "dark";
}

/** Loads one recording into the store, drives playback, keys, URL and layout persistence. */
export function Workbench({
  source,
  initial,
  onPickFile,
  missing,
}: {
  source: Source | null;
  initial: UrlState;
  onPickFile?: (f: File) => void;
  /** Shown instead of the file prompt when a library session cannot be opened. */
  missing?: string;
}) {
  const status = useWB((s) => s.status);
  const error = useWB((s) => s.error);
  const progress = useWB((s) => s.progress);
  const activeTab = useWB((s) => s.activeTab);
  const { resolvedTheme, setTheme } = useTheme();
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // ?theme= wins until the user toggles; after that next-themes is the only source.
  const [themeOverride, setThemeOverride] = useState(initial.theme);
  const shownTheme = (themeOverride ?? resolvedTheme ?? "light") === "dark" ? "dark" : "light";

  // Theme: next-themes owns the app theme; ?theme= overrides once. Palette reads CSS vars after commit.
  const themeApplied = useRef(false);
  useEffect(() => {
    // setTheme's identity changes with the theme, so guard to apply ?theme= exactly once.
    if (initial.theme && !themeApplied.current) setTheme(initial.theme);
    themeApplied.current = true;
  }, [initial.theme, setTheme]);
  useLayoutEffect(() => {
    if (useWB.getState().theme !== shownTheme) useWB.setState({ theme: shownTheme });
  }, [shownTheme]);
  useEffect(() => {
    const h = (e: Event) => {
      setThemeOverride(undefined);
      setTheme((e as CustomEvent<string>).detail);
    };
    window.addEventListener("wb:theme", h);
    return () => window.removeEventListener("wb:theme", h);
  }, [setTheme]);

  // Layout: last working copy, or the default.
  useEffect(() => {
    const l = lastLayout();
    if (l) loadLayout(l, true);
    if (initial.tab && useWB.getState().layout.tabs.some((t) => t.id === initial.tab)) useWB.setState({ activeTab: initial.tab });
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useWB.subscribe((s, prev) => {
      if (s.layout === prev.layout) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveLast(useWB.getState().layout), 300);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data: one worker per source.
  useEffect(() => {
    if (!source) return;
    resetData(null);
    useWB.setState({ status: "loading", progress: { bytes: 0, total: 0, phase: "Opening" } });
    const worker = new Worker(new URL("../../lib/workbench/decode.worker.ts", import.meta.url), { type: "module" });
    let lastDerive = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const derive = () => {
      lastDerive = performance.now();
      refreshDerived();
    };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      const st = useWB.getState();
      switch (m.type) {
        case "summary":
          resetData(m.session);
          useWB.setState({ t: initial.t ?? m.session.window[1] });
          setT(initial.t ?? m.session.window[1]);
          break;
        case "progress":
          useWB.setState({ progress: { bytes: m.bytes, total: m.total, phase: m.phase } });
          break;
        case "append":
          applyMessage(st.store, m);
          clearTimeout(pending);
          if (performance.now() - lastDerive > 400) derive();
          else pending = setTimeout(derive, 400);
          break;
        case "done": {
          clearTimeout(pending);
          refreshDerived();
          const s = useWB.getState();
          // Default comparison: the first two of the final order (classification / results / entity
          // order), so it works for any series and session type. The URL wins when it names known ids.
          const ids = (s.derived?.entities ?? []).map((e) => e.id);
          const finalOrder = [...(s.store.get("/results/session")?.rows ?? []), ...(s.store.get("/timing/classification")?.rows ?? [])]
            .filter((r) => r.position != null)
            .sort((x, y) => Number(x.position) - Number(y.position))
            .map((r) => String(r.entity))
            .filter((e, k, a) => a.indexOf(e) === k && ids.includes(e));
          const order = [...finalOrder, ...ids.filter((e) => !finalOrder.includes(e))];
          const fromUrl = fromQuery(initial);
          const sel = fromUrl ? sanitize(fromUrl, new Set(ids)) : null;
          const fallback = { ...emptySelection(), compare: order.slice(0, 2), focus: order[0] ?? null };
          useWB.setState({ status: "ready", progress: null, sel: sel && sel.compare.length ? sel : fallback });
          break;
        }
        case "error":
          useWB.setState({ status: "error", error: m.message, progress: null });
          break;
      }
    };
    worker.onerror = (e) => useWB.setState({ status: "error", error: e.message || "The decoder crashed." });
    worker.postMessage({ type: "open", source } satisfies WorkerRequest);
    return () => {
      clearTimeout(pending);
      worker.terminate();
      useWB.setState({ playing: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // "Open .mcap file…" from the top bar.
  useEffect(() => {
    if (!onPickFile) return;
    const h = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mcap";
      input.onchange = () => input.files?.[0] && onPickFile(input.files[0]);
      input.click();
    };
    window.addEventListener("wb:pick-file", h);
    return () => window.removeEventListener("wb:pick-file", h);
  }, [onPickFile]);

  // Playback.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const s = useWB.getState();
      if (s.playing && s.session) {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
        const next = s.t + dt * s.speed;
        if (next >= s.session.window[1]) useWB.setState({ t: s.session.window[1], playing: false });
        else useWB.setState({ t: next });
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // URL: ?tab&t&a&b&layout, at most 2 Hz.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = () => {
      timer = undefined;
      const s = useWB.getState();
      if (!s.session) return;
      const u = new URL(window.location.href);
      u.searchParams.set("t", s.t.toFixed(1));
      u.searchParams.delete("a");
      u.searchParams.delete("b");
      const q = toQuery(s.sel);
      for (const [k, v] of [["sel", q.sel], ["focus", q.focus], ["ref", q.ref], ["tab", s.activeTab], ["layout", s.layout.id]] as const) {
        if (v) u.searchParams.set(k, v);
        else u.searchParams.delete(k);
      }
      window.history.replaceState(window.history.state, "", u);
    };
    const unsub = useWB.subscribe((s, p) => {
      if (s.t === p.t && s.sel === p.sel && s.activeTab === p.activeTab && s.layout.id === p.layout.id) return;
      timer ??= setTimeout(write, 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // Keyboard (spec "Linking and shortcuts").
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]")) return;
      const s = useWB.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveLayout();
        notify(`Saved “${useWB.getState().layout.name}”`);
        return;
      }
      if (mod || e.altKey) return;
      if (s.picker) return;
      const segs = s.derived?.segments ?? [];
      const handled = () => e.preventDefault();
      switch (e.key) {
        case " ":
          handled();
          togglePlay();
          break;
        case "ArrowLeft":
        case "ArrowRight":
          handled();
          setT(s.t + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
          break;
        case "[":
          stepLap(-1);
          break;
        case "]":
          stepLap(1);
          break;
        case "-":
          stepSpeed(-1);
          break;
        case "=":
        case "+":
          stepSpeed(1);
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9": {
          const seg = segs[Number(e.key) - 1];
          if (seg) setT(seg.t0);
          break;
        }
        case "Home":
          handled();
          if (s.session) setT(s.session.window[0]);
          break;
        case "End":
          handled();
          if (s.session) setT(s.session.window[1]);
          break;
        case "x":
        case "X":
          cycleFocus(e.shiftKey ? -1 : 1);
          break;
        case "Escape":
          if (s.menu) closeMenu();
          else if (s.maximized) toggleMaximize(null);
          else clearComparison();
          break;
        case "p":
        case "P": {
          handled();
          const focused = s.focused && s.layout.panels[s.focused] ? s.focused : null;
          openPicker(focused ? { kind: "split", panel: focused, edge: "right" } : { kind: "tab", tab: s.activeTab });
          break;
        }
        case "f":
        case "F":
          if (s.focused) toggleMaximize(s.focused);
          break;
        case "\\":
          window.dispatchEvent(new CustomEvent("wb:theme", { detail: s.theme === "dark" ? "light" : "dark" }));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pct = progress && progress.total ? Math.round((progress.bytes / progress.total) * 100) : null;

  return (
    <div
      ref={root}
      className="wb"
      data-theme={shownTheme}
      data-status={status}
      onDragOver={(e) => {
        if (!onPickFile || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        const f = e.dataTransfer.files[0];
        if (!onPickFile || !f) return;
        e.preventDefault();
        setDragging(false);
        onPickFile(f);
      }}
    >
      <TopBar />
      <div className="wb-progress" aria-hidden={status !== "loading"}>
        {status === "loading" ? <span style={{ width: `${pct ?? 15}%` }} className={pct === null ? "is-indeterminate" : undefined} /> : null}
      </div>
      <main className="wb-main">
        {status === "error" ? (
          <div className="pw-empty">
            <div className="pw-empty__title">Could not open this recording</div>
            <div>{error}</div>
          </div>
        ) : !source ? (
          <div className="pw-empty">
            <div className="pw-empty__title">{missing ? "Session unavailable" : "Open an MCAP recording"}</div>
            <div>{missing ? `${missing} You can also drop a .mcap file here.` : "Drop a .mcap file here, or choose one."}</div>
            <label className="pw-btn pw-btn--sm">
              <span className="pw-icon pw-icon--upload" /> Choose file
              <input type="file" accept=".mcap" hidden onChange={(e) => e.target.files?.[0] && onPickFile?.(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <TabBody key={activeTab} tab={activeTab} />
        )}
        {status === "loading" && progress ? (
          <div className="wb-loading pw-num">
            {progress.phase}
            {pct !== null ? ` ${pct}%` : "…"} · {(progress.bytes / 1e6).toFixed(0)} MB
          </div>
        ) : null}
      </main>
      <Timeline />
      <ContextMenu />
      <PanelPicker />
      <Prompt />
      <Notice />
      {dragging ? <div className="wb-dropfile">Drop to open</div> : null}
    </div>
  );
}

function Prompt() {
  const prompt = useWB((s) => s.prompt);
  if (!prompt) return null;
  const close = () => useWB.setState({ prompt: null });
  return (
    <div className="wb-modal" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="wb-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("v") ?? "").trim();
          if (v) prompt.onSubmit(v);
          close();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") close();
        }}
      >
        <label className="pw-field">
          {prompt.title}
          <input name="v" className="pw-input" autoFocus defaultValue={prompt.value} onFocus={(e) => e.target.select()} />
        </label>
        <div className="pw-row">
          <span className="pw-spacer" />
          <button type="button" className="pw-btn pw-btn--sm pw-btn--ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="pw-btn pw-btn--sm pw-btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function Notice() {
  const notice = useWB((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useWB.setState({ notice: null }), notice.kind === "error" ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="pw-toast-region">
      <div className={`pw-toast pw-toast--${notice.kind === "error" ? "error" : "info"}`} role="status">
        <span className={`pw-icon pw-icon--${notice.kind === "error" ? "error-filled" : "information-filled"}`} />
        <div className="pw-toast__body">{notice.text}</div>
      </div>
    </div>
  );
}
