function normalizeInjectionFrequencyText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function isInjectionFrequencyQuestion(content = '') {
  const normalized = normalizeInjectionFrequencyText(content)

  if (!normalized) return false

  return [
    /\b(how many|how often|how frequently)\b[\s\S]{0,50}\b(injection|injections|inject|dose|doses)\b/,
    /\b(injection|injections|inject|dose|doses)\b[\s\S]{0,35}\b(per|each|every|a)\b[\s\S]{0,15}\b(week|month)\b/,
    /\b(cuantas|cuantos|cada cuanto|con que frecuencia)\b[\s\S]{0,50}\b(inyeccion|inyecciones|inyectar|dosis)\b/,
    /\b(inyeccion|inyecciones|inyectar|dosis)\b[\s\S]{0,35}\b(por|cada|al)\b[\s\S]{0,15}\b(semana|mes)\b/,
    /\b(quantas|quantos|com que frequencia)\b[\s\S]{0,50}\b(injecao|injecoes|aplicacao|aplicacoes|dose|doses)\b/,
    /\b(injecao|injecoes|aplicacao|aplicacoes|dose|doses)\b[\s\S]{0,35}\b(por|cada)\b[\s\S]{0,15}\b(semana|mes)\b/,
  ].some((pattern) => pattern.test(normalized))
}

export function getInjectionFrequencyAnswer(customerLanguage = '') {
  if (customerLanguage === 'Latin American Spanish') {
    return 'La Semaglutida y la Tirzepatida generalmente se administran en una inyeccion por semana. En la llamada gratuita de analisis, nuestro especialista puede explicarte con mas detalle como funciona el tratamiento y responder tus preguntas.'
  }

  if (customerLanguage === 'Portuguese') {
    return 'A Semaglutida e a Tirzepatida geralmente sao administradas em uma injecao por semana. Na chamada gratuita de analise, nosso especialista pode explicar com mais detalhes como funciona o tratamento e responder as suas perguntas.'
  }

  return 'Semaglutide and Tirzepatide are generally administered as one injection per week. During the free discovery call, our specialist can explain how the treatment works in more detail and answer your questions.'
}
