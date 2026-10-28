export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <img
        className="brand__studio-logo"
        src="/lsr-signage-logo.svg"
        alt="LSR signage"
      />
    );
  return (
    <div className="brand" aria-label="LSR signage">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand__name">LSR signage</span>
    </div>
  );
}
