import { PluginsTab } from '@renderer/components/settings/PluginsTab'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function PluginsPage(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname.startsWith('/plugins/flows')) {
      navigate('/plugins', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto w-full max-w-5xl px-8 py-2">
        <PluginsTab />
      </div>
    </div>
  )
}
