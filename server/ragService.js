import { basename, extname } from 'node:path'
import ExcelJS from 'exceljs'
import { PDFParse } from 'pdf-parse'
import { createSupabaseServerClient } from './supabaseClient.js'

const DEFAULT_BUCKET = process.env.SUPABASE_KNOWLEDGE_BUCKET || 'Agent Knowledge'
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
const CHUNK_SIZE = 3500
const CHUNK_OVERLAP = 350

const SOURCE_TYPE_BY_PREFIX = new Map([
  ['Company Info', 'company_info'],
  ['company-info', 'company_info'],
  ['Raw Conversation', 'raw_conversation'],
  ['raw-conversations', 'raw_conversation'],
  ['approved-examples', 'approved_example'],
  ['sales-scripts', 'sales_script'],
  ['product-info', 'product_info'],
  ['compliance', 'compliance'],
])

export async function ingestKnowledgeFolder({
  bucket = DEFAULT_BUCKET,
  prefix = 'Company Info',
  agentId = 'sales',
  sourceType,
} = {}) {
  const supabase = requireSupabase()
  const files = await listFilesRecursive(supabase, bucket, prefix)
  const results = []

  for (const file of files) {
    const resolvedSourceType = sourceType || resolveSourceType(file.path)
    const result = await ingestKnowledgeFile({
      supabase,
      bucket,
      path: file.path,
      agentId,
      sourceType: resolvedSourceType,
      metadata: file.metadata || {},
    })

    results.push(...(Array.isArray(result) ? result : [result]))
  }

  return results
}

export async function searchKnowledge({
  query,
  agentId = 'sales',
  sourceTypes = ['company_info', 'raw_conversation', 'approved_example', 'sales_script', 'product_info', 'compliance'],
  matchCount = 6,
} = {}) {
  if (!query?.trim()) {
    return []
  }

  const supabase = createSupabaseServerClient()

  if (!supabase) {
    return []
  }

  const embedding = await createEmbedding(query)
  const { data, error } = await supabase.rpc('match_agent_knowledge', {
    query_embedding: embedding,
    match_agent_id: agentId,
    match_source_types: sourceTypes,
    match_count: matchCount,
  })

  if (error) {
    console.warn(`Knowledge search skipped: ${error.message}`)
    return []
  }

  return data || []
}

export function formatKnowledgeContext(matches) {
  if (!matches?.length) {
    return ''
  }

  return matches
    .map((match, index) => {
      return [
        `Source ${index + 1}: ${match.title}`,
        `Type: ${match.source_type}`,
        `Similarity: ${Number(match.similarity || 0).toFixed(3)}`,
        match.content,
      ].join('\n')
    })
    .join('\n\n---\n\n')
}

async function ingestKnowledgeFile({ supabase, bucket, path, agentId, sourceType, metadata }) {
  const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(path)

  if (downloadError) {
    throw new Error(`Unable to download ${path}: ${downloadError.message}`)
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())

  if (sourceType === 'raw_conversation' && extname(path).toLowerCase() === '.xlsx') {
    return await ingestRespondConversationSpreadsheet({
      supabase,
      bucket,
      path,
      agentId,
      metadata,
      buffer,
    })
  }

  const content = await extractText(buffer, path)
  const chunks = chunkText(content)
  const title = basename(path)

  await upsertKnowledgeDocument({
    supabase,
    bucket,
    storagePath: path,
    title,
    agentId,
    sourceType,
    mimeType: metadata?.mimetype || metadata?.mimeType || null,
    metadata,
    chunks,
  })

  return {
    path,
    sourceType,
    chunks: chunks.length,
  }
}

async function ingestRespondConversationSpreadsheet({ supabase, bucket, path, agentId, metadata, buffer }) {
  const examples = await extractRespondConversationRows(buffer)
  const results = []

  for (const example of examples) {
    if (!example.contactId) {
      results.push({
        path: `${path}#row-${example.rowNumber}`,
        sourceType: 'raw_conversation',
        chunks: 0,
        status: 'skipped',
        error: 'No Respond inbox contact ID found.',
      })
      continue
    }

    try {
      const messages = await fetchRespondMessages(example.contactId)
      const transcript = formatRespondTranscript(example, messages)
      const chunks = chunkText(transcript)
      const title = `${example.caseType || 'Respond Conversation'} - ${example.contactId}`
      const storagePath = `${path}#respond-contact-${example.contactId}`

      await upsertKnowledgeDocument({
        supabase,
        bucket,
        storagePath,
        title,
        agentId,
        sourceType: 'raw_conversation',
        mimeType: metadata?.mimetype || metadata?.mimeType || null,
        metadata: {
          ...metadata,
          source_spreadsheet: path,
          row_number: example.rowNumber,
          case_type: example.caseType,
          observation: example.observation,
          respond_link: example.link,
          respond_contact_id: example.contactId,
          message_count: messages.length,
        },
        chunks,
      })

      results.push({
        path: storagePath,
        sourceType: 'raw_conversation',
        chunks: chunks.length,
        messages: messages.length,
      })
    } catch (error) {
      results.push({
        path: `${path}#respond-contact-${example.contactId}`,
        sourceType: 'raw_conversation',
        chunks: 0,
        status: 'failed',
        error: error.message,
      })
    }
  }

  return results
}

