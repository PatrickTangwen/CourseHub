/**
 * 内联图标:只为几个字形引入图标库不划算。
 * stroke 走 currentColor,自动跟随主题与 hover 态。
 */
const ICON = {
  className: "h-4 w-4 shrink-0",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const PlusIcon = () => (
  <svg {...ICON}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ArrowUpIcon = () => (
  <svg {...ICON}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const BookIcon = () => (
  <svg {...ICON}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </svg>
);

export const PersonIcon = () => (
  <svg {...ICON}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const ListIcon = () => (
  <svg {...ICON}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...ICON}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
