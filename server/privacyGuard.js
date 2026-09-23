import { hasNamedPersonTreatmentQuestion } from '../src/utils/privacyRules.js'

export function hasExplicitNamedPersonMedicationQuestion(text = '') {
  if (hasNamedPersonTreatmentQuestion(text)) return true

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

export function isExplicitThirdPartyMedicationQuestion(text = '') {
  const normalized = normalizePrivacyText(text)
  const person = '(?:(?:this|that|the|your|a specific|one of your|ese|esa|aquel|aquella|el|la|su|sua|seu)\\s+(?:customer|client|patient|cliente|paciente)|(?:a|the|this|that)?\\s*(?:celebrity|public figure|celebridad|figura publica)|she|he|ella|ele|ela)'
  const treatment = '(?:medication|medications|medicine|treatment|treatments|program|injection|injections|semaglutide|tirzepatide|zepbound|medicamento|medicamentos|tratamiento|tratamientos|programa|inyeccion|inyecciones|tratamento|tratamentos|injecao|injecoes)'

  return [
    new RegExp(`\\b${person}\\b[\\s\\S]{0,80}\\b${treatment}\\b`),
    new RegExp(`\\b${treatment}\\b[\\s\\S]{0,80}\\b${person}\\b`),
  ].some((pattern) => pattern.test(normalized))
}

export function isGeneralMedicationSafetyQuestion(text = '') {
  if (hasExplicitNamedPersonMedicationQuestion(text) || isExplicitThirdPartyMedicationQuestion(text)) return false

  const normalized = normalizePrivacyText(text)
  const asksSafety = [
    /\b(is|are)\b[\s\S]{0,40}\b(safe|effective)\b/,
    /\b(is it safe|safe to take|safe for me|medication safety|treatment safety)\b/,
    /\b(es seguro|es segura|seguro tomar|segura para tomar|tratamiento seguro|medicamento seguro)\b/,
    /\b(e seguro|e segura|seguro tomar|segura para tomar|tratamento seguro|medicamento seguro)\b/,
  ].some((pattern) => pattern.test(normalized))
  const thirdParty = /\b(client|patient|cliente|paciente|she|he|they|ella|ellos|ellas|ele|ela)\b/.test(normalized)

  return asksSafety && !thirdParty
}

export function isGeneralProductInfoRequest(text = '') {
  if (hasExplicitNamedPersonMedicationQuestion(text) || isExplicitThirdPartyMedicationQuestion(text)) {
    return false
  }

  const normalized = normalizePrivacyText(text)

  if (/\b(?:person|customer|client|patient|celebrity|public figure|persona|cliente|paciente|celebridad|figura publica|pessoa)\b/.test(normalized)) {
    return false
  }

  return [
    /\b(?:can|could|may) i (?:get|have) more (?:info|information)(?: on| about)? (?:this|that|it)\b/,
    /\b(?:tell|give) me more (?:about )?(?:this|that|it)\b/,
    /\bwhat is (?:this|that) about\b/,
    /\b(?:puedo|podria) (?:tener|recibir|saber) mas (?:informacion )?(?:sobre )?(?:esto|eso)\b/,
    /\b(?:me puedes|puedes) (?:dar|contar) mas (?:informacion )?(?:sobre )?(?:esto|eso)\b/,
    /\b(?:posso|poderia) (?:ter|receber|saber) mais (?:informacoes )?(?:sobre )?(?:isto|isso)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function normalizePrivacyText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
