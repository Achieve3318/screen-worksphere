const marks: Record<string, { bg: string; fg: string; glyph: string }> = {
  USDT: { bg: '#26A17B', fg: '#ffffff', glyph: '₮' },
  USDC: { bg: '#2775CA', fg: '#ffffff', glyph: '$' },
  BTC: { bg: '#F7931A', fg: '#ffffff', glyph: '₿' },
  ETH: { bg: '#627EEA', fg: '#ffffff', glyph: '◆' },
  BNB: { bg: '#F3BA2F', fg: '#1a1404', glyph: '◆' },
  SOL: { bg: '#9945FF', fg: '#ffffff', glyph: 'S' },
  DAI: { bg: '#F5AC37', fg: '#1a1404', glyph: 'D' },
  TRC: { bg: '#FF060A', fg: '#ffffff', glyph: 'T' },
  ERC: { bg: '#627EEA', fg: '#ffffff', glyph: 'E' },
  BASE: { bg: '#0052FF', fg: '#ffffff', glyph: 'B' },
  POLYGON: { bg: '#8247E5', fg: '#ffffff', glyph: 'P' },
}

export function MoneyIcon({ id, size = 18 }: { id: string; size?: number }) {
  const mark = marks[id] ?? { bg: '#16382f', fg: '#ffffff', glyph: id.slice(0, 1) }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="11" fill={mark.bg} />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize={mark.glyph.length > 1 ? 10 : 12}
        fontFamily="Segoe UI, sans-serif"
        fontWeight="700"
        fill={mark.fg}
      >
        {mark.glyph}
      </text>
    </svg>
  )
}
