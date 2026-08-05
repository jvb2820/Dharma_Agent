export const SUPPLEMENT_CATALOG = [
  ['Hydrolyzed Collagen Peptides, Unflavored', '$39.90', 'Mix 1 scoop with 8–10 oz of water or another beverage daily.'],
  ['MCT Fat Burner', '$33.90 (reg. $49.90)', 'Take 2 capsules with 8 oz of water before breakfast and 2 before dinner; maximum 4 daily.'],
  ['Bloat Away Probiotic 40 Billion', '$24.90 (reg. $33.90)', 'Take 2 capsules daily—preferably 1 during the day and 1 in the evening.'],
  ['Berberine+ HCL 97%', '$39.99 (reg. $59.00)', 'Take 2 capsules daily.'],
  ['Complete Daily Multivitamin', '$33.90', 'Take 2 capsules in the morning with a meal.'],
  ['Max Detox', '$24.90 (reg. $33.90)', 'Take 2 capsules daily—preferably 1 during the day and 1 in the evening.'],
  ['NAD+ Cellular Energy', '$39.90 (reg. $59.90)', 'Take 2 capsules daily with 6 oz of water.'],
  ['Vanilla Whey Protein Isolate', '$49.90 (reg. $59.90)', 'Mix 2 scoops with 6–8 oz of water or another beverage daily.'],
  ['Gut Boost Pro', '$24.90 (reg. $33.90)', 'Take 1 capsule twice daily, preferably 20–30 minutes before a meal.', true],
  ['Beauty Boost—Hair, Skin & Nails', '$33.90', 'Take 2 capsules daily with food. Keep at least 1 hour apart from medications.'],
  ['Omega-3 Fish Oil', '$33.90', 'Take 1 softgel twice daily with meals.'],
  ['Maca Plus', '$24.90', 'Take 2 capsules once daily, preferably 20–30 minutes before a meal.'],
  ['Colon Gentle Cleanse', '$33.90', 'Mix 1 sachet with 200 ml of non-carbonated water and drink immediately, once or twice daily between meals.'],
  ['Vitamin D3 2,000 IU', '$24.90', 'Take 1 softgel daily.'],
  ['Chocolate Whey Isolate', '$47.90 (reg. $59.90)', 'Mix 2 scoops with 6–8 oz of water or another beverage daily.'],
  ['Energy Oral Strips', '$29.90 (reg. $33.90)', 'Place 1 strip on the tongue and let it dissolve; maximum 1 daily.'],
  ['Sleep Oral Strips', '$29.90 (reg. $33.90)', 'Dissolve 1 strip on the tongue, preferably before bed; maximum 1 daily.'],
  ['Vanilla Collagen Creamer', '$39.90', 'Mix 2 scoops with 8–10 oz of a hot or cold beverage.'],
  ['Creatine', '$33.90 (reg. $39.90)', 'For the first 5 days, mix 1 measure with 8 oz of water or juice 4 times daily. Afterward, take 1 measure once or twice daily.', true],
  ['Brain & Focus Formula', '$24.90', 'Take 2 capsules once daily, preferably 20–30 minutes before a meal with 8 oz of water.', true],
  ['Bone & Heart Support', '$24.90', 'Take 1 capsule twice daily, preferably 20–30 minutes before a meal.'],
  ['Chocolate Collagen Peptides', '$39.90', 'Mix 2 scoops with 8–10 oz of a beverage.'],
  ['Magnesium Glycinate', '$33.90', 'Take 3 capsules once daily.'],
  ['Bloom Wow Probiotic & Prebiotic Drink', '', ''], ['Moon Plus Mood Complex', '', ''],
  ['Vitamin D3 10,000 IU', '', 'Use only according to clinician or label guidance because this is a high dose.'],
  ['Sleep Gel', '', ''], ['Energy Gel Rings', '', ''], ['Apple Cider Vinegar Capsules', '$39.00', ''],
  ['Hydraglow Powder—Peach Mango', '', 'Mix 1 scoop with 14–20 oz of water; 2 scoops may be mixed with 28–40 oz.'],
  ['Hydraglow Powder—Lychee', '', 'Mix 1 scoop with 14–20 oz of water.'],
  ['Hydraglow Powder—Lemonade', '', 'Mix 1 scoop with 14–20 oz of water; 2 scoops may be mixed with 28–40 oz.'],
].map(([name, price, directions, soldOut = false]) => ({ name, price, directions, soldOut }))

const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function isSupplementPriceOrDirectionsQuestion(content = '') {
  return /\b(price|prices|cost|costs|how much|take|use|directions|dose|precio|precios|cuanto|cuesta|costo|tomar|toma|usar|usa|dosis|como se|preco|quanto|custa)\b/.test(normalize(content))
}

export function isContextualSupplementQuestion(content = '', messages = []) {
  if (!isSupplementPriceOrDirectionsQuestion(content)) return false
  return [...messages].reverse().slice(0, 6).some(({ content: prior = '' }) => /\b(supplement|supplements|suplemento|suplementos|berberine|berberina|fat burner|collagen|colageno|probiotic|vitamin|creatine|creatina|protein|proteina)\b/.test(normalize(prior)))
}

export function buildSupplementCatalogAnswer(language, content = '') {
  const spanish = language === 'Latin American Spanish'
  const query = normalize(content)
  const asksDirections = /\b(take|use|directions|dose|tomar|toma|usar|usa|dosis|como se)\b/.test(query)
  const aliases = query
    .replace(/\bberberina\b/g, 'berberine')
    .replace(/\bcolageno\b/g, 'collagen')
    .replace(/\bcreatina\b/g, 'creatine')
    .replace(/\bmagnesio\b/g, 'magnesium')
    .replace(/\bproteina\b/g, 'protein')
  const matches = SUPPLEMENT_CATALOG.filter(({ name }) => normalize(name).split(' ').filter((token) => token.length > 3).some((token) => aliases.includes(token)))
  const items = matches.length ? matches : SUPPLEMENT_CATALOG
  const heading = spanish ? (matches.length ? 'Claro. Esta es la información del producto:' : 'Claro. Este es nuestro catálogo de suplementos:') : (matches.length ? 'Of course. Here is the product information:' : 'Of course. Here is our supplement catalog:')
  const lines = items.map((item) => {
    const price = item.price || (spanish ? 'precio no listado' : 'price not listed')
    const stock = item.soldOut ? (spanish ? ' — agotado' : ' — sold out') : ''
    const directions = asksDirections && item.directions ? ` ${spanish ? 'Cómo tomarlo' : 'Directions'}: ${item.directions}` : ''
    return `- ${item.name}: ${price}${stock}.${directions}`
  })
  const safety = spanish ? 'Los suplementos no garantizan una pérdida de 50 lb ni sustituyen la orientación médica. Podemos ayudarte a elegir según tu meta, pero no voy a asumir cuáles debes tomar.' : 'Supplements do not guarantee a 50 lb loss or replace medical guidance. We can help narrow the options based on your goal, but I will not assume which ones you should take.'
  return [heading, ...lines, '', safety].join('\n')
}
