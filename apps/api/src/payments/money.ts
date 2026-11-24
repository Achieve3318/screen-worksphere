const SCALE = 100_000_000n

export function parseAmount(input: string): bigint {
  const trimmed = input.trim()
  const match = /^(\d{1,12})(?:\.(\d{1,8}))?$/.exec(trimmed)
  if (!match) {
    throw new Error('Enter an amount with up to 8 decimal places.')
  }
  const whole = BigInt(match[1] ?? '0')
  const fraction = (match[2] ?? '').padEnd(8, '0')
  const minor = whole * SCALE + BigInt(fraction)
  if (minor <= 0n) throw new Error('Amount must be greater than zero.')
  return minor
}

export function formatAmount(minor: bigint): string {
  const negative = minor < 0n
  const value = negative ? -minor : minor
  const whole = value / SCALE
  let fraction = (value % SCALE).toString().padStart(8, '0').replace(/0+$/, '')
  if (fraction.length === 0) fraction = '00'
  else if (fraction.length === 1) fraction = `${fraction}0`
  const text = `${whole.toString()}.${fraction}`
  return negative ? `-${text}` : text
}

export function sumAmounts(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n)
}
