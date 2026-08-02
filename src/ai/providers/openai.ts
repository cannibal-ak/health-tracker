import { AIProviderError, parseJsonLoose, type AIProvider, type ChatMsg, type PreparedDoc } from '../types'
import { extractionPrompt } from '../prompts'

const BASE = 'https://api.openai.com/v1'

async function callOpenAI(
  key: string,
  body: Record<string, unknown>,
): Promise<string> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 401) throw new AIProviderError('This OpenAI API key is not valid')
    if (r.status === 429)
      throw new AIProviderError('OpenAI rate/credit limit reached — check your OpenAI account')
    throw new AIProviderError(`OpenAI error ${r.status}: ${text.slice(0, 200)}`)
  }
  const json = (await r.json()) as {
    choices?: { message?: { content?: string; refusal?: string } }[]
  }
  const msg = json.choices?.[0]?.message
  if (msg?.refusal) throw new AIProviderError(`OpenAI declined: ${msg.refusal}`)
  if (!msg?.content) throw new AIProviderError('OpenAI returned an empty response')
  return msg.content
}

export const openaiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI',
  supportsNativePdf: false, // PDFs are rendered to page images first
  defaultModel: 'gpt-4o-mini',
  keyPlaceholder: 'sk-…',
  keyHelpUrl: 'https://platform.openai.com/api-keys',

  async validateKey(key) {
    const r = await fetch(`${BASE}/models?limit=1`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!r.ok) throw new AIProviderError('This OpenAI API key was rejected')
  },

  async extract(doc: PreparedDoc, key, model) {
    const content: unknown[] = (doc.images ?? []).map((img) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${img}` },
    }))
    content.push({ type: 'text', text: extractionPrompt() })
    const text = await callOpenAI(key, {
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    })
    return parseJsonLoose(text)
  },

  async chat(system, messages: ChatMsg[], key, model) {
    return callOpenAI(key, {
      model,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role, content: m.text })),
      ],
    })
  },
}
