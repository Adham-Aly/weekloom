import { describe, expect, it } from "vitest";
import {
  diffOpCount,
  diffSnapshots,
  takeSnapshot,
  type Snapshot,
} from "./snapshot";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    blocks: [],
    items: [],
    steps: [],
    deadlines: [],
    pinnedItemIds: [],
    ...over,
  };
}

function block(id: string, name = "B"): import("@/lib/types/database").Block {
  return {
    id,
    board_id: "bd",
    name,
    color: "#fff",
    icon: null,
    sort_order: 0,
    is_system: false,
    archived: false,
    collapsed: false,
    created_at: "",
    updated_at: "",
  };
}

describe("diffSnapshots", () => {
  it("empty → empty produces no ops", () => {
    const d = diffSnapshots(snap(), snap());
    expect(diffOpCount(d)).toBe(0);
  });

  it("detects creates, deletes, and updates separately", () => {
    const current = snap({ blocks: [block("a"), block("b", "old")] });
    const target = snap({ blocks: [block("b", "new"), block("c")] });
    const d = diffSnapshots(current, target);
    expect(d.blocks.deleted).toEqual(["a"]);
    expect(d.blocks.created.map((b) => b.id)).toEqual(["c"]);
    expect(d.blocks.updated.map((b) => b.id)).toEqual(["b"]);
    expect(d.blocks.updated[0].name).toBe("new");
  });

  it("treats identical rows as no-change", () => {
    const a = block("a");
    const current = snap({ blocks: [a] });
    const target = snap({ blocks: [{ ...a }] });
    const d = diffSnapshots(current, target);
    expect(diffOpCount(d)).toBe(0);
  });

  it("flags pinned change separately", () => {
    const d1 = diffSnapshots(
      snap({ pinnedItemIds: ["a"] }),
      snap({ pinnedItemIds: ["a", "b"] }),
    );
    expect(d1.pinnedChanged).toBe(true);

    const d2 = diffSnapshots(
      snap({ pinnedItemIds: ["a", "b"] }),
      snap({ pinnedItemIds: ["a", "b"] }),
    );
    expect(d2.pinnedChanged).toBe(false);
  });
});

describe("takeSnapshot", () => {
  it("clones so callers can mutate original without affecting snapshot", () => {
    const original = snap({ blocks: [block("a", "before")] });
    const snapshot = takeSnapshot(original);
    original.blocks[0].name = "after";
    expect(snapshot.blocks[0].name).toBe("before");
  });
});
