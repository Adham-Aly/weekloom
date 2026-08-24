"use client";

import { DialogProvider } from "@/components/ui/dialogs";
import { ContextMenuProvider } from "@/components/ui/context-menu";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ContextMenuProvider>
      <DialogProvider>{children}</DialogProvider>
    </ContextMenuProvider>
  );
}
