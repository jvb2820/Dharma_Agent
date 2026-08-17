export function hasNamedPersonTreatmentQuestion(text = '') {
  const raw = String(text || '')
  const normalized = normalizePrivacyText(raw)
  const treatmentSignal = /\b(medication|medicine|treatment|program|injection|semaglutide|tirzepatide|zepbound|same thing|same things|same treatment|same medication|use the same|medicamento|tratamiento|tratamento|programa|inyeccion|injecao|mismo|misma|mesmo|mesma)\b/.test(normalized)
  const useOrComparisonSignal = /\b(use|using|used|take|taking|took|same as|like|what she|what he|uso|utilizo|utiliza|tomo|igual que|lo mismo|usou|usa|tomou|mesmo que)\b/.test(normalized)
  const generalMedicationQuestion = /\b(may i know|can i know|want to know|know more|more about|tell me about|your medications?|your treatments?|saber mas|mas sobre|saber mais|mais sobre)\b/.test(normalized)
  const explicitPersonReference = /\b(client|patient|cliente|paciente|she|he|they|ella|ellos|ellas|ele|ela|same as|same things as|same treatment as|igual que|mesmo que)\b/.test(normalized)
  const identifiableThirdParty = '(?:(?:this|that|the|your|a specific|one of your|ese|esa|aquel|aquella|el|la|su|sua|seu)\\s+(?:customer|client|patient|cliente|paciente)|(?:a|the|this|that)?\\s*(?:celebrity|public figure|celebridad|figura publica)|she|he|ella|ele|ela)'
  const thirdPartyTreatment = '(?:medication|medications|medicine|treatment|treatments|program|injection|injections|medicamento|medicamentos|tratamiento|tratamientos|programa|inyeccion|inyecciones|tratamento|tratamentos|injecao|injecoes)'
  const explicitThirdPartyTreatment = [
    new RegExp(`\\b${identifiableThirdParty}\\b[\\s\\S]{0,80}\\b${thirdPartyTreatment}\\b`),
    new RegExp(`\\b${thirdPartyTreatment}\\b[\\s\\S]{0,80}\\b${identifiableThirdParty}\\b`),
  ].some((pattern) => pattern.test(normalized))

  if (explicitThirdPartyTreatment) return true

  if (generalMedicationQuestion && !explicitPersonReference) return false

  const knownProducts = new Set(['semaglutide', 'tirzepatide', 'zepbound', 'wegovy', 'ghk'])
  const capitalizedNames = (raw.match(/\b[A-Z][a-zA-ZÀ-ÿ'-]{2,}\b/g) || [])
    .map((word) => normalizePrivacyText(word))
    .filter((word) => !knownProducts.has(word) && !/^(no|i|what|which|que|cual|es|el|la|the|before|may|can|know|more|about|your|my|please|tell)$/.test(word))
  const comparisonNameMatch = normalized.match(/\b(?:as|like|igual que|mesmo que)\s+([a-zà-ÿ][a-zà-ÿ'-]{2,})\s+([a-zà-ÿ][a-zà-ÿ'-]{2,})\b/)
  const lowercaseNameTreatmentMatch = [
    /\b(?:medication|medicine|treatment|program|injection|medicamento|tratamiento|tratamento|programa|inyeccion|injecao)\b[\s\S]{0,40}\b([a-z][a-z'-]{2,})\s+([a-z][a-z'-]{2,})\s+(?:had|has|used|uses|took|takes|received|got|uso|utilizo|tomo|tenia|usou|tomou|tinha)\b/,
    /\b([a-z][a-z'-]{2,})\s+([a-z][a-z'-]{2,})\s+(?:had|has|used|uses|took|takes|received|got|uso|utilizo|tomo|tenia|usou|tomou|tinha)\b[\s\S]{0,40}\b(?:medication|medicine|treatment|program|injection|medicamento|tratamiento|tratamento|programa|inyeccion|injecao)\b/,
  ].some((pattern) => pattern.test(normalized))
  const hasLikelyName = capitalizedNames.length >= 2 || Boolean(comparisonNameMatch) || lowercaseNameTreatmentMatch

  return hasLikelyName && (treatmentSignal || useOrComparisonSignal)
}

export function isTreatmentAcquisitionQuestion(text = '') {
  const normalized = normalizePrivacyText(text)

  return [
    /^(?:como|donde) (?:las|los|la|lo) (?:consigo|obtengo|compro|ordeno)$/,
    /^como puedo (?:conseguirlas|conseguirlos|obtenerlas|obtenerlos|comprarlas|comprarlos|ordenarlas|ordenarlos)$/,
    /^(?:donde|como) puedo (?:conseguir|obtener|comprar|ordenar) (?:las|los|la|lo)$/,
  ].some((pattern) => pattern.test(normalized))
}

export function containsNamedPersonTreatmentDisclosure(text = '') {
  const normalized = normalizePrivacyText(text)
  return hasNamedPersonTreatmentQuestion(text) || (
    /\b(maria cristina|dayanara torres)\b/.test(normalized) &&
    /\b(uses|using|takes|taking|may be using|probably uses|semaglutide|tirzepatide|zepbound|usa|utiliza|puede usar|podria usar|toma|usou|utiliza)\b/.test(normalized)
  )
}

function normalizePrivacyText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
