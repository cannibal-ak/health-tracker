import { AIProviderError, EXTRACTION_JSON_SCHEMA, parseJsonLoose, type AIProvider, type ChatMsg, type PreparedDoc } from '../types'
import { extractionPrompt } from '../prompts'

const BASE = 'https://api.anthropic.com/v1'

function headers(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Required for calling the Anthropic API from a browser. The key is the
    // user's own, entered by them and stored only on their device.
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[]
  stop_reason?: string
}

async function callAnthropic(key: string, body: Record<string, unknown>): Promise<AnthropicResponse> {
  const r = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 401) throw new AIProviderError('This Anthropic API key is not valid')
    if (r.status === 429)
      throw new AIProviderError('Anthropic rate limit reached — try again in a minute')
    throw new AIProviderError(`Anthropic error ${r.status}: ${text.slice(0, 200)}`)
  }
  const json = (await r.json()) as AnthropicResponse
  // Safety classifiers can decline with a 200 — check before reading content.
  if (json.stop_reason === 'refusal') {
    throw new AIProviderError('Claude declined to process this request')
  }
  return json
}

function textOf(resp: AnthropicResponse): string {
  const text = (resp.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) throw new AIProviderError('Claude returned an empty response')
  return text
}

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  supportsNativePdf: true,
  defaultModel: 'claude-haiku-4-5',
  keyPlaceholder: 'sk-ant-…',
  keyHelpUrl: 'https://platform.claude.com/settings/keys',

  async validateKey(key) {
    const r = await fetch(`${BASE}/models?limit=1`, { headers: headers(key) })
    if (!r.ok) throw new AIProviderError('This Anthropic API key was rejected')
  },

  async extract(doc: PreparedDoc, key, model) {
    const content: unknown[] = []
    if (doc.kind === 'pdf' && doc.pdfBase64) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: doc.pdfBase64 },
      })
    } else {
      for (const img of doc.images ?? []) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: img },
        })
      }
    }
    content.push({ type: 'text', text: extractionPrompt() })

    const body = {
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA } },
    }
    try {
      const resp = await callAnthropic(key, body)
      return parseJsonLoose(textOf(resp))
    } catch (e) {
      // Older or unusual models may not support structured outputs — retry plain.
      if (e instanceof AIProviderError && e.message.includes('400')) {
        const resp = await callAnthropic(key, {
          model,
          max_tokens: 8192,
          messages: [{ role: 'user', content }],
        })
        return parseJsonLoose(textOf(resp))
      }
      throw e
    }
  },

  async chat(system, messages: ChatMsg[], key, model) {
    const resp = await callAnthropic(key, {
      model,
      max_tokens: 2048,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    })
    return textOf(resp)
  },
}
