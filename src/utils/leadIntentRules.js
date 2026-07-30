export function isReboundEffectQuestion(content = '') {
  const normalized = String(content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  return /\b(rebound effect|rebound|efecto rebote|efeito rebote)\b/.test(normalized)
}
