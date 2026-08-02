import { z } from 'zod'
import type { ProviderId } from '../db/schema'

/** A report prepared for sending to an AI provider. */
export interface PreparedDoc {
  kind: 'pdf' | 'images'
  /** base64 (no data: prefix) when kind === 'pdf'. */
  pdfBase64?: string
  /** JPEG page/photo images, base64 without prefix. */
  images?: string[]
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Provider contract. Adding a provider = one file implementing this
 * + one registry entry. Keys/models are passed per-call (never stored here).
 */
export interface AIProvider {
  id: ProviderId
  label: string
  supportsNativePdf: boolean
  defaultModel: string
  keyPlaceholder: string
  keyHelpUrl: string
  /** Cheap authenticated ping; throws with a readable message on failure. */
  validateKey(key: string): Promise<void>
  /** Send a document + extraction prompt; returns the raw (unvalidated) JSON. */
  extract(doc: PreparedDoc, key: string, model: string): Promise<unknown>
  /** Guidance chat completion. */
  chat(system: string, messages: ChatMsg[], key: string, model: string): Promise<string>
}

// ---------- Extraction output schema (validated with Zod) ----------

export const extractedMetricSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.number(),
    unit: z.string(),
    refLow: z.number().nullish(),
    refHigh: z.number().nullish(),
    note: z.string().nullish(),
  })
  .passthrough()

export const extractionResultSchema = z
  .object({
    testDate: z.string().nullish(),
    labName: z.string().nullish(),
    metrics: z.array(extractedMetricSchema),
  })
  .passthrough()

export type ExtractionResult = z.infer<typeof extractionResultSchema>

/** JSON schema handed to providers that support schema-constrained output. */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    testDate: { type: ['string', 'null'], description: 'Sample/report date as YYYY-MM-DD if printed' },
    labName: { type: ['string', 'null'] },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          refLow: { type: ['number', 'null'] },
          refHigh: { type: ['number', 'null'] },
          note: { type: ['string', 'null'] },
        },
        required: ['key', 'label', 'value', 'unit'],
        additionalProperties: false,
      },
    },
  },
  required: ['metrics'],
  additionalProperties: false,
} as const

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIProviderError'
  }
}

/** Strip markdown code fences and parse the first JSON object found. */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Last resort: find the outermost braces.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new AIProviderError('The AI response was not valid JSON')
  }
}
