import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercise-registry.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'

const KEY = 'gym_state_v1'
const REV_KEY = 'gym_sync_revision_v1'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // AI Coach (issue: AI enablement). null until the profile opts in — a null namespace is the
  // same app it was before the feature existed, which is what Epic F asks for. Shape and
  // bounds live in lib/coach.js.
  coach: null
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let pushRun = null
  let changeSeq = 0

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    S._ts = Date.now()
    changeSeq++
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      // Mark pending immediately, not when the network request fails. A tab can be killed during
      // the debounce window and must still know on the next boot that its local state is newer.
      localStorage.setItem('gym_dirty', '1')
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') {
      if (get().user) get().pullState()
      return
    }
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })
  window.addEventListener('online', () => { if (get().user) get().pullState() })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(REV_KEY)
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    syncStatus: 'idle', // idle | syncing | offline | conflict
    // Instance capabilities from GET /api/config. `config.coach` is present only when the
    // owner has both enabled the Coach and connected a provider — every Coach entry point in
    // the app hangs off it, so an unconfigured instance renders exactly what it always did.
    config: null,

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      // Coalesce all callers into one serialized upload loop. If state changes while a request is
      // in flight, the loop sends the newer snapshot only after the older request has settled.
      if (pushRun) return pushRun
      pushRun = (async () => {
        let synced = true
        do {
          const sentSeq = changeSeq
          const state = clone(get().S)
          const baseRevision = localStorage.getItem(REV_KEY)
          set({ syncStatus: 'syncing' })
          try {
            const result = await api('/api/data', {
              method: 'PUT', body: JSON.stringify({ state, baseRevision })
            })
            if (result.revision) localStorage.setItem(REV_KEY, result.revision)
            else localStorage.removeItem(REV_KEY)
            if (sentSeq === changeSeq) localStorage.removeItem('gym_dirty')
            set({ syncStatus: 'idle' })
          } catch (e) {
            synced = false
            localStorage.setItem('gym_dirty', '1')
            set({ syncStatus: e.status === 409 ? 'conflict' : 'offline' })
            break
          }
        } while (localStorage.getItem('gym_dirty') === '1')
        return synced
      })().finally(() => { pushRun = null })
      return pushRun
    },
    async pullState() {
      try {
        const { state, revision } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        const baseRevision = localStorage.getItem(REV_KEY)
        // Both sides changed since the last successful sync. Keep the local copy intact and make
        // the conflict visible in state; never choose a winner using untrusted device clocks.
        if (dirty && revision !== baseRevision) {
          set({ syncStatus: 'conflict' })
          return
        }
        if (state && !dirty) {
          const active = S.active
          const next = Object.assign(clone(DEF), state)
          if (active) next.active = active
          persist(next, false)
          localStorage.removeItem('gym_dirty')
        }
        if (revision) localStorage.setItem(REV_KEY, revision)
        else localStorage.removeItem(REV_KEY)
        if (!state) await get().pushState()
        set({ syncStatus: 'idle' })
      } catch (e) { set({ syncStatus: 'offline' }) }
    },

    async signOut() {
      const synced = await get().pushState()
      if (!synced) throw new Error('Your changes could not be synced. Your data is still safe on this device.')
      await api('/api/logout', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      const synced = await get().pushState()
      if (!synced) throw new Error('Your changes could not be synced. Your data is still safe on this device.')
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Instance capabilities are public and needed whether or not anyone is signed in.
      try { set({ config: await api('/api/config') }) } catch (e) { /* offline — assume nothing extra */ }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
