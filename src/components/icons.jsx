// Иконки: 24×24, линия цветом текста, без заливки.
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.6 };

export const ScrollIcon = (p) => (
  <svg {...base} {...p}><path d="M7 4h11a2 2 0 0 1 2 2v1H9" /><path d="M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" /><line x1="9" y1="11" x2="16" y2="11" /><line x1="9" y1="15" x2="14" y2="15" /></svg>
);
export const SlidersIcon = (p) => (
  <svg {...base} {...p}><line x1="5" y1="4" x2="5" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="19" y1="4" x2="19" y2="20" /><circle cx="5" cy="15" r="2" fill="#0D120F" /><circle cx="12" cy="8" r="2" fill="#0D120F" /><circle cx="19" cy="13" r="2" fill="#0D120F" /></svg>
);
export const FolderIcon = (p) => (
  <svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></svg>
);
export const RefreshIcon = (p) => (
  <svg {...base} {...p}><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></svg>
);
export const SparkIcon = (p) => (
  <svg {...base} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
);
export const BackIcon = (p) => (
  <svg {...base} {...p}><path d="M15 18l-6-6 6-6" /></svg>
);
export const SearchIcon = (p) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><line x1="16" y1="16" x2="20" y2="20" /></svg>
);
export const TrashIcon = (p) => (
  <svg {...base} {...p}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
);
export const CodeIcon = (p) => (
  <svg {...base} {...p}><path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /></svg>
);
export const BookIcon = (p) => (
  <svg {...base} {...p}><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19V5" /><line x1="9" y1="8" x2="15" y2="8" /></svg>
);
export const AlertIcon = (p) => (
  <svg {...base} {...p}><path d="M12 4 3 20h18Z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></svg>
);
export const CloseIcon = (p) => (
  <svg {...base} {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
export const PathIcon = (p) => (
  <svg {...base} {...p}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="19" r="2" /><path d="M8 5h4a4 4 0 0 1 4 4v1M16 14v1a4 4 0 0 1-4 4H8" /></svg>
);
export const NextIcon = (p) => (
  <svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>
);
export const TableIcon = (p) => (
  <svg {...base} {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="10" y1="10" x2="10" y2="19" /></svg>
);
export const BranchIcon = (p) => (
  <svg {...base} {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-11.5 7" /></svg>
);
