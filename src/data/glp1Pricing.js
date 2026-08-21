export const GLP1_STARTING_MONTHLY_PRICE = 235

export const GLP1_PLANS = {
  semaglutide: [
    { label: 'Microdose - 2 months', price: 298 },
    { label: 'Semaglutide 10mg - 1 month single purchase', price: 399 },
    { label: 'Starter package - 3 months', price: 597 },
    { label: 'Starter package - 6 months', price: 1014 },
    { label: 'Starter package - 12 months', price: 1788 },
  ],
  tirzepatide: [
    { label: 'Microdose - 2 months', price: 470 },
    { label: 'Tirzepatide 60mg - 1 month single purchase', price: 599 },
    { label: 'Starter package - 3 months', price: 897 },
    { label: 'Starter package - 6 months', price: 1494 },
    { label: 'Starter package - 12 months', price: 2820 },
  ],
}

export function buildGlp1PricingAnswer(content = '', language = 'English') {
  const normalized = normalize(content)
  const lang = String(language || '').toLowerCase()
  const spanish = lang.includes('spanish') || lang === 'es'
  const portuguese = lang.includes('portuguese') || lang === 'pt'
  const asksSemaglutide = /\bsemaglutid/.test(normalized)
  const asksTirzepatide = /\btirzepatid/.test(normalized)
  const asksForAll = asksSemaglutide && asksTirzepatide ||
    /\b(all|every|both|compare|comparison|full list|all options|todos|todas|ambos|comparar|comparacion|lista completa|todas as opcoes|comparacao)\b/.test(normalized)

  if (asksForAll) {
    return [
      generalOpening(spanish, portuguese),
      formatProductPlans('Semaglutide', GLP1_PLANS.semaglutide, spanish, portuguese),
      formatProductPlans('Tirzepatide', GLP1_PLANS.tirzepatide, spanish, portuguese),
      specialistClose(spanish, portuguese),
    ].join('\n\n')
  }

  if (asksSemaglutide) {
    return `${formatProductPlans('Semaglutide', GLP1_PLANS.semaglutide, spanish, portuguese)}\n\n${specialistClose(spanish, portuguese)}`
  }

  if (asksTirzepatide) {
    return `${formatProductPlans('Tirzepatide', GLP1_PLANS.tirzepatide, spanish, portuguese)}\n\n${specialistClose(spanish, portuguese)}`
  }

  return `${generalOpening(spanish, portuguese)} ${specialistClose(spanish, portuguese)}`
}

function generalOpening(spanish, portuguese) {
  if (spanish) return `Tenemos planes personalizados de GLP-1 desde $${GLP1_STARTING_MONTHLY_PRICE}/mes, con opciones de Semaglutide y Tirzepatide de diferentes duraciones.`
  if (portuguese) return `Temos planos personalizados de GLP-1 a partir de $${GLP1_STARTING_MONTHLY_PRICE}/mês, com opções de Semaglutide e Tirzepatide de diferentes durações.`
  return `We have personalized GLP-1 plans starting at $${GLP1_STARTING_MONTHLY_PRICE}/month, with Semaglutide and Tirzepatide options in different durations.`
}

function formatProductPlans(product, plans, spanish, portuguese) {
  const heading = spanish
    ? `Precios de ${product}:`
    : portuguese ? `Preços de ${product}:` : `${product} prices:`
  return [heading, ...plans.map((plan) => `- ${localizeLabel(plan.label, spanish, portuguese)}: ${formatUsd(plan.price)}`)].join('\n')
}

function localizeLabel(label, spanish, portuguese) {
  if (spanish) return label
    .replace('Microdose', 'Microdosis')
    .replace('months', 'meses')
    .replace('month single purchase', 'mes, compra única')
    .replace('Starter package', 'Paquete inicial')
  if (portuguese) return label
    .replace('Microdose', 'Microdose')
    .replace('months', 'meses')
    .replace('month single purchase', 'mês, compra única')
    .replace('Starter package', 'Pacote inicial')
  return label
}

function specialistClose(spanish, portuguese) {
  if (spanish) return 'Durante la llamada de análisis gratuita, nuestro especialista te explicará los productos, las diferencias entre los planes y las opciones que pueden ajustarse a tu meta.'
  if (portuguese) return 'Durante a chamada de análise gratuita, nosso especialista explicará os produtos, as diferenças entre os planos e as opções que podem se adequar ao seu objetivo.'
  return 'During the free discovery call, our specialist will explain the products, the differences between the plans, and the options that may fit your goal.'
}

function formatUsd(value) {
  return `$${Number(value).toLocaleString('en-US')}`
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
