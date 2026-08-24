"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import { BlockSelect } from "@/components/ui/block-select";
import { addDays, daysBetween, toISODate } from "@/lib/utils";
import type { Block, Item } from "@/lib/types/database";
import { useAutoFocus } from "@/lib/hooks/use-auto-focus";

export function ItemModal({
  open,
  blocks,
  defaultBlockId,
  defaultStart,
  defaultDuration,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  blocks: Block[];
  defaultBlockId?: string | null;
  defaultStart?: string;
  defaultDuration?: number;
  initial?: Item;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    blockId: string;
    startDate: string;
    durationDays: number;
  }) => void;
}) {
  // Defensive: only honor a defaultBlockId that's actually in the current
  // blocks list. Otherwise the user can submit an ID that fails the FK on
  // the server.
  function resolveBlockId(): string {
    if (initial?.block_id && blocks.some((b) => b.id === initial.block_id))
      return initial.block_id;
    if (defaultBlockId && blocks.some((b) => b.id === defaultBlockId))
      return defaultBlockId;
    return blocks[0]?.id ?? "";
  }
  const [title, setTitle] = useState(initial?.title ?? "");
  const [blockId, setBlockId] = useState(resolveBlockId);
  const [startDate, setStartDate] = useState(
    initial?.start_date ?? defaultStart ?? toISODate(new Date()),
  );
  const [duration, setDuration] = useState(
    initial?.duration_days ?? defaultDuration ?? 1,
  );

  // Reset when reopening
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setBlockId(resolveBlockId());
      setStartDate(
        initial?.start_date ?? defaultStart ?? toISODate(new Date()),
      );
      setDuration(initial?.duration_days ?? defaultDuration ?? 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const endDate = toISODate(
    addDays(new Date(startDate + "T00:00:00"), duration - 1),
  );

  function onEndDateChange(iso: string) {
    const d = daysBetween(startDate, iso) + 1;
    setDuration(Math.max(1, d));
  }

  const titleRef = useRef<HTMLInputElement>(null);
  useAutoFocus(titleRef, open);

  function submit() {
    if (!title.trim() || !blockId || duration < 1) return;
    onSubmit({
      title: title.trim(),
      blockId,
      startDate,
      durationDays: duration,
    });
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <ModalHeader title={initial ? "Edit item" : "New item"} />
      <div className="px-6 py-5 space-y-5">
        <div className="space-y-1">
          <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
            Title
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Study for Math Exam"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[13.5px] placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-12 gap-3 text-xs">
          <div className="col-span-3 space-y-1">
            <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
              Block
            </label>
            <BlockSelect
              blocks={blocks}
              currentBlockId={blockId}
              onChange={setBlockId}
            />
          </div>
          <div className="col-span-4 space-y-1">
            <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
              Start
            </label>
            <DatePicker value={startDate} onChange={setStartDate} />
          </div>
          <div className="col-span-3 space-y-1">
            <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
              End
            </label>
            <DatePicker value={endDate} onChange={onEndDateChange} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="block text-[8.1px] font-semibold uppercase tracking-widest text-text-dim">
              Days
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={duration}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                setDuration(digits === "" ? 1 : Math.max(1, Number(digits)));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[11.7px] tabular-nums focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <p className="text-[10.3px] text-text-dim">
          {duration} day{duration === 1 ? "" : "s"} will appear as a staircase
          on the Gantt. Use{" "}
          <kbd className="rounded bg-surface px-1 py-0.5 font-mono text-[8.1px] text-text-muted">
            ↓
          </kbd>{" "}
          /{" "}
          <kbd className="rounded bg-surface px-1 py-0.5 font-mono text-[8.1px] text-text-muted">
            ↑
          </kbd>{" "}
          on the gantt to fill in what you&apos;ll do each day.
        </p>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel={initial ? "Save" : "Create"}
        disabled={!title.trim() || !blockId}
      />
    </Modal>
  );
}
