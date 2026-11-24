const controlClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-[#d5deea]'

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={controlClass} aria-label="Close" onClick={onClick}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
      </svg>
    </button>
  )
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={controlClass} aria-label="Back" onClick={onClick}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M15 6 9 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
