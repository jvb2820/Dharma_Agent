import ContactList from '../components/contacts/ContactList'

function Contacts() {
  return (
    <section className="page">
      <header className="page-header">
        <h1>Contacts</h1>
        <p>Future CRM layer for WhatsApp, Messenger, Instagram, and Respond.io contacts.</p>
      </header>

      <ContactList />
    </section>
  )
}

export default Contacts
