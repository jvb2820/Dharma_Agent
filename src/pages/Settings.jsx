import { useEffect, useState } from 'react'
import { memoryService } from '../services/memoryService'

const MEMORY_CATEGORIES = [
  { value: 'privacy', label: 'Privacy' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'sales_workflow', label: 'Sales workflow' },
  { value: 'tone', label: 'Tone' },
  { value: 'product', label: 'Product' },
  { value: 'booking', label: 'Booking' },
]

function Settings() {
  const [category, setCategory] = useState('privacy')
  const [content, setContent] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    loadSuggestions()
  }, [])

  async function loadSuggestions() {
    setIsLoading(true)
    setError('')

    try {
      setSuggestions(await memoryService.listSuggestions())
    } catch (loadError) {
      setError(loadError.message || 'Unable to load memory suggestions.')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmedContent = content.trim()

    if (!trimmedContent || isSaving) {
      return
    }

    setIsSaving(true)
    setError('')
    setNotice('')

    try {
      await memoryService.createMemory({ category, content: trimmedContent })
      setContent('')
      setNotice('Teaching saved as approved memory.')
    } catch (saveError) {
      setError(saveError.message || 'Unable to save memory.')
    } finally {
      setIsSaving(false)
    }
  }

  async function reviewSuggestion(id, action) {
    setError('')
    setNotice('')

    try {
      if (action === 'approve') {
        await memoryService.approveSuggestion(id)
        setNotice('Suggestion approved and added to memory.')
      } else {
        await memoryService.rejectSuggestion(id)
        setNotice('Suggestion rejected.')
      }

      setSuggestions((currentSuggestions) =>
        currentSuggestions.filter((suggestion) => suggestion.id !== id),
      )
    } catch (reviewError) {
      setError(reviewError.message || 'Unable to review suggestion.')
    }
  }

  return (
    <section className="page settings-page">
      <header className="page-header">
        <h1>Settings</h1>
        <p>Approve durable teachings that Maria can reuse across future chats.</p>
      </header>

      <div className="settings-grid">
        <section className="panel memory-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Manual memory</p>
              <h2>Add teaching</h2>
            </div>
          </div>

          <form className="memory-form" onSubmit={handleSubmit}>
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {MEMORY_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Teaching
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="Example: Never confirm whether a named person used any Dharma treatment."
                rows={7}
              />
            </label>

            <button type="submit" disabled={isSaving || !content.trim()}>
              {isSaving ? 'Saving...' : 'Save teaching'}
            </button>
          </form>
        </section>

        <section className="panel memory-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Auto-suggested</p>
              <h2>Pending review</h2>
            </div>
            <button type="button" className="secondary-button" onClick={loadSuggestions}>
              Refresh
            </button>
          </div>

          {isLoading ? <p className="muted-text">Loading suggestions...</p> : null}
          {!isLoading && suggestions.length === 0 ? (
            <p className="muted-text">No pending suggestions.</p>
          ) : null}

          <div className="memory-suggestions">
            {suggestions.map((suggestion) => (
              <article className="memory-suggestion" key={suggestion.id}>
                <div>
                  <span className="memory-category">{formatCategory(suggestion.category)}</span>
                  <p>{suggestion.content}</p>
                </div>
                <div className="memory-actions">
                  <button type="button" onClick={() => reviewSuggestion(suggestion.id, 'approve')}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => reviewSuggestion(suggestion.id, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {notice ? <p className="settings-notice">{notice}</p> : null}
      {error ? <p className="settings-error">{error}</p> : null}
    </section>
  )
}

function formatCategory(value) {
  return MEMORY_CATEGORIES.find((item) => item.value === value)?.label || value
}

export default Settings
