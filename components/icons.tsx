// Inline SVG icons (no lucide dep risk). 16px viewBox.
import type { SVGProps } from "react";

const baseProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const Plus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const ChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const ChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
export const ChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const ChevronUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M18 15l-6-6-6 6" />
  </svg>
);
export const Search = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
export const Today = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
  </svg>
);
export const Calendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
export const Trash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
);
export const Flag = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M4 22V4M4 4l14 4-4 4 4 4-14 0" />
  </svg>
);
export const Sparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </svg>
);

export const Eye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOff = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a19.7 19.7 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a19.6 19.6 0 01-3.17 4.19M1 1l22 22M14.12 14.12A3 3 0 119.88 9.88" />
  </svg>
);

/** Padlock — used for locked/gated actions (replaces the 🔒 emoji + lucide Lock). */
export const Lock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);

/** Checkmark. */
export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

/** Close / dismiss. */
export const X = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Calendar with day dots — richer variant of Calendar. */
export const CalendarDays = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);

/** Folder with a plus — used for the "create block" action. */
export const FolderPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    <path d="M12 11v6M9 14h6" />
  </svg>
);

/** Pin-style icon — used for the "pin item to deadlines" action. */
export const Pin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps} {...p}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.89A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.89A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" />
  </svg>
);
