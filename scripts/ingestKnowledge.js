import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import ExcelJS from 'exceljs'
import { PDFParse } from 'pdf-parse'
import { loadLocalEnv } from '../server/env.js'

loadLocalEnv()

const args = parseArgs(process.argv.slice(2))
const bucket = args.bucket || process.env.SUPABASE_KNOWLEDGE_BUCKET || 'Agent Knowledge'
const prefix = args.prefix || 'Company Info'
const sourceType = args.sourceType || 'company_info'
const agentId = args.agentId || 'sales'
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
const projectUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ||
  execPowerShellUserEnv('SUPABASE_ACCESS_TOKEN')

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required.')
}

if (!projectUrl) {
  throw new Error('SUPABASE_URL is required.')
}

if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN is required for linked database ingestion.')
}

process.env.SUPABASE_ACCESS_TOKEN = accessToken

const files = listStorageFiles({ bucket, prefix })
const supportedFiles = files.filter((file) => isSupportedFile(file.name))

if (supportedFiles.length === 0) {
  console.log(`No supported files found in ${bucket}/${prefix}.`)
  process.exit(0)
}

for (const file of supportedFiles) {
  console.log(`Indexing ${file.name}`)
  const buffer = await downloadPublicObject(bucket, file.name)

  if (sourceType === 'raw_conversation' && extname(file.name).toLowerCase() === '.xlsx') {
    const examples = await extractRespondConversationRows(buffer)

    for (const example of examples) {
      if (!example.contactId) {
        console.log(`Skipping row ${example.rowNumber}: no Respond inbox contact ID found.`)
        continue
      }

      console.log(`Fetching Respond conversation ${example.contactId}`)
      const messages = await fetchRespondMessages(example.contactId)
      const content = formatRespondTranscript(example, messages)
      const chunks = chunkText(content)
      const rows = []

      for (const [index, chunk] of chunks.entries()) {
        rows.push({
          index,
          content: chunk,
          embedding: await createEmbedding(chunk),
        })
      }

      await upsertDocumentWithChunks({
        bucket,
        storagePath: `${file.name}#respond-contact-${example.contactId}`,
        title: `${example.caseType || 'Respond Conversation'} - ${example.contactId}`,
        sourceType,
        agentId,
        chunks: rows,
        metadata: {
          source_spreadsheet: file.name,
          row_number: example.rowNumber,
          case_type: example.caseType,
          observation: example.observation,
          respond_link: example.link,
          respond_contact_id: example.contactId,
          message_count: messages.length,
        },
      })

      console.log(`Indexed Respond conversation ${example.contactId} (${rows.length} chunks, ${messages.length} messages)`)
    }

    continue
  }

  const content = await extractText(buffer, file.name)
  const chunks = chunkText(content)
  const rows = []

  for (const [index, chunk] of chunks.entries()) {
    rows.push({
      index,
      content: chunk,
      embedding: await createEmbedding(chunk),
    })
  }

  await upsertDocumentWithChunks({
    bucket,
    storagePath: file.name,
    title: basename(file.name),
    sourceType,
    agentId,
    chunks: rows,
    metadata: {
      storage_path: file.name,
      title: basename(file.name),
    },
  })

  console.log(`Indexed ${file.name} (${rows.length} chunks)`)
}

function listStorageFiles({ bucket, prefix }) {
  const sql = `
    select bucket_id, name
    from storage.objects
    where bucket_id = ${sqlString(bucket)}
      and name like ${sqlString(`${prefix}/%`)}
      and name not like '%.emptyFolderPlaceholder'
    order by name;
  `

  const output = runSupabaseQuery(sql, 'json')

  const parsed = JSON.parse(output)
  return parsed.rows || []
}

async function downloadPublicObject(bucketName, storagePath) {
  const url = `${projectUrl}/storage/v1/object/public/${encodePath(bucketName)}/${encodePath(storagePath)}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Unable to download ${storagePath}: ${response.status} ${response.statusText}`)
  }

  return Buffer.from(await response.arrayBuffer())
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
    const lines = dataRows.map((row) => {
      const cells = row.values
        .map((value, index) => [headers[index], value])
        .filter(([, value]) => value.trim())
        .map(([key, value]) => `${key}: ${value.trim()}`)
        .join(' | ')

      return `Row ${row.rowNumber}: ${cells}`
    })

    sections.push(`Sheet: ${worksheet.name}\n${lines.join('\n')}`)
  }

  return sections.join('\n\n')
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
  const chunkSize = 3500
  const overlap = 350

  for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
    const chunk = normalized.slice(start, start + chunkSize).trim()

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
      model: embeddingModel,
      input,
    }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || 'Unable to create embedding.')
  }

  return data.data[0].embedding
}

