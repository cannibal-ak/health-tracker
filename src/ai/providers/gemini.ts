import { AIProviderError, parseJsonLoose, type AIProvider, type ChatMsg, type PreparedDoc } from '../types'
import { extractionPrompt } from '../prompts'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function callGemini(
  key: string,
  model: string,
  body: Record<string, unknown>,
): Promise<string> {
  const r = await fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    if (r.status === 400 && text.includes('API key not valid'))
      throw new AIProviderError('This Gemini API key is not valid')
    if (r.status === 429) throw new AIProviderError('Gemini rate limit reached — try again in a minute')
    throw new AIProviderError(`Gemini error ${r.status}: ${text.slice(0, 200)}`)
  }
  const json = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  }
  const candidate = json.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) {
    throw new AIProviderError(
      candidate?.finishReason === 'SAFETY'
        ? 'Gemini declined to process this document'
        : 'Gemini returned an empty response',
    )
  }
  return text
}

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  supportsNativePdf: true,
  defaultModel: 'gemini-2.5-flash',
  keyPlaceholder: 'AIza…',
  keyHelpUrl: 'https://aistudio.google.com/apikey',

  async validateKey(key) {
    const r = await fetch(`${BASE}/models?pageSize=1`, {
      headers: { 'x-goog-api-key': key },
    })
    if (!r.ok) throw new AIProviderError('This Gemini API key was rejected')
  },

  async extract(doc: PreparedDoc, key, model) {
    const parts: unknown[] = []
    if (doc.kind === 'pdf' && doc.pdfBase64) {
      parts.push({ inlineData: { mimeType: 'application/pdf', data: doc.pdfBase64 } })
    } else {
      for (const img of doc.images ?? []) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } })
      }
    }
    parts.push({ text: extractionPrompt() })
    const text = await callGemini(key, model, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json' },
    })
    return parseJsonLoose(text)
  },

  async chat(system, messages: ChatMsg[], key, model) {
    return callGemini(key, model, {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      })),
    })
  },
}
