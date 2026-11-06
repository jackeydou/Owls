import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { RouterWorker } from '../../../shared/router'
import { isInPlay } from '../../../shared/worker-map'
import { useCodexStore } from '../codex/store'
import { isWaitingOnUser, isWorking, workerTone } from './activity'
import { useRouterStore } from './store'

const HEIGHT = 26
const MAX_DOTS = 5
/** A thumbnail of the map: the Router on the left, one dot per worker in play. */
function MiniTree({ workers }: { workers: RouterWorker[] }) {
  const shown = workers.slice(0, MAX_DOTS)
  const step = shown.length > 1 ? (HEIGHT - 8) / (shown.length - 1) : 0
  return (
    <svg className="router-mini" width="34" height={HEIGHT} aria-hidden="true">
      {shown.map((worker, i) => {
        const y = shown.length > 1 ? 4 + i * step : HEIGHT / 2
        return (
          <g key={worker.id}>
            <path d={`M6 ${HEIGHT / 2} C 16 ${HEIGHT / 2}, 16 ${y}, 26 ${y}`} />
            <circle className={workerTone(worker)} cx="28" cy={y} r="2.6" />
          </g>
        )
      })}
      <circle className="root" cx="5" cy={HEIGHT / 2} r="3.2" />
    </svg>
  )
}
export function StatusEntry() {
  const { t } = useTranslation()
  const showMap = useCodexStore((s) => s.showMap)
  const workers = useRouterStore((s) => s.workers)
  const { visible, waiting, working, inPlay } = useMemo(() => {
    const visible = workers.filter((w) => w.status !== 'removed')
    return {
      visible,
      waiting: visible.filter(isWaitingOnUser).length,
      working: visible.filter(isWorking).length,
      inPlay: visible
        .filter(isInPlay)
        .sort((a, b) => Number(isWaitingOnUser(b)) - Number(isWaitingOnUser(a)))
    }
  }, [workers])
  if (!visible.length) return null
  const parts = [
    ...(working ? [t('router.statusWorking', { count: working })] : []),
    ...(waiting ? [t('router.statusWaiting', { count: waiting })] : [])
  ]
  return (
    <button
      type="button"
      className={waiting ? 'router-status wait' : 'router-status'}
      aria-label={t('router.openMap')}
      onClick={showMap}
    >
      <MiniTree workers={inPlay} />
      <span>{parts.join(' · ') || t('map.title')}</span>
      <kbd>⌘ J</kbd>
    </button>
  )
}
