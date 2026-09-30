// A window onto the horizon: the same mark anchors navigation and the empty desk.
export function FernblickMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="12" fill="currentColor" />
      <path
        d="M9 26h22M10 21l7-8 6 8 4-5 4 5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28" cy="11" r="2" fill="white" />
    </svg>
  );
}
