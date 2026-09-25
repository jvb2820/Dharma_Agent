import { useCallback, useEffect, useState } from 'react'
import { reportService } from '../services/reportService'

const REPORT_TIMEZONE = 'America/New_York'
const today = formatEasternDateKey(new Date())
const monthStart = `${today.slice(0, 8)}01`

function Reports() {
  const [filters, setFilters] = useState({ from: monthStart, to: today })
  const [report, setReport] = useState({ summary: { total: 0, fromAds: 0, byPlatform: {} }, rows: [] })
  const [conversations, setConversations] = useState({ summary: { conversations: 0, replies: 0 }, rows: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const loadReport = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const [bookingData, conversationData] = await Promise.all([
        reportService.getBookings(filters),
        reportService.getConversations(filters),
      ])
      setReport(bookingData)
      setConversations(conversationData)
      setStatus('ready')
    } catch (loadError) {
      setError(loadError.message)
      setStatus('error')
    }
  }, [filters])

  useEffect(() => {
    let active = true
    Promise.all([reportService.getBookings(filters), reportService.getConversations(filters)]).then(([bookingData, conversationData]) => {
      if (!active) return
      setReport(bookingData)
      setConversations(conversationData)
      setStatus('ready')
    }).catch((loadError) => {
      if (!active) return
      setError(loadError.message)
      setStatus('error')
    })
    return () => { active = false }
  }, [filters])

  const summary = report.summary || {}
  const cards = [
    ['Total booked', summary.total || 0],
    ['Booked from ads', summary.fromAds || 0],
    ['Meta ads', summary.byPlatform?.meta || 0],
    ['TikTok ads', summary.byPlatform?.tiktok || 0],
    ['Platform unverified', summary.byPlatform?.other || 0],
    ['Organic', summary.byPlatform?.organic || 0],
  ]

  return (
    <section className="page reports-page">
      <header className="page-header report-header">
        <div>
          <h1>Reports</h1>
          <p>Confirmed appointments attributed to the channel that started the Respond.io chat. Dates use Eastern Time.</p>
        </div>
        <div className="report-filters">
          <label>From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <button className="secondary-button" type="button" onClick={loadReport}>Refresh</button>
        </div>
      </header>

      <div className="report-cards">
        {cards.map(([label, value]) => <article className="panel report-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      <section className="panel report-table-panel">
        <div className="panel-heading"><h2>Successful bookings</h2><span>{report.rows.length} records</span></div>
        {status === 'loading' && <p className="report-state">Loading report…</p>}
        {error && <p className="status-message error">{error}</p>}
        {status === 'ready' && report.rows.length === 0 && <p className="report-state">No confirmed bookings were recorded in this date range.</p>}
        {report.rows.length > 0 && (
          <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Booked</th><th>Appointment</th><th>Source</th><th>Campaign / ad</th><th>Phone</th><th>Respond contact</th></tr></thead>
            <tbody>{report.rows.map((row) => <tr key={row.id}>
              <td>{formatDate(row.booked_at)}</td><td>{formatDate(row.meeting_start_at)}</td>
              <td><span className={`source-badge source-${row.source_platform}`}>{sourceLabel(row)}</span></td>
              <td>{row.campaign_name || row.ad_name || row.ad_id || '—'}</td><td>{row.contact_phone || '—'}</td><td>{row.respond_contact_id}</td>
            </tr>)}</tbody></table></div>
        )}
      </section>

      <section className="panel report-table-panel">
        <div className="panel-heading">
          <div>
            <h2>Respond conversations replied to</h2>
            <p className="report-subtitle">One row per conversation with a successful outbound reply in the selected date range.</p>
          </div>
          <span>{conversations.summary?.conversations || 0} conversations · {conversations.summary?.replies || 0} replies</span>
        </div>
        {status === 'loading' && <p className="report-state">Loading conversations…</p>}
        {status === 'ready' && conversations.rows.length === 0 && <p className="report-state">No tracked replies were sent in this date range.</p>}
        {conversations.rows.length > 0 && (
          <div className="report-table-wrap"><table className="report-table conversation-report-table"><thead><tr><th>Last replied</th><th>First replied</th><th>Replies</th><th>Channel ID</th><th>Respond contact</th><th>Link</th><th>Latest reply</th></tr></thead>
            <tbody>{conversations.rows.map((row) => <tr key={row.respond_contact_id}>
              <td>{formatDate(row.last_replied_at)}</td>
              <td>{formatDate(row.first_replied_at)}</td>
              <td>{row.reply_count}</td>
              <td>{row.channel_id || '—'}</td>
              <td>{row.respond_contact_id}</td>
              <td>{row.conversation_url ? <a className="conversation-link" href={row.conversation_url} target="_blank" rel="noreferrer">Open conversation</a> : '—'}</td>
              <td className="reply-preview" title={row.latest_message_preview}>{row.latest_message_preview || '—'}</td>
            </tr>)}</tbody></table></div>
        )}
      </section>
    </section>
  )
}

function sourceLabel(row) {
  if (row.source_platform === 'meta') return 'Meta ad'
  if (row.source_platform === 'tiktok') return 'TikTok ad'
  if (row.source_type === 'paid_ad') return 'Ad · platform unverified'
  return 'Organic'
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: REPORT_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatEasternDateKey(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default Reports
