import MetricsCard from '../components/dashboard/MetricsCard'

function Dashboard() {
  return (
    <section className="page">
      <header className="page-header">
        <h1>Analytics Dashboard</h1>
        <p>Future overview for conversations, agents, channels, and revenue.</p>
      </header>

      <div className="metrics-grid">
        <MetricsCard title="Conversations" value="--" />
        <MetricsCard title="Human Takeovers" value="--" />
        <MetricsCard title="Sales Opportunities" value="--" />
      </div>
    </section>
  )
}

export default Dashboard
