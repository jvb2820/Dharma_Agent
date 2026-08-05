export function isReboundEffectQuestion(content = '') {
  const normalized = normalizeLeadIntentText(content)

  return /\b(rebound effect|rebound|efecto rebote|efeito rebote)\b/.test(normalized)
}

export function isOralProductQuestion(content = '') {
  const normalized = normalizeLeadIntentText(content)

  return /\b(pill|pills|tablet|tablets|capsule|capsules|pastilla|pastillas|capsula|capsulas|comprimido|comprimidos)\b/.test(
    normalized,
  )
}

export function isSupplementProductQuestion(content = '') {
  const normalized = normalizeLeadIntentText(content)

  return /\b(berberine|berberina|fat burner|mct fat burner|slim boost|supplement|supplements|suplemento|suplementos|collagen|colageno|probiotic|probiotico|multivitamin|multivitamina|detox|nad|whey|protein|proteina|omega|maca|creatine|creatina|magnesium|magnesio|hydraglow|vitamin d3|oral strips|gel rings)\b/.test(
    normalized,
  )
}

export function isGhkProductQuestion(content = '') {
  const normalized = normalizeLeadIntentText(content)

  return /\bghk(?: cu)?\b/.test(normalized)
}

function normalizeLeadIntentText(content) {
  return String(content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
