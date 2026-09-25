import { useCallback, useEffect, useState } from 'react'
import { reportService } from '../services/reportService'

const REPORT_TIMEZONE = 'America/New_York'
const today = formatEasternDateKey(new Date())

function Conversations() {
  const [filters, setFilters] = useState({ from: today, to: today })
  const [report, setReport] = useState({ summary: { conversations: 0, replies: 0 }, rows: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const loadReport = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      setReport(await reportService.getConversations(filters))
      setStatus('ready')
    } catch (loadError) {
      setError(loadError.message)
      setStatus('error')
    }
  }, [filters])

  useEffect(() => {
    let active = true
    reportService.getConversations(filters).then((data) => {
      if (!active) return
      setReport(data)
      setStatus('ready')
    }).catch((loadError) => {
      if (!active) return
      setError(loadError.message)
      setStatus('error')
    })
    return () => { active = false }
  }, [filters])

  return (
    <section className="page conversations-page">
      <header className="page-header report-header">
        <div>
          <h1>Conversations</h1>
          <p>Respond conversations that Dharma Agent replied to. Dates use Eastern Time.</p>
        </div>
        <div className="report-filters">
          <label>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <button className="secondary-button" type="button" onClick={loadReport}>Refresh</button>
        </div>
      </header>

      <div className="report-cards conversation-summary-cards">
        <article className="panel report-card"><span>Conversations replied to</span><strong>{report.summary?.conversations || 0}</strong></article>
        <article className="panel report-card"><span>Total replies</span><strong>{report.summary?.replies || 0}</strong></article>
      </div>

      <section className="panel report-table-panel">
        <div className="panel-heading"><h2>Conversation list</h2><span>{report.rows.length} records</span></div>
        {status === 'loading' && <p className="report-state">Loading conversations…</p>}
        {error && <p className="status-message error">{error}</p>}
        {status === 'ready' && report.rows.length === 0 && <p className="report-state">No tracked replies were sent in this date range.</p>}
        {report.rows.length > 0 && (
          <div className="report-table-wrap"><table className="report-table conversation-report-table"><thead><tr><th>Last replied</th><th>First replied</th><th>Replies</th><th>Channel ID</th><th>Respond contact</th><th>Link</th><th>Latest reply</th></tr></thead>
            <tbody>{report.rows.map((row) => <tr key={row.respond_contact_id}>
              <td>{formatDate(row.last_replied_at)}</td><td>{formatDate(row.first_replied_at)}</td><td>{row.reply_count}</td>
              <td>{row.channel_id || '—'}</td><td>{row.respond_contact_id}</td>
              <td>{row.conversation_url ? <a className="conversation-link" href={row.conversation_url} target="_blank" rel="noreferrer">Open conversation</a> : '—'}</td>
              <td className="reply-preview" title={row.latest_message_preview}>{row.latest_message_preview || '—'}</td>
            </tr>)}</tbody></table></div>
        )}
      </section>
    </section>
  )
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { timeZone: REPORT_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatEasternDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default Conversations
