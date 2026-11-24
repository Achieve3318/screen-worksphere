export const paymentAssets = [
  { id: 'USDT', label: 'USDT' },
  { id: 'USDC', label: 'USDC' },
] as const

export const paymentNetworks = [
  { id: 'BNB', label: 'BNB' },
  { id: 'TRC', label: 'TRC' },
  { id: 'ERC', label: 'ERC' },
  { id: 'BASE', label: 'BASE' },
] as const

export type PaymentAsset = (typeof paymentAssets)[number]['id']
export type PaymentNetwork = (typeof paymentNetworks)[number]['id']

export const networksForAsset: Record<PaymentAsset, readonly PaymentNetwork[]> = {
  USDT: ['BNB', 'TRC', 'ERC'],
  USDC: ['BASE'],
}