async function upsertDocumentWithChunks({
  bucket,
  storagePath,
  title,
  sourceType,
  agentId,
  chunks,
  metadata = {},
}) {
  const values = chunks
    .map((chunk) => {
      return `(
        doc_id,
        ${sqlString(agentId)},
        ${sqlString(sourceType)},
        ${chunk.index},
        ${sqlString(chunk.content)},
        ${sqlString(vectorLiteral(chunk.embedding))}::vector,
        jsonb_build_object('storage_path', ${sqlString(storagePath)}, 'title', ${sqlString(title)})
      )`
    })
    .join(',\n')

  const insertChunks =
    chunks.length > 0
      ? `
        insert into public.document_chunks (
          document_id,
          agent_id,
          source_type,
          chunk_index,
          content,
          embedding,
          metadata
        )
        values ${values};
      `
      : ''

  const sql = `
    do $$
    declare
      doc_id uuid;
    begin
      insert into public.documents (
        agent_id,
        title,
        bucket,
        storage_path,
        source_type,
        mime_type,
        status,
        error,
        metadata
      )
      values (
        ${sqlString(agentId)},
        ${sqlString(title)},
        ${sqlString(bucket)},
        ${sqlString(storagePath)},
        ${sqlString(sourceType)},
        ${sqlString(resolveMimeType(storagePath))},
        'pending',
        null,
        ${sqlJson({ ingested_by: 'scripts/ingestKnowledge.js', ...metadata })}::jsonb
      )
      on conflict (bucket, storage_path)
      do update set
        agent_id = excluded.agent_id,
        title = excluded.title,
        source_type = excluded.source_type,
        mime_type = excluded.mime_type,
        status = 'pending',
        error = null,
        metadata = excluded.metadata
      returning id into doc_id;

      delete from public.document_chunks
      where document_id = doc_id;

      ${insertChunks}

      update public.documents
      set status = 'indexed', error = null
      where id = doc_id;
    end $$;
  `

  const sqlPath = join(tmpdir(), `dharma-rag-${Date.now()}.sql`)
  writeFileSync(sqlPath, sql)
  runSupabaseQueryFile(sqlPath)
}

function resolveMimeType(path) {
  const extension = extname(path).toLowerCase()

  if (extension === '.pdf') {
    return 'application/pdf'
  }

  if (extension === '.json') {
    return 'application/json'
  }

  if (extension === '.csv') {
    return 'text/csv'
  }

  if (extension === '.xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }

  return 'text/plain'
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

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]

    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

    parsed[key] = rawArgs[index + 1]
    index += 1
  }

  return parsed
}

function execPowerShellUserEnv(name) {
  if (process.platform !== 'win32') {
    return ''
  }

  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    return ''
  }
}

function runSupabaseQuery(sql, output = 'table') {
  const sqlPath = join(tmpdir(), `dharma-rag-query-${Date.now()}.sql`)
  writeFileSync(sqlPath, sql)
  return runSupabaseQueryFile(sqlPath, output)
}

function runSupabaseQueryFile(sqlPath, output = 'table') {
  const command = [
    `$env:SUPABASE_ACCESS_TOKEN = ${powerShellString(accessToken)};`,
    'npx supabase db query --linked',
    output ? `--output ${output}` : '',
    `--file ${powerShellString(sqlPath)}`,
  ]
    .filter(Boolean)
    .join(' ')

  return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8',
  })
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function sqlString(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`
}

function sqlJson(value) {
  return sqlString(JSON.stringify(value ?? {}))
}

function vectorLiteral(embedding) {
  return `[${embedding.join(',')}]`
}

function isSupportedFile(path) {
  return ['.pdf', '.txt', '.md', '.csv', '.json', '.xlsx'].includes(extname(path).toLowerCase())
}
