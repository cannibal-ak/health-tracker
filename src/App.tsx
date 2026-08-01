import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { HomeIcon, ScaleIcon, SettingsIcon } from './ui/Icons'
import { requestPersistentStorage } from './lib/persistence'

const TABS = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/weight', label: 'Weight', icon: ScaleIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // iOS keeps old SW versions around aggressively — also check on tab focus.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg?.update()
      })
    },
  })

  if (!needRefresh) return null
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <button
        onClick={() => updateServiceWorker(true)}
        className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg dark:bg-white dark:text-slate-900"
      >
        Update available — tap to reload
      </button>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    // Protect IndexedDB from eviction (best-effort; matters on iOS).
    void requestPersistentStorage()
  }, [])

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <main className="pt-safe flex-1 px-4 pb-28">
        <Outlet />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-lg">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`
              }
            >
              <Icon className="size-6" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <UpdateToast />
    </div>
  )
}
