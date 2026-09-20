import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M12 5v14" />
    </IconBase>
  );
}
export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m18 6-12 12M6 6l12 12" />
    </IconBase>
  );
}
export function BackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}
export function ChevronIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}
export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </IconBase>
  );
}
export function PencilIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </IconBase>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </IconBase>
  );
}

export function RestartIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 6v5h-5" />
      <path d="M18.5 15a7 7 0 1 1-1.6-8.7L20 9" />
    </IconBase>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 7v7a4 4 0 0 0 4 4h6M8 8h8" />
    </IconBase>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </IconBase>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </IconBase>
  );
}

export function LightbulbIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M9 14h6" />
      <path d="M15.1 14c.2-.7.6-1.2 1.1-1.8A6 6 0 1 0 7.8 12.2c.5.6.9 1.1 1.1 1.8" />
    </IconBase>
  );
}
