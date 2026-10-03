export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="6" fill="var(--brand)" />
      <path
        d="M5 13V9M8.5 15V5M12 12V8M15.5 14V6"
        stroke="var(--on-brand)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
