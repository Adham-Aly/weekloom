"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoardHome } from "@/components/boards/board-home";
import { BoardModal } from "@/components/modals/board-modal";
import { createBoard, updateBoard, deleteBoard } from "@/app/actions";
import { useDialogs } from "@/components/ui/dialogs";
import { Personalization } from "@/components/personalization";
import type { Board } from "@/lib/types/database";
import type { HomeStats } from "@/app/actions";
import type { ResolvedSettings } from "@/lib/types/settings";

/**
 * Client wrapper for the Drive-style HOME SCREEN. The page is a server
 * component, so this thin shell holds the board list in optimistic state and
 * wires {@link BoardHome} to the board server actions, the edit modal and the
 * confirm dialog (delete-forever).
 *
 * Trash model: "Move to trash" archives (updateBoard archived=true) — fully
 * reversible via Restore. "Delete forever" is a confirmed destructive
 * deleteBoard that cascades the board's data. All mutations update local state
 * optimistically; navigation into a board is a real route change.
 */
export function BoardHomeScreen({
  initialBoards,
  activeBoardId,
  stats,
  settings,
}: {
  initialBoards: Board[];
  activeBoardId: string | null;
  stats: HomeStats;
  /** The settings document, read by the page. The picker is a first-class
   *  surface of this app and has to honour the same personalisation the board
   *  and Settings do — see `<Personalization>` below and `initialTheme`. */
  settings: ResolvedSettings;
}) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [boards, setBoards] = useState(initialBoards);
  const [editing, setEditing] = useState<Board | null>(null);
  const [, startTransition] = useTransition();

  const handleCreate = useCallback(
    (name: string) => {
      startTransition(async () => {
        const created = await createBoard({ name });
        if (!created) return;
        setBoards((prev) => [...prev, created]);
        router.push(`/app/${created.id}/gantt`);
      });
    },
    [router],
  );

  // Edit (name / icon / colour) via the modal.
  const handleEditSubmit = useCallback(
    (input: { name: string; color: string; icon: string | null }) => {
      const board = editing;
      if (!board) return;
      setEditing(null);
      setBoards((prev) =>
        prev.map((b) => (b.id === board.id ? { ...b, ...input } : b)),
      );
      startTransition(async () => {
        await updateBoard(board.id, input);
      });
    },
    [editing],
  );

  // Move to trash = archive (reversible).
  const handleTrash = useCallback((board: Board) => {
    setBoards((prev) =>
      prev.map((b) => (b.id === board.id ? { ...b, archived: true } : b)),
    );
    startTransition(async () => {
      await updateBoard(board.id, { archived: true });
    });
  }, []);

  const handleRestore = useCallback((board: Board) => {
    setBoards((prev) =>
      prev.map((b) => (b.id === board.id ? { ...b, archived: false } : b)),
    );
    startTransition(async () => {
      try {
        await updateBoard(board.id, { archived: false });
      } catch (e) {
        // Roll back. Anything that lands here is a real failure — the board row
        // was deleted from under us, or the write failed — so the optimistic
        // un-archive has to be undone rather than left showing a board that is
        // still in the trash on disk.
        setBoards((prev) =>
          prev.map((b) => (b.id === board.id ? { ...b, archived: true } : b)),
        );
        console.error("[board-home] restore failed", e);
      }
    });
  }, []);

  const handleDeleteForever = useCallback(
    async (board: Board) => {
      const ok = await confirm({
        title: `Delete "${board.name}" forever?`,
        message:
          "This permanently removes the board and all of its blocks, tasks, and steps. This can't be undone.",
        confirmLabel: "Delete forever",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) return;
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
      startTransition(async () => {
        await deleteBoard(board.id);
      });
    },
    [confirm],
  );

  return (
    <>
      {/* ⚠️ The accent lives on `<html>` as a CSS variable, so every surface
       *  that draws `var(--accent)` needs this mounted — and the picker is a
       *  surface, not a shell. MEASURED before it was: `accentColor` on disk
       *  `#0f7a55`, the board and Settings both green, and the picker still
       *  drawing the stock blue on its "New board" button, its badges and its
       *  activity heatmap. The board mounts this too; the two must agree. */}
      <Personalization accentColor={settings.accentColor} />
      <BoardHome
        boards={boards}
        activeBoardId={activeBoardId}
        stats={stats}
        initialTheme={settings.theme}
        onCreate={handleCreate}
        onEdit={(b) => setEditing(b)}
        onTrash={handleTrash}
        onRestore={handleRestore}
        onDeleteForever={handleDeleteForever}
      />
      <BoardModal
        open={editing != null}
        initial={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSubmit={handleEditSubmit}
      />
    </>
  );
}
