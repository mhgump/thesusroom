import { useId } from 'react'

const HEART = 'M8 14C3 9.5 0 7 0 4.5 0 2 1.8 1 4 1c1.5 0 3 1 4 2.5C9 2 10.5 1 12 1c2.2 0 4 1 4 3.5 0 2.5-3 5-8 9.5z'

export function HeartFull() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" style={{ display: 'block' }}>
      <path d={HEART} stroke="rgba(0,0,0,0.4)" strokeWidth="1" fill="#e74c3c" />
    </svg>
  )
}

export function HeartHalf() {
  const clipId = useId()
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" style={{ display: 'block' }}>
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="8" height="16" />
        </clipPath>
      </defs>
      <path d={HEART} fill="none" stroke="#e74c3c" strokeWidth="1" />
      <path d={HEART} fill="#e74c3c" stroke="rgba(0,0,0,0.4)" strokeWidth="1" clipPath={`url(#${clipId})`} />
    </svg>
  )
}
