// Scout is decorative beside the app title and empty-desk heading.
export function FernblickMark({ className = "" }: { className?: string }) {
  return (
    <img
      className={className}
      src="/icons/scout-head.png"
      width={40}
      height={40}
      alt=""
      aria-hidden="true"
    />
  );
}
