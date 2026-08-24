"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEscape } from "@/lib/hooks/use-escape";
import { useOutsideClick } from "@/lib/hooks/use-outside-click";

export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      destructive?: boolean;
      shortcut?: string;
      disabled?: boolean;
    }
  | { type: "separator" };

type Ctx = {
  open: (e: React.MouseEvent, items: MenuItem[]) => void;
};

const CtxMenuCtx = createContext<Ctx | null>(null);

export function useContextMenu() {
  const ctx = useContext(CtxMenuCtx);
  if (!ctx)
    throw new Error("useContextMenu must be inside <ContextMenuProvider>");
  return ctx;
}

/**
 * Convenience: spread into any element to give it a custom right-click menu.
 * Usage: <div {...useMenu(() => [{label:'Edit', onClick:...}])} />
 */
export function useMenu(builder: () => MenuItem[]) {
  const { open } = useContextMenu();
  return {
    onContextMenu: (e: React.MouseEvent) => {
      // allow native menu inside inputs/textareas
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      open(e, builder());
    },
  };
}

export function ContextMenuProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // Suppress global browser context menu by default (when not in an input).
  useEffect(() => {
    function onCtx(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t) return;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      // If a child component already handled it via useMenu, it called
      // preventDefault — `defaultPrevented` will be true. Otherwise suppress.
      if (!e.defaultPrevented) e.preventDefault();
    }
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  return (
    <CtxMenuCtx.Provider value={{ open }}>
      {children}
      <AnimatePresence>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
    </CtxMenuCtx.Provider>
  );
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, flippedX: false, flippedY: false });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nx = x + r.width + 8 > vw ? vw - r.width - 8 : x;
    const ny = y + r.height + 8 > vh ? vh - r.height - 8 : y;
    setPos({ x: nx, y: ny, flippedX: nx !== x, flippedY: ny !== y });
  }, [x, y]);

  const outsideRefs = useMemo(() => [ref], []);
  useOutsideClick(outsideRefs, onClose);
  useEscape(onClose);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -4 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      style={{
        left: pos.x,
        top: pos.y,
        transformOrigin: `${pos.flippedY ? "bottom" : "top"} ${pos.flippedX ? "right" : "left"}`,
        // Frosted glass — matches block-select's dropdown-of-rows chrome.
        background: "color-mix(in srgb, var(--bg-elev) 82%, transparent)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
      }}
      className="fixed z-[300] min-w-[180px] rounded-xl p-1 shadow-2xl shadow-black/40"
    >
      {items.map((it, i) =>
        it.type === "separator" ? (
          <div
            key={i}
            className="my-1 h-px"
            style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }}
          />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              it.onClick();
              onClose();
            }}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[11.7px] transition disabled:opacity-40",
              it.destructive
                ? "text-deadline hover:bg-deadline/10"
                : "text-text-muted transition hover:bg-surface hover:text-text",
            )}
          >
            <span className="flex items-center gap-2.5">
              {it.icon}
              {it.label}
            </span>
            {it.shortcut && (
              <kbd className="font-mono text-[9px] text-text-dim">
                {it.shortcut}
              </kbd>
            )}
          </button>
        ),
      )}
    </motion.div>
  );
}
