export function hasNamedPersonTreatmentQuestion(text = '') {
  const raw = String(text || '')
  const normalized = normalizePrivacyText(raw)
  const treatmentSignal = /\b(medication|medicine|treatment|program|injection|semaglutide|tirzepatide|zepbound|same thing|same things|same treatment|same medication|use the same|medicamento|tratamiento|tratamento|programa|inyeccion|injecao|mismo|misma|mesmo|mesma)\b/.test(normalized)
  const useOrComparisonSignal = /\b(use|using|used|take|taking|took|same as|like|what she|what he|uso|utilizo|utiliza|tomo|igual que|lo mismo|como|usou|usa|tomou|mesmo que)\b/.test(normalized)
  const generalMedicationQuestion = /\b(may i know|can i know|want to know|know more|more about|tell me about|your medications?|your treatments?|saber mas|mas sobre|saber mais|mais sobre)\b/.test(normalized)
  const explicitPersonReference = /\b(client|patient|cliente|paciente|she|he|they|ella|ellos|ellas|ele|ela|same as|same things as|same treatment as|igual que|mesmo que)\b/.test(normalized)

  if (generalMedicationQuestion && !explicitPersonReference) return false

  const knownProducts = new Set(['semaglutide', 'tirzepatide', 'zepbound', 'wegovy'])
  const capitalizedNames = (raw.match(/\b[A-Z][a-zA-ZÀ-ÿ'-]{2,}\b/g) || [])
    .map((word) => normalizePrivacyText(word))
    .filter((word) => !knownProducts.has(word) && !/^(no|i|what|which|que|cual|es|el|la|the|before|may|can|know|more|about|your|my|please|tell)$/.test(word))
  const comparisonNameMatch = normalized.match(/\b(?:as|like|como|que)\s+([a-zà-ÿ][a-zà-ÿ'-]{2,})\s+([a-zà-ÿ][a-zà-ÿ'-]{2,})\b/)
  const hasLikelyName = capitalizedNames.length >= 2 || Boolean(comparisonNameMatch)

  return hasLikelyName && (treatmentSignal || useOrComparisonSignal)
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
