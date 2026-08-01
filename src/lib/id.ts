const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 12-char random id, URL/filename safe. */
export function newId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length]
  return id
}
