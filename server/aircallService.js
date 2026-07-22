const AIRCALL_API_BASE_URL = 'https://api.aircall.io'
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

let usersCache = null
const numberCache = new Map()

export async function getAircallNumberForSpecialist(candidates = []) {
  const users = await getAircallUsers()
  const user = findMatchingUser(users, candidates)
  if (!user) return ''

  const cached = numberCache.get(user.id)
  if (isFresh(cached)) return cached.value

  try {
    const data = await aircallGet(`/v2/users/${encodeURIComponent(user.id)}/numbers?per_page=100`)
    const numbers = data.numbers || []
    const selected = numbers.find((number) => Number(number.id) === Number(user.default_number_id)) ||
      numbers.find((number) => number.open !== false) || numbers[0]
    const value = String(selected?.digits || '').trim()
    numberCache.set(user.id, { value, fetchedAt: Date.now() })
    return value
  } catch (error) {
    if (cached?.value) return cached.value
    throw error
  }
}

async function getAircallUsers() {
  if (isFresh(usersCache)) return usersCache.value
  try {
    const data = await aircallGet('/v2/users?per_page=100')
    const value = data.users || []
    usersCache = { value, fetchedAt: Date.now() }
    return value
  } catch (error) {
    if (usersCache?.value?.length) return usersCache.value
    throw error
  }
}

function findMatchingUser(users, candidates) {
  const normalizedCandidates = candidates.map(normalizeName).filter(Boolean)
  return users.find((user) => {
    const userName = normalizeName(user.name)
    return normalizedCandidates.some((candidate) =>
      userName === candidate || userName.includes(candidate) || candidate.includes(userName))
  })
}

async function aircallGet(path) {
  const id = process.env.AIRCALL_API_ID
  const token = process.env.AIRCALL_API_TOKEN
  if (!id || !token) throw new Error('Aircall API credentials are not configured.')

  const authorization = Buffer.from(`${id}:${token}`).toString('base64')
  const response = await fetch(`${AIRCALL_API_BASE_URL}${path}`, {
    headers: { Authorization: `Basic ${authorization}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `Aircall request failed with ${response.status}.`)
  return data
}

function isFresh(entry) {
  const ttl = Number(process.env.AIRCALL_NUMBER_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS)
  return Boolean(entry && Date.now() - entry.fetchedAt < ttl)
}

function normalizeName(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

export function clearAircallCacheForTests() {
  usersCache = null
  numberCache.clear()
}
