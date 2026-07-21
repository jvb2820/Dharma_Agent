export function hasExplicitNamedPersonMedicationQuestion(text = '') {
  const normalized = normalizePrivacyText(text)
  const treatment =
    '(?:medication|medicine|treatment|program|injection|semaglutide|tirzepatide|zepbound|medicamento|tratamiento|programa|inyeccion|tratamento|injecao)'
  const name = "[a-zà-ÿ][a-zà-ÿ'-]{2,}"

  return [
    new RegExp(`\\b${treatment}\\b[\\s\\S]{0,50}\\b(?:did|does)\\s+${name}\\s+${name}\\b`),
    new RegExp(`\\b(?:did|does)\\s+${name}\\s+${name}\\s+(?:have|use|used|take|took)\\b[\\s\\S]{0,50}\\b${treatment}\\b`),
    new RegExp(`\\b(?:que|cual)\\s+${treatment}\\b[\\s\\S]{0,50}\\b(?:uso|utilizo|tomo|tenia)\\s+${name}\\s+${name}\\b`),
    new RegExp(`\\b${treatment}\\b[\\s\\S]{0,50}\\b(?:de|para)\\s+${name}\\s+${name}\\b`),
    new RegExp(`\\b(?:qual|que)\\s+${treatment}\\b[\\s\\S]{0,50}\\b${name}\\s+${name}\\s+(?:usou|tomou|tinha)\\b`),
    new RegExp(`\\b${treatment}\\b[\\s\\S]{0,50}\\b${name}\\s+${name}\\s+(?:used|uso|utilizo|usou|tomou)\\b`),
  ].some((pattern) => pattern.test(normalized))
}

function normalizePrivacyText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
