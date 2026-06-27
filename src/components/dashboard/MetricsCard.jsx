function MetricsCard({ title, value }) {
  return (
    <article className="panel metrics-card">
      <h2>{title}</h2>
      <strong>{value}</strong>
    </article>
  )
}

export default MetricsCard
