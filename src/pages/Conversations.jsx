import { useCallback, useEffect, useState } from 'react'
import { reportService } from '../services/reportService'

const REPORT_TIMEZONE = 'America/New_York'
const today = formatEasternDateKey(new Date())
const PAGE_SIZE = 10

function Conversations() {
  const [filters, setFilters] = useState({ from: today, to: today })
  const [report, setReport] = useState({ summary: { conversations: 0, replies: 0 }, rows: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const loadReport = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      setReport(await reportService.getConversations(filters))
      setPage(1)
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
      setPage(1)
      setStatus('ready')
    }).catch((loadError) => {
      if (!active) return
      setError(loadError.message)
      setStatus('error')
    })
    return () => { active = false }
  }, [filters])

  const totalPages = Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE))
  const visibleRows = report.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hourly = report.analytics?.hourly || []
  const channels = report.analytics?.byChannel || []
  const maxHourly = Math.max(1, ...hourly.map((item) => item.conversations))

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
        <article className="panel report-card"><span>Average replies</span><strong>{report.summary?.averageReplies || 0}</strong></article>
      </div>

      <section className="panel conversation-analytics">
        <div className="panel-heading"><h2>Conversation activity</h2><span>First reply by hour · Eastern Time</span></div>
        <div className="analytics-grid">
          <div className="hourly-chart" aria-label="Conversations by hour">
            {hourly.map((item) => <div className="hour-column" key={item.hour} title={`${formatHour(item.hour)}: ${item.conversations} conversations`}>
              <span className="hour-value">{item.conversations || ''}</span>
              <div className="hour-bar" style={{ height: `${Math.max(item.conversations ? 5 : 0, item.conversations / maxHourly * 100)}%` }} />
              <span className="hour-label">{formatHour(item.hour)}</span>
            </div>)}
          </div>
          <div className="channel-breakdown">
            <div className="donut-chart" style={{ '--donut-gradient': buildDonutGradient(channels) }}>
              <div><span>Total</span><strong>{report.summary?.conversations || 0}</strong></div>
            </div>
            <div className="channel-legend">
              <h3>By channel</h3>
              {channels.slice(0, 5).map((channel, index) => <div key={channel.channelId}>
                <span><i className={`legend-dot legend-${index}`} />Channel {channel.channelId}</span><strong>{channel.conversations}</strong>
              </div>)}
              {channels.length === 0 && <p>No channel data</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="panel report-table-panel">
        <div className="panel-heading"><h2>Conversation list</h2><span>{report.rows.length} records</span></div>
        {status === 'loading' && <p className="report-state">Loading conversations…</p>}
        {error && <p className="status-message error">{error}</p>}
        {status === 'ready' && report.rows.length === 0 && <p className="report-state">No tracked replies were sent in this date range.</p>}
        {report.rows.length > 0 && (
          <div className="report-table-wrap"><table className="report-table conversation-report-table"><thead><tr><th>Last replied</th><th>First replied</th><th>Replies</th><th>Channel ID</th><th>Respond contact</th><th>Link</th><th>Latest reply</th></tr></thead>
            <tbody>{visibleRows.map((row) => <tr key={row.respond_contact_id}>
              <td>{formatDate(row.last_replied_at)}</td><td>{formatDate(row.first_replied_at)}</td><td>{row.reply_count}</td>
              <td>{row.channel_id || '—'}</td><td>{row.respond_contact_id}</td>
              <td>{row.conversation_url ? <a className="conversation-link" href={row.conversation_url} target="_blank" rel="noreferrer">Open conversation</a> : '—'}</td>
              <td className="reply-preview" title={row.latest_message_preview}>{row.latest_message_preview || '—'}</td>
            </tr>)}</tbody></table></div>
        )}
        {report.rows.length > 0 && <div className="table-pagination">
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, report.rows.length)} of {report.rows.length}</span>
          <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>‹</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" aria-label="Next page" disabled={page === totalPages} onClick={() => setPage((value) => value + 1)}>›</button>
        </div>}
      </section>
    </section>
  )
}

function formatHour(hour) {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return `${hour % 12} ${hour < 12 ? 'AM' : 'PM'}`
}

function buildDonutGradient(channels) {
  const colors = ['#3b82a0', '#d98d3c', '#7aa342', '#8b5cf6', '#98a2b3']
  const total = channels.reduce((sum, channel) => sum + channel.conversations, 0)
  if (!total) return '#e4e7ec'
  let offset = 0
  const stops = channels.slice(0, 5).map((channel, index) => {
    const start = offset
    offset += channel.conversations / total * 360
    return `${colors[index]} ${start}deg ${offset}deg`
  })
  return `conic-gradient(${stops.join(', ')})`
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
