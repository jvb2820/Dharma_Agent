import { createSupabaseServerClient } from './supabaseClient.js'

export async function loadRespondSession(contactId, fallback = null) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId) return fallback

  const { data, error } = await supabase
    .from('respond_conversation_sessions')
    .select('session_data, expires_at')
    .eq('contact_id', String(contactId))
    .maybeSingle()

  if (error) {
    console.warn(`Unable to load Respond session: ${error.message}`)
    return fallback
  }

  if (!data || Date.parse(data.expires_at) <= Date.now()) return fallback
  return data.session_data && typeof data.session_data === 'object' ? data.session_data : fallback
}

export async function saveRespondSession(contactId, session) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId || !session) return session

  const lastInteractionAt = Number(session.lastInteractionAt || Date.now())
  const expiresAt = new Date(lastInteractionAt + getRespondSessionTtlMs()).toISOString()
  const { error } = await supabase.from('respond_conversation_sessions').upsert({
    contact_id: String(contactId),
    session_data: session,
    last_interaction_at: new Date(lastInteractionAt).toISOString(),
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  })

  if (error) throw new Error(`Unable to save Respond session: ${error.message}`)
  return session
}

export async function deleteRespondSession(contactId) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId) return

  const { error } = await supabase
    .from('respond_conversation_sessions')
    .delete()
    .eq('contact_id', String(contactId))

  if (error) throw new Error(`Unable to delete Respond session: ${error.message}`)
}

export async function clearRespondSessions() {
  const supabase = createSupabaseServerClient()
  if (!supabase) return

  const { error } = await supabase
    .from('respond_conversation_sessions')
    .delete()
    .not('contact_id', 'is', null)

  if (error) throw new Error(`Unable to clear Respond sessions: ${error.message}`)
}

function getRespondSessionTtlMs() {
  const hours = Number(process.env.RESPOND_SESSION_PERSISTENCE_HOURS || 48)
  return (Number.isFinite(hours) && hours > 0 ? hours : 48) * 60 * 60 * 1000
}
