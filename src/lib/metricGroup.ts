import type { Metric } from '../db/schema'

/**
 * Grouping key for metric series. 'other' metrics group by normalized
 * label+unit — labs print the same test with varying case, and the chat
 * context must group EXACTLY like the Metrics tab or the AI contradicts
 * what the user sees on screen.
 */
export function metricGroupKey(m: Metric): string {
  return m.key === 'other' ? `other:${m.label.toLowerCase()}:${m.unit.toLowerCase()}` : m.key
}
