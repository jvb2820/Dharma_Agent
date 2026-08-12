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

export function isTreatmentPackageInclusionsQuestion(content = '') {
  const normalized = normalizeLeadIntentText(content)
  const packageOrTreatment = /\b(package|packages|treatment|treatments|glp 1|program|paquete|paquetes|tratamiento|tratamientos|programa|pacote|pacotes|tratamento|tratamentos)\b/.test(normalized)
  const inclusionOrPriceStructure = [
    /\b(what else|what is included|what does it include|included in|come with|comes with|just the cost|separately|cost increase|price increase|supplements included|support included)\b/,
    /\b(que mas|que incluye|incluido en|incluida en|viene con|solo es el costo|por separado|aumenta el costo|aumenta el precio|suplementos incluidos|soporte incluido)\b/,
    /\b(o que mais|o que inclui|incluido no|incluida no|vem com|apenas o custo|separadamente|o custo aumenta|o preco aumenta|suplementos incluidos|suporte incluido)\b/,
  ].some((pattern) => pattern.test(normalized))

  return packageOrTreatment && inclusionOrPriceStructure
}

function normalizeLeadIntentText(content) {
  return String(content || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
