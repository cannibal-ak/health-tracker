import type { ProviderId } from '../db/schema'
import type { AIProvider } from './types'
import { geminiProvider } from './providers/gemini'
import { openaiProvider } from './providers/openai'
import { anthropicProvider } from './providers/anthropic'

/** Adding a provider: implement AIProvider in providers/, add one entry here. */
export const PROVIDERS: Record<ProviderId, AIProvider> = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
}

export const PROVIDER_LIST: AIProvider[] = Object.values(PROVIDERS)
