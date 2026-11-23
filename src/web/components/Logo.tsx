export function Logo({ large = false }: { large?: boolean }) {
  return (
    <svg className={large ? 'logo logo-lg' : 'logo'} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M11.6 10.5C9.2 7.6 8.6 1.6 11 1.3c2.5-.3 3.7 5.2 3.5 8.7M20.4 10.5c2.4-2.9 3-8.9.6-9.2-2.5-.3-3.7 5.2-3.5 8.7" fill="currentColor" />
      <circle cx="16" cy="15" r="7" fill="currentColor" />
      <g fill="var(--logo-ground)"><circle cx="13.3" cy="13.8" r="1.1" /><circle cx="18.7" cy="13.8" r="1.1" /><path d="M15 16.3h2l-1 1.2z" /></g>
      <rect x="7.5" y="19" width="17" height="12" rx="1.5" fill="var(--logo-ground)" stroke="currentColor" strokeWidth="2" />
      <path d="M12 23.5h8M12 27h5.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <g fill="currentColor" stroke="var(--logo-ground)"><rect x="5.5" y="19.5" width="5" height="4" rx="2" /><rect x="21.5" y="19.5" width="5" height="4" rx="2" /></g>
    </svg>
  );
}
