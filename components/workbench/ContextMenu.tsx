"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { closeMenu, useWB, type MenuAction, type MenuItem } from "./state";

const isAction = (it: MenuItem): it is MenuAction => "label" in it;
const build = (items: MenuItem[] | (() => MenuItem[])) => (typeof items === "function" ? items() : items);

/**
 * One floating menu for the whole workbench (right-click, ⋯, top bar). Supports nested
 * submenus, checkbox and radio items and keyboard navigation. Items are rebuilt from current
 * state on every change, so toggles stay accurate while the menu is open.
 */
export function ContextMenu() {
  const menu = useWB((s) => s.menu);
  // Re-render on the state menus reflect; the item builders read the store themselves.
  useWB(useShallow((s) => [s.layout, s.sel, s.follow, s.maximized, s.speed, s.theme, s.derived, s.activeTab]));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeMenu();
    };
    const blur = () => closeMenu();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div ref={root} className="wb-menu-root" onContextMenu={(e) => e.preventDefault()}>
      <MenuList key={`${menu.x},${menu.y}`} items={build(menu.items)} x={menu.x} y={menu.y} level={0} autoFocus />
    </div>
  );
}

function MenuList({
  items,
  x,
  y,
  level,
  anchorLeft,
  autoFocus,
  onBack,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  level: number;
  /** Left edge of the parent item, for flipping a submenu to the left. */
  anchorLeft?: number;
  autoFocus?: boolean;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState<{ i: number; rect: DOMRect; focus: boolean } | null>(null);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let nx = x;
    if (nx + r.width > window.innerWidth - 4) nx = anchorLeft !== undefined ? anchorLeft - r.width + 2 : window.innerWidth - r.width - 4;
    setPos({ x: Math.max(4, nx), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y, anchorLeft, items.length]);

  useEffect(() => {
    if (autoFocus && pos) ref.current?.focus({ preventScroll: true });
  }, [autoFocus, pos]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const el = (i: number) => ref.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
  const openSub = (i: number, focus = false) => {
    const r = el(i)?.getBoundingClientRect();
    if (r) setOpen({ i, rect: r, focus });
  };
  const select = (it: MenuAction, i: number, viaKey = false) => {
    if (it.disabled) return;
    if (it.submenu) return openSub(i, viaKey);
    if (it.keepOpen) return it.onSelect?.();
    closeMenu();
    it.onSelect?.();
  };
  const actionable = items.map((it, i) => (isAction(it) && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const step = (d: 1 | -1) => {
    const k = actionable.indexOf(active);
    const next = actionable[(k + d + actionable.length) % actionable.length] ?? -1;
    setActive(next);
    el(next)?.focus({ preventScroll: true });
  };

  const sub = open ? items[open.i] : null;
  return (
    <>
      <div
        ref={ref}
        className="wb-menu"
        role="menu"
        tabIndex={-1}
        data-level={level}
        style={{ left: pos?.x ?? x, top: pos?.y ?? y, visibility: pos ? "visible" : "hidden", zIndex: 60 + level }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (open?.focus) return;
          const it = items[active];
          if (e.key === "ArrowDown") step(1);
          else if (e.key === "ArrowUp") step(-1);
          else if (e.key === "ArrowRight" && it && isAction(it) && it.submenu) openSub(active, true);
          else if (e.key === "ArrowLeft" && onBack) onBack();
          else if (e.key === "Escape") (onBack ?? closeMenu)();
          else if ((e.key === "Enter" || e.key === " ") && it && isAction(it)) select(it, active, true);
          else return;
          e.preventDefault();
        }}
      >
        {items.map((it, i) => {
          if ("separator" in it) return <div key={i} className="wb-menu__sep" role="separator" />;
          if ("heading" in it) return <div key={i} className="wb-menu__heading">{it.heading}</div>;
          const hasSub = !!it.submenu;
          return (
            <button
              key={i}
              type="button"
              data-i={i}
              role={it.radio ? "menuitemradio" : it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={it.checked}
              aria-haspopup={hasSub ? "menu" : undefined}
              aria-expanded={hasSub ? open?.i === i : undefined}
              className={`wb-menu__item${active === i || open?.i === i ? " is-active" : ""}${it.danger ? " is-danger" : ""}`}
              disabled={it.disabled}
              onPointerEnter={() => {
                setActive(i);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => (hasSub ? openSub(i) : setOpen(null)), hasSub ? 90 : 160);
              }}
              onClick={() => select(it, i)}
            >
              <span className="wb-menu__check">
                {it.checked ? <span className={it.radio ? "wb-menu__dot" : "pw-icon pw-icon--checkmark"} /> : null}
              </span>
              {it.swatch ? <i className="wb-menu__swatch" style={{ background: it.swatch }} /> : null}
              <span className="wb-menu__label">{it.label}</span>
              {it.hint ? <span className="wb-menu__hint">{it.hint}</span> : null}
              {hasSub ? <span className="pw-icon pw-icon--chevron-right wb-menu__more" /> : null}
            </button>
          );
        })}
      </div>
      {open && sub && isAction(sub) && sub.submenu ? (
        <MenuList
          key={open.i}
          items={build(sub.submenu)}
          x={open.rect.right - 2}
          y={open.rect.top - 4}
          anchorLeft={open.rect.left}
          level={level + 1}
          autoFocus={open.focus}
          onBack={() => {
            setOpen(null);
            el(open.i)?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </>
  );
}
