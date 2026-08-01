const KG_PER_LB = 0.45359237

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB
}

/** Display weight in the user's unit, e.g. "72.5 kg" / "159.8 lb". */
export function formatWeight(weightKg: number, unit: 'kg' | 'lb', digits = 1): string {
  const v = unit === 'kg' ? weightKg : kgToLb(weightKg)
  return `${v.toFixed(digits)} ${unit}`
}

/** Convert a value entered in the user's unit back to kg for storage. */
export function toKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? value : lbToKg(value)
}

export function fromKg(weightKg: number, unit: 'kg' | 'lb'): number {
  return unit === 'kg' ? weightKg : kgToLb(weightKg)
}