async function upsertKnowledgeDocument({
  supabase,
  bucket,
  storagePath,
  title,
  agentId,
  sourceType,
  mimeType,
  metadata,
  chunks,
}) {
  const { data: document, error: documentError } = await supabase
    .from('documents')
    .upsert(
      {
        agent_id: agentId,
        title,
        bucket,
        storage_path: storagePath,
        source_type: sourceType,
        mime_type: mimeType,
        status: 'pending',
        error: null,
        metadata,
      },
      { onConflict: 'bucket,storage_path' },
    )
    .select('id')
    .single()

  if (documentError) {
    throw new Error(`Unable to save document ${storagePath}: ${documentError.message}`)
  }

  await supabase.from('document_chunks').delete().eq('document_id', document.id)

  const chunkRows = []

  for (const [index, chunk] of chunks.entries()) {
    chunkRows.push({
      document_id: document.id,
      agent_id: agentId,
      source_type: sourceType,
      chunk_index: index,
      content: chunk,
      embedding: await createEmbedding(chunk),
      metadata: {
        storage_path: storagePath,
        title,
      },
    })
  }

  if (chunkRows.length > 0) {
    const { error: chunkError } = await supabase.from('document_chunks').insert(chunkRows)

    if (chunkError) {
      await markDocumentFailed(supabase, document.id, chunkError.message)
      throw new Error(`Unable to save chunks for ${storagePath}: ${chunkError.message}`)
    }
  }

  await supabase
    .from('documents')
    .update({ status: 'indexed', error: null })
    .eq('id', document.id)
}

async function listFilesRecursive(supabase, bucket, prefix) {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })

  if (error) {
    throw new Error(`Unable to list ${bucket}/${prefix}: ${error.message}`)
  }

  if ((!data || data.length === 0) && prefix === 'Raw Conversation') {
    return [
      {
        path: process.env.RESPOND_CONVERSATIONS_INDEX_PATH || 'Raw Conversation/RESPOND CONVERSATIONS.xlsx',
        metadata: {},
      },
    ]
  }

  const files = []

  for (const item of data || []) {
    const path = `${prefix}/${item.name}`

    if (item.id || item.metadata?.size) {
      files.push({ path, metadata: item.metadata })
      continue
    }

    files.push(...(await listFilesRecursive(supabase, bucket, path)))
  }

  return files.filter((file) => isSupportedFile(file.path))
}

async function extractText(buffer, path) {
  const extension = extname(path).toLowerCase()

  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer })
    const parsed = await parser.getText()
    await parser.destroy()
    return parsed.text
  }

  if (['.txt', '.md', '.csv', '.json'].includes(extension)) {
    return buffer.toString('utf8')
  }

  if (extension === '.xlsx') {
    return await extractSpreadsheetText(buffer)
  }

  throw new Error(`Unsupported knowledge file type: ${extension}`)
}

