export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect width="44" height="44" rx="11" fill="var(--accent)" />
      <circle cx="20" cy="20" r="10" stroke="#fff" strokeWidth="3" />
      <path d="m27.5 27.5 7 7" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M15.5 24v-3M20 24v-6M24.5 24v-9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
