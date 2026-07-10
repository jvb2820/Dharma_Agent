import { NavLink, Outlet } from 'react-router-dom'

const navigationItems = [
  { label: 'Chat', path: '/chat' },
  { label: 'Settings', path: '/settings' },
]

function MainLayout() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">Dharma Agent</div>
        <nav className="app-nav" aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <NavLink key={item.path} to={item.path}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

export default MainLayout
