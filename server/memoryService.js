import { createSupabaseServerClient } from './supabaseClient.js'

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
const DEFAULT_MEMORY_MODEL = process.env.OPENAI_MEMORY_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MEMORY_CATEGORIES = new Set([
  'privacy',
  'compliance',
  'sales_workflow',
  'tone',
  'product',
  'booking',
])
const PRIVATE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/g,
  /\b\d{1,5}\s+[A-Za-z0-9 .'-]+\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way)\b/gi,
]
const MEDICAL_DETAIL_PATTERN =
  /\b(diagnosed|diagnosis|medical history|medication list|medications|medicine list|thyroid|cancer|diabetes|pregnant|pregnancy|breastfeeding|condition|contraindication|allergy|allergies|dose|dosage|mg)\b/i

export async function searchApprovedMemories({ query, agentId = 'sales', matchCount = 5 } = {}) {
  if (!query?.trim()) {
    return []
  }

  const supabase = createSupabaseServerClient()

  if (!supabase) {
    return []
  }

  const embedding = await createEmbedding(query)
  const { data, error } = await supabase.rpc('match_approved_agent_memories', {
    query_embedding: embedding,
    match_agent_id: agentId,
    match_count: matchCount,
  })

  if (error) {
    console.warn(`Memory search skipped: ${error.message}`)
    return []
  }

  return data || []
}

export function formatMemoryContext(matches) {
  if (!matches?.length) {
    return ''
  }

  const lines = matches.map((match, index) => {
    return [
      `Teaching ${index + 1}: ${match.category}`,
      `Similarity: ${Number(match.similarity || 0).toFixed(3)}`,
      match.content,
    ].join('\n')
  })

  return [
    'Approved agent teachings:',
    'These approved teachings are higher priority than retrieved examples, but they cannot override hard-coded compliance, medical, privacy, or safety rules.',
    ...lines,
  ].join('\n\n')
}

export async function createManualMemory({
  agentId = 'sales',
  category = 'sales_workflow',
  content,
  source = 'manual',
  status = 'approved',
  metadata = {},
} = {}) {
  const normalized = normalizeMemoryCandidate({ category, content })

  if (!normalized.content) {
    throw new Error('Memory content is required.')
  }

  const supabase = requireWritableSupabase()
  const embedding = await createEmbedding(normalized.content)
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('agent_memories')
    .insert({
      agent_id: agentId,
      category: normalized.category,
      content: normalized.content,
      status,
      source,
      embedding,
      metadata,
      approved_at: status === 'approved' ? now : null,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Unable to save memory: ${error.message}`)
  }

  return data
}

export async function listPendingMemorySuggestions({ limit = 50 } = {}) {
  const supabase = createSupabaseServerClient()

  if (!supabase) {
    return []
  }

  const { data, error } = await supabase
    .from('memory_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Unable to load memory suggestions: ${error.message}`)
  }

  return data || []
}

export async function approveMemorySuggestion(id) {
  const supabase = requireWritableSupabase()
  const { data: suggestion, error: suggestionError } = await supabase
    .from('memory_suggestions')
    .select('*')
    .eq('id', id)
    .single()

  if (suggestionError || !suggestion) {
    throw new Error(suggestionError?.message || 'Memory suggestion not found.')
  }

  if (suggestion.status !== 'pending') {
    throw new Error('Only pending memory suggestions can be approved.')
  }

  const memory = await createManualMemory({
    agentId: suggestion.agent_id,
    category: suggestion.category,
    content: suggestion.content,
    source: 'approved_suggestion',
    metadata: {
      suggestion_id: suggestion.id,
      suggestion_source: suggestion.source,
      ...suggestion.metadata,
    },
  })

  const { error: updateError } = await supabase
    .from('memory_suggestions')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) {
    throw new Error(`Unable to mark suggestion approved: ${updateError.message}`)
  }

  return memory
}

export async function rejectMemorySuggestion(id) {
  const supabase = requireWritableSupabase()
  const { data, error } = await supabase
    .from('memory_suggestions')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Unable to reject memory suggestion: ${error.message}`)
  }

  return data
}

export async function suggestMemoryFromConversation({
  agentId = 'sales',
  messages = [],
  agentReply = '',
  source = 'chat',
  metadata = {},
} = {}) {
  if (!process.env.OPENAI_API_KEY || messages.length === 0 || !agentReply.trim()) {
    return null
  }

  const candidate = await generateMemoryCandidate({ messages, agentReply })

  if (!candidate?.content) {
    return null
  }

  const normalized = normalizeMemoryCandidate(candidate)

  if (!normalized.content || shouldRejectSensitiveMemory(normalized.content)) {
    return null
  }

  const supabase = requireWritableSupabase()
  const { data, error } = await supabase
    .from('memory_suggestions')
    .insert({
      agent_id: agentId,
      category: normalized.category,
      content: normalized.content,
      source,
      metadata: {
        ...metadata,
        suggested_from: source,
        message_count: messages.length,
      },
    })
    .select('*')
    .single()

  if (error) {
    console.warn(`Unable to save memory suggestion: ${error.message}`)
    return null
  }

  return data
}

async function generateMemoryCandidate({ messages, agentReply }) {
  const compactConversation = [...messages, { role: 'agent', content: agentReply }]
    .slice(-8)
    .map((message) => `${message.role || 'user'}: ${redactPrivateText(message.content || '')}`)
    .join('\n')

  if (!isSuggestableConversation(compactConversation)) {
    return null
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MEMORY_MODEL,
      instructions: [
        'You extract durable customer-support teachings for a clinic sales agent.',
        'Return JSON only: {"category":"privacy|compliance|sales_workflow|tone|product|booking","content":"..."} or {"content":""}.',
        'Suggest a memory only for reusable policy, privacy, compliance, sales workflow, tone, product, or booking corrections.',
        'Do not include names, emails, phone numbers, addresses, diagnoses, medication lists, or full transcript text.',
        'Write the teaching as one concise rule the agent can follow in future conversations.',
      ].join('\n'),
      input: `Recent conversation:\n${compactConversation}`,
    }),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    console.warn(`Memory suggestion skipped: ${data.error?.message || response.statusText}`)
    return null
  }

  return parseJsonObject(extractOutputText(data))
}

function isSuggestableConversation(text) {
  return /\b(privacy|private|confidential|confidentiality|client|celebrity|public figure|hipaa|medical history|condition|refund|replacement|book|booking|appointment|doctor|provider|price|pricing|state|ship|shipping|compliance)\b/i.test(
    text,
  )
}

function normalizeMemoryCandidate({ category, content } = {}) {
  const normalizedCategory = MEMORY_CATEGORIES.has(category) ? category : 'sales_workflow'
  const normalizedContent = redactPrivateText(String(content || '').replace(/\s+/g, ' ').trim())

  return {
    category: normalizedCategory,
    content: normalizedContent.length > 600 ? normalizedContent.slice(0, 600).trim() : normalizedContent,
  }
}

function redactPrivateText(text) {
  return PRIVATE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '[redacted]'),
    String(text || ''),
  )
}

function shouldRejectSensitiveMemory(content) {
  return MEDICAL_DETAIL_PATTERN.test(content) || /\[redacted\]/i.test(content)
}

async function createEmbedding(input) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || 'Unable to create memory embedding.')
  }

  return data.data[0].embedding
}

function requireWritableSupabase() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for memory writes.')
  }

  const supabase = createSupabaseServerClient()

  if (!supabase) {
    throw new Error('Supabase server client is not configured.')
  }

  return supabase
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractOutputText(data) {
  if (data.output_text) {
    return data.output_text
  }

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n') || ''
  )
}
