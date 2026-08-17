import { randomUUID } from 'node:crypto'
import { createSupabaseServerClient } from './supabaseClient.js'

const LOCK_TTL_SECONDS = 300
const LOCK_WAIT_MS = 60_000

export async function withRespondContactLock({ contactId, messageId = '', task }) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return task()

  const ownerId = randomUUID()
  const acquired = await waitForContactLock(supabase, contactId, ownerId)
  if (!acquired) throw new Error(`Timed out waiting for Respond contact lock: ${contactId}`)

  let messageClaimed = false

  try {
    if (messageId) {
      const { data, error } = await supabase.rpc('claim_respond_webhook_message', {
        claim_contact_id: String(contactId),
        claim_message_id: String(messageId),
        claim_owner_id: ownerId,
        claim_ttl_seconds: LOCK_TTL_SECONDS,
      })
      if (error) throw new Error(`Unable to deduplicate Respond webhook message: ${error.message}`)
      if (!data) return { skippedDuplicate: true }
      messageClaimed = true
    }

    const result = await task()

    if (messageClaimed) {
      await supabase
        .from('respond_processed_messages')
        .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('contact_id', String(contactId))
        .eq('message_id', String(messageId))
        .eq('owner_id', ownerId)
    }

    return result
  } catch (error) {
    if (messageClaimed) {
      await supabase
        .from('respond_processed_messages')
        .delete()
        .eq('contact_id', String(contactId))
        .eq('message_id', String(messageId))
        .eq('owner_id', ownerId)
    }
    throw error
  } finally {
    await supabase
      .from('respond_contact_locks')
      .delete()
      .eq('contact_id', String(contactId))
      .eq('owner_id', ownerId)
  }
}

async function waitForContactLock(supabase, contactId, ownerId) {
  const deadline = Date.now() + LOCK_WAIT_MS

  do {
    const { data, error } = await supabase.rpc('acquire_respond_contact_lock', {
      lock_contact_id: String(contactId),
      lock_owner_id: ownerId,
      lock_ttl_seconds: LOCK_TTL_SECONDS,
    })
    if (error) throw new Error(`Unable to acquire Respond contact lock: ${error.message}`)
    if (data) return true
    await delay(250 + Math.floor(Math.random() * 150))
  } while (Date.now() < deadline)

  return false
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
