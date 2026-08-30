import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const active = useStore(s => s.S.active)
  const week = useStore(s => s.S.week)
  const dayPlan = useStore(s => s.S.dayPlan)
  const routines = useStore(s => s.S.routines)
  const user = useStore(s => s.user)
  const syncStatus = useStore(s => s.syncStatus)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = async () => {
    if (!active) {
      const iso = todayISO()
      const override = dayPlan[iso]
      const day = new Date(iso + 'T12:00:00').getDay()
      const routineId = override === 'rest' ? null : override || week[day]
      const r = routineId ? routines.find(x => x.id === routineId) : null
      if (r && r.ex.length) {
        const { startFlow } = await import('../sheets.jsx')
        startFlow(r.id)
        return
      }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label }) => (
    <button className={(on(k) ? 'on' : '') + (k === 'home' && user && syncStatus !== 'idle' ? ` sync-${syncStatus}` : '')}
      onClick={() => nav(k === 'home' && syncStatus === 'conflict' ? '/settings' : to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={active ? 'play' : 'dumbbell'} /></span>
        <span>{active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
