export function EmptyState({ onChooseFolder }: { onChooseFolder: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <rect x="6" y="14" width="44" height="32" rx="6" stroke="currentColor" strokeWidth="2.5" />
          <path d="M6 20h44" stroke="currentColor" strokeWidth="2.5" />
          <path d="M28 40V27m0 0-5 5m5-5 5 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1>Dra en mappe hit for å komme i gang</h1>
      <p className="muted">
        Velg mappen der nettsiden ligger på Macen. Skyv holder styr på hva som er endret, og gir det ut til webhotellet når du er klar.
        Hver utgivelse kan angres.
      </p>
      <button className="btn btn-primary btn-large" onClick={onChooseFolder}>
        Velg mappe …
      </button>
    </div>
  )
}
