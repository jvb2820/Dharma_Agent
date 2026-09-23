export const GLP1_PLAN_PRICE = 589

export function buildGlp1PricingAnswer(_content = '', language = 'English') {
  void _content
  const lang = String(language || '').toLowerCase()

  if (lang.includes('spanish') || lang === 'es') {
    return `Tenemos un plan de alrededor de $${GLP1_PLAN_PRICE}. Durante la llamada de análisis gratuita, nuestro especialista te explicará los demás precios y las opciones disponibles según lo que necesites, para ayudarte a encontrar el plan que mejor se adapte a ti.`
  }

  if (lang.includes('portuguese') || lang === 'pt') {
    return `Temos um plano na faixa de $${GLP1_PLAN_PRICE}. Durante a chamada de análise gratuita, nosso especialista explicará os outros preços e as opções disponíveis de acordo com o que você precisa, para ajudar a encontrar o plano mais adequado para você.`
  }

  return `We have a plan in the $${GLP1_PLAN_PRICE} range. During the free discovery call, our specialist will explain the other prices and available options based on what you need, so they can help find the plan that best fits you.`
}
