import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";

const DIR = process.env.WEEKLOOM_DATA_DIR;
const db = new DatabaseSync(path.join(DIR, "weekloom.db"));
const now = new Date().toISOString();
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};
// ⚠️ Real UUIDs: app/app/[[...slug]]/page.tsx tests the first slug segment
// against UUID_RE and silently renders the board PICKER when it fails.
const id = () => randomUUID();

db.exec(
  "DELETE FROM steps; DELETE FROM items; DELETE FROM blocks; DELETE FROM deadlines; DELETE FROM boards;",
);

const board = id();
db.prepare(
  `INSERT INTO boards (id,name,color,archived,sort_order,created_at,updated_at)
            VALUES (?,?,?,0,0,?,?)`,
).run(board, "Product Launch", "#3b82f6", now, now);

const lanes = [
  ["Design", "#ec4899"],
  ["Engineering", "#3b82f6"],
  ["Content", "#f59e0b"],
  ["Launch", "#22c55e"],
];
const laneIds = lanes.map(([name, color], i) => {
  const b = id();
  db.prepare(
    `INSERT INTO blocks (id,board_id,name,color,sort_order,collapsed,is_system,archived,created_at,updated_at)
              VALUES (?,?,?,?,?,0,0,0,?,?)`,
  ).run(b, board, name, color, i, now, now);
  return b;
});

// lane, title, startOffset, steps: [label, status, time, minutes]
const tasks = [
  [
    0,
    "Icon + brand pass",
    -3,
    [
      ["Sketch marks", "done", "09:30", 90],
      ["Pick the palette", "done", "11:00", 60],
      ["Export the icon set", "done", "14:00", 90],
      ["Dark mode variant", "in_progress", "10:00", 60],
    ],
  ],
  [
    0,
    "Landing page mockups",
    1,
    [
      ["Wireframe the hero", "todo", "09:00", 120],
      ["Feature section", "todo", "13:00", 90],
      ["Pricing table", "todo", "10:30", 90],
      ["Mobile pass", "todo", "14:30", 120],
      ["Handoff to build", "todo", "11:00", 60],
    ],
  ],
  [
    1,
    "Recurring series engine",
    -2,
    [
      ["Model the series", "done", "09:00", 120],
      ["Materialise occurrences", "done", "13:30", 150],
      ["Dedup on origin", "in_progress", "09:30", 120],
      ["Edit-scope handling", "todo", "14:00", 120],
      ["Backfill tests", "todo", "10:00", 90],
      ["Review", "todo", "15:00", 60],
    ],
  ],
  [
    1,
    "Calendar drag + resize",
    2,
    [
      ["Drag to move", "todo", "09:00", 120],
      ["Resize edges", "todo", "11:30", 90],
      ["Snap to slot", "todo", "14:00", 90],
      ["Overlap layout", "todo", "09:30", 120],
      ["Keyboard nudge", "todo", "13:00", 60],
    ],
  ],
  [
    1,
    "Packaging + installers",
    4,
    [
      ["macOS dmg", "todo", "10:00", 90],
      ["Windows exe", "todo", "13:00", 90],
      ["Linux AppImage", "todo", "10:00", 90],
    ],
  ],
  [
    2,
    "Write the README",
    0,
    [
      ["Install section", "in_progress", "08:30", 60],
      ["Screenshots", "todo", "15:30", 90],
    ],
  ],
  [
    2,
    "Record the demo video",
    3,
    [
      ["Script the walkthrough", "todo", "11:00", 60],
      ["Screen capture", "todo", "14:00", 120],
      ["Edit + caption", "todo", "10:00", 120],
    ],
  ],
  [
    3,
    "Ship v1.0",
    8,
    [
      ["Tag the release", "todo", "09:00", 30],
      ["Post the thread", "todo", "12:00", 60],
    ],
  ],
];

const itemIds = [];
for (const [lane, title, off, steps] of tasks) {
  const it = id();
  itemIds.push(it);
  db.prepare(
    `INSERT INTO items (id,board_id,block_id,title,start_date,duration_days,deadline_offset,sort_order,created_at,updated_at)
              VALUES (?,?,?,?,?,?,0,?,?,?)`,
  ).run(it, board, laneIds[lane], title, plus(off), steps.length, 0, now, now);
  steps.forEach(([label, status, time, mins], d) => {
    db.prepare(
      `INSERT INTO steps (id,item_id,board_id,day_offset,label,time_of_day,duration_min,status,detached,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
    ).run(id(), it, board, d, label, time, mins, status, now, now);
  });
}

db.prepare(
  `INSERT INTO deadlines (id,board_id,name,date,color,created_at)
            VALUES (?,?,?,?,?,?)`,
).run(id(), board, "Launch day", plus(9), "#ef4444", now);

db.prepare(
  `INSERT INTO user_settings (id,settings,updated_at) VALUES (1,?,?)
            ON CONFLICT(id) DO UPDATE SET settings=excluded.settings`,
).run(JSON.stringify({ activeBoardId: board }), now);

console.log(board);
db.close();
