import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/security')({
  beforeLoad: ({ location }) => {
    // Redirect /security to /security/users
    if (location.pathname === '/security' || location.pathname === '/security/') {
      throw redirect({ to: '/security/users' })
    }
  },
  component: SecurityLayout,
})

function SecurityLayout() {
  return <Outlet />
}
