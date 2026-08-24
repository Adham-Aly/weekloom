"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import { toISODate } from "@/lib/utils";
import { useAutoFocus } from "@/lib/hooks/use-auto-focus";

export function DeadlineModal({
  open,
  initialDate,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialDate?: string;
  onClose: () => void;
  onSubmit: (input: { name: string; date: string }) => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(initialDate ?? toISODate(new Date()));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDate(initialDate ?? toISODate(new Date()));
    }
  }, [open, initialDate]);
  useAutoFocus(nameRef, open);

  function submit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), date });
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="New deadline" />
      <div className="px-6 py-3 space-y-4">
        <div className="space-y-1">
          <label className="block text-[9px] uppercase tracking-wider text-text-dim">
            Name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Math Exam"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[9px] uppercase tracking-wider text-text-dim">
            Date
          </label>
          <DatePicker value={date} onChange={setDate} />
        </div>
      </div>
      <ModalFooter
        onCancel={onClose}
        onConfirm={submit}
        confirmLabel="Add"
        disabled={!name.trim()}
      />
    </Modal>
  );
}
