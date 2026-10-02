export function WhiteboardButton({
  disabled,
  onClick,
  className,
}: {
  className: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label="Open whiteboard"
      title="Whiteboard"
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="14" rx="2" />
        <path d="m7 12 3-5 3 6 4-4M12 17v4m-4 0h8" />
      </svg>
    </button>
  );
}
