function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function hasAffordabilityObjection(content = '') {
  const text = normalize(content)
  return [
    /\b(expensive|too expensive|too much|costly|cannot afford|cant afford|can t afford|cannot pay|can t pay|pricey|out of my budget)\b/,
    /\b(caro|cara|costoso|costosa|demasiado (?:caro|cara)|mucho dinero|mucho para mi|no puedo pagarlo|no puedo pagar|no me alcanza|fuera de mi alcance)\b/,
    /\b(caro|cara|muito caro|muito dinheiro|nao posso pagar|fora do meu alcance)\b/,
  ].some((pattern) => pattern.test(text))
}

export function isContextualAffordabilityObjection(content = '', messages = []) {
  const text = normalize(content)
  const refersBackToUnaffordablePrice = /\b(no puedo con eso|no puedo hacerlo|sigue siendo mucho|eso es demasiado|i can t do that|i cannot do that|still too much|nao consigo|nao posso com isso)\b/.test(text)
  if (!refersBackToUnaffordablePrice) return false

  return [...messages].reverse().slice(0, 6).some((message) => hasAffordabilityObjection(message?.content))
}
