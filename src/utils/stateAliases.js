const STATE_ALIASES = new Map([
  ['nueva york', 'New York'],
  ['nueva jersey', 'New Jersey'],
  ['nuevo mexico', 'New Mexico'],
  ['carolina del norte', 'North Carolina'],
  ['carolina del sur', 'South Carolina'],
  ['dakota del norte', 'North Dakota'],
  ['dakota del sur', 'South Dakota'],
  ['pensilvania', 'Pennsylvania'],
  ['massachuse', 'Massachusetts'],
  ['massachuset', 'Massachusetts'],
  ['massachusets', 'Massachusetts'],
  ['masachussetts', 'Massachusetts'],
  ['massachussetts', 'Massachusetts'],
])

export function getCanonicalStateAlias(value = '') {
  const normalized = normalizeAlias(value)

  for (const [alias, state] of STATE_ALIASES) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized)) return state
  }

  return ''
}

function normalizeAlias(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
