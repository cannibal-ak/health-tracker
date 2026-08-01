/** BMI = kg / m². Height is always stored in cm, weight in kg. */
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}

export type BmiCategory = 'underweight' | 'healthy' | 'overweight' | 'obese'

// WHO adult cut-offs: healthy 18.5 ≤ BMI < 25, overweight 25 ≤ BMI < 30.
export const BMI_HEALTHY_LOW = 18.5
export const BMI_HEALTHY_HIGH = 25

export function bmiCategory(value: number): BmiCategory {
  if (value < BMI_HEALTHY_LOW) return 'underweight'
  if (value < BMI_HEALTHY_HIGH) return 'healthy'
  if (value < 30) return 'overweight'
  return 'obese'
}

export const BMI_CATEGORY_LABEL: Record<BmiCategory, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy',
  overweight: 'Overweight',
  obese: 'Obese',
}

/** Weight range (kg) that maps to the healthy BMI band for a given height. */
export function healthyWeightRangeKg(heightCm: number): { low: number; high: number } {
  const m = heightCm / 100
  return { low: BMI_HEALTHY_LOW * m * m, high: BMI_HEALTHY_HIGH * m * m }
}