async function extractSpreadsheetText(buffer) {
  const rowsBySheet = await extractSpreadsheetRows(buffer)
  const sections = []

  for (const { sheetName, rows } of rowsBySheet) {
    const lines = rows.map((row) => {
      const cells = Object.entries(row.data)
        .filter(([, value]) => value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`)
        .join(' | ')

      return `Row ${row.rowNumber}: ${cells}`
    })

    sections.push(`Sheet: ${sheetName}\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
}

async function extractSpreadsheetRows(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sections = []

  for (const worksheet of workbook.worksheets) {
    const rows = []

    worksheet.eachRow((row, rowNumber) => {
      const values = row.values.slice(1).map(spreadsheetValueToText)
      const hasValue = values.some((value) => value.trim())

      if (hasValue) {
        rows.push({ rowNumber, values })
      }
    })

    if (rows.length < 2) {
      continue
    }

    const [headerRow, ...dataRows] = rows
    const headers = headerRow.values.map((value, index) => value || `Column ${index + 1}`)
    const parsedRows = dataRows.map((row) => {
      const data = {}

      for (const [index, value] of row.values.entries()) {
        data[headers[index]] = value
      }

      return { rowNumber: row.rowNumber, data }
    })

    sections.push({ sheetName: worksheet.name, rows: parsedRows })
  }

  return sections
}

async function extractRespondConversationRows(buffer) {
  const rowsBySheet = await extractSpreadsheetRows(buffer)
  const examples = []

  for (const { rows } of rowsBySheet) {
    for (const row of rows) {
      const caseType = pickSpreadsheetField(row.data, ['Case', 'Case Type', 'Type'])
      const link = pickSpreadsheetField(row.data, ['Link', 'Case Link', 'Respond Link', 'URL'])
      const observation = pickSpreadsheetField(row.data, ['Observation', 'Notes', 'Note'])
      const contactId = extractRespondContactId(link)

      if (!caseType && !link && !observation) {
        continue
      }

      examples.push({
        rowNumber: row.rowNumber,
        caseType,
        link,
        observation,
        contactId,
      })
    }
  }

  return examples
}

function pickSpreadsheetField(row, names) {
  const normalizedNames = names.map(normalizeSpreadsheetKey)

  for (const [key, value] of Object.entries(row)) {
    if (normalizedNames.includes(normalizeSpreadsheetKey(key))) {
      return value.trim()
    }
  }

  return ''
}

function normalizeSpreadsheetKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function extractRespondContactId(link) {
  const match = String(link || '').match(/\/inbox\/(\d+)/)
  return match?.[1] || ''
}

async function fetchRespondMessages(contactId) {
  const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY

  if (!token) {
    throw new Error('RESPOND_API_TOKEN is required to fetch Respond conversations.')
  }

  const messages = []
  const pageLimit = Number(process.env.RESPOND_MESSAGE_PAGE_LIMIT || 100)
  const maxPages = Number(process.env.RESPOND_MESSAGE_MAX_PAGES || 10)
  let url = `https://api.respond.io/v2/contact/${encodeURIComponent(`id:${contactId}`)}/message/list?limit=${pageLimit}`

  for (let page = 0; url && page < maxPages; page += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || `Respond API request failed with ${response.status}.`)
    }

    messages.push(...(data.items || []))
    url = data.pagination?.next || ''
  }

  return messages.sort((left, right) => getRespondMessageTimestamp(left) - getRespondMessageTimestamp(right))
}

function formatRespondTranscript(example, messages) {
  const header = [
    `Case: ${example.caseType || 'Unspecified'}`,
    `Respond Contact ID: ${example.contactId}`,
    `Respond Link: ${example.link}`,
    example.observation ? `Observation: ${example.observation}` : '',
    `Message Count: ${messages.length}`,
    'Transcript:',
  ]
    .filter(Boolean)
    .join('\n')

  const lines = messages.map((message) => {
    const timestamp = formatRespondTimestamp(getRespondMessageTimestamp(message))
    const speaker = message.traffic === 'incoming' ? 'Customer' : 'Agent'
    const body = formatRespondMessageBody(message.message)

    return `[${timestamp}] ${speaker}: ${body}`
  })

  return `${header}\n${lines.join('\n')}`.trim()
}

function getRespondMessageTimestamp(message) {
  const statusTimestamp = message.status?.[0]?.timestamp
  return Number(statusTimestamp || message.messageId || 0)
}

function formatRespondTimestamp(timestamp) {
  if (!timestamp) {
    return 'unknown time'
  }

  return new Date(timestamp).toISOString()
}

function formatRespondMessageBody(message) {
  if (!message) {
    return '[empty message]'
  }

  if (message.text) {
    return message.text
  }

  if (message.type) {
    return `[${message.type} message]`
  }

  return JSON.stringify(message)
}

function spreadsheetValueToText(value) {
  if (value == null) {
    return ''
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'object') {
    if ('text' in value) {
      return String(value.text)
    }

    if ('result' in value) {
      return spreadsheetValueToText(value.result)
    }

    if ('richText' in value) {
      return value.richText.map((part) => part.text || '').join('')
    }
  }

  return String(value)
}

function chunkText(text) {
  const normalized = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const chunks = []

  for (let start = 0; start < normalized.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = normalized.slice(start, start + CHUNK_SIZE).trim()

    if (chunk.length > 80) {
      chunks.push(chunk)
    }
  }

  return chunks
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
    throw new Error(data.error?.message || 'Unable to create embedding.')
  }

  return data.data[0].embedding
}

async function markDocumentFailed(supabase, documentId, error) {
  await supabase.from('documents').update({ status: 'failed', error }).eq('id', documentId)
}

function requireSupabase() {
  const supabase = createSupabaseServerClient()

  if (!supabase) {
    throw new Error('Supabase server client is not configured.')
  }

  return supabase
}

function resolveSourceType(path) {
  const [prefix] = path.split('/')
  return SOURCE_TYPE_BY_PREFIX.get(prefix) || 'company_info'
}

function isSupportedFile(path) {
  return ['.pdf', '.txt', '.md', '.csv', '.json', '.xlsx'].includes(extname(path).toLowerCase())
}
