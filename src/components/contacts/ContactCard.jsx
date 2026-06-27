function ContactCard({ name, channel }) {
  return (
    <article className="panel contact-card">
      <h2>{name}</h2>
      <p>{channel}</p>
    </article>
  )
}

export default ContactCard
