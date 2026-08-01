import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { WeightPage } from './features/weight/WeightPage'
import { WorkoutsPage } from './features/workouts/WorkoutsPage'
import { SettingsPage } from './features/settings/SettingsPage'

// Hash router: works identically under any GitHub Pages base path and in the
// installed PWA (no server-side rewrites available on static hosting).
const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'weight', element: <WeightPage /> },
      { path: 'workouts', element: <WorkoutsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
