import { createSupabaseServerClient } from './supabaseClient.js'

const DEFAULT_CLAIM_TTL_SECONDS = 180

export function getSlotClaimKey(option = {}) {
  const sellerSlug = String(option.sellerSlug || '').trim()
  const startTime = Number(option.startTime)
  return sellerSlug && Number.isFinite(startTime) ? `${sellerSlug}:${startTime}` : ''
}

export function buildPersistedSlotClaim(claim = {}, contactId = '') {
  return {
    slotKey: String(claim.slotKey || ''),
    contactId: String(contactId || ''),
    claimedAt: Number(claim.claimedAt || Date.now()),
    expiresAt: String(claim.expiresAt || ''),
    persisted: Boolean(claim.persisted),
  }
}

export async function acquireSlotClaim({ option, contactId, ttlSeconds = getSlotClaimTtlSeconds() } = {}) {
  const slotKey = getSlotClaimKey(option)
  const holder = String(contactId || '').trim()
  if (!slotKey || !holder) throw new Error('A slot and contact are required to claim an appointment.')

  const supabase = createSupabaseServerClient()
  const claimedAt = Date.now()
  const expiresAt = new Date(claimedAt + ttlSeconds * 1000).toISOString()
  if (!supabase) return { acquired: true, slotKey, persisted: false, claimedAt, expiresAt }

  const { data, error } = await supabase.rpc('acquire_respond_slot_claim', {
    claim_slot_key: slotKey,
    claim_contact_id: holder,
    claim_seller_slug: String(option.sellerSlug),
    claim_start_at: new Date(Number(option.startTime)).toISOString(),
    claim_ttl_seconds: ttlSeconds,
  })

  if (error) throw new Error(`Unable to acquire appointment slot claim: ${error.message}`)
  return { acquired: Boolean(data), slotKey, persisted: true, claimedAt, expiresAt }
}

export async function releaseSlotClaim({ slotKey, contactId } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !slotKey || !contactId) return

  const { error } = await supabase
    .from('respond_slot_claims')
    .delete()
    .eq('slot_key', slotKey)
    .eq('contact_id', String(contactId))

  if (error) console.warn(`Unable to release appointment slot claim: ${error.message}`)
}

export function getSlotClaimTtlSeconds() {
  const configured = Number(process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS || DEFAULT_CLAIM_TTL_SECONDS)
  return Number.isFinite(configured) && configured >= 30 ? Math.floor(configured) : DEFAULT_CLAIM_TTL_SECONDS
}
