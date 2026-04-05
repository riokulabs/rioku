import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { Header } from '../components/Header'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="main-area">
        <Header onMenuToggle={() => setSidebarOpen((s) => !s)} />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
