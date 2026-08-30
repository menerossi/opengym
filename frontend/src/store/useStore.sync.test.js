import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const mem = new Map()
globalThis.localStorage = {
  getItem: key => mem.has(key) ? mem.get(key) : null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: key => mem.delete(key),
  clear: () => mem.clear(),
}
globalThis.document = { visibilityState: 'visible', addEventListener: vi.fn() }
globalThis.window = { addEventListener: vi.fn() }

const api = vi.fn()
vi.mock('../lib/api.js', () => ({ api }))
vi.mock('../lib/format.js', () => ({ localTZ: () => 'UTC' }))
vi.mock('../lib/exercise-registry.js', () => ({ registerCustom: vi.fn() }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'seeded' }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: vi.fn(), nativeSave: vi.fn(), syncReminder: vi.fn(),
}))

let useStore
const localState = { routines: [{ id: 'local' }], workouts: [], bodyweight: [], customEx: [], active: { id: 'in-progress' }, reminder: {} }
const remoteState = { routines: [{ id: 'remote' }], workouts: [], bodyweight: [], customEx: [], active: null, reminder: {} }

beforeAll(async () => {
  mem.set('gym_state_v1', JSON.stringify(localState))
  mem.set('gym_user', JSON.stringify({ id: 'u1' }))
  mem.set('gym_dirty', '1')
  mem.set('gym_sync_revision_v1', 'old-revision')
  ;({ useStore } = await import('./useStore.js'))
})

beforeEach(() => api.mockReset())

describe('conflict-safe sync', () => {
  test('a remote change never silently replaces dirty local data', async () => {
    api.mockResolvedValue({ state: remoteState, revision: 'remote-revision' })

    await useStore.getState().pullState()

    expect(useStore.getState().syncStatus).toBe('conflict')
    expect(useStore.getState().S.routines[0].id).toBe('local')
    expect(localStorage.getItem('gym_dirty')).toBe('1')
  })

  test('choosing the server restores it but preserves the active workout', async () => {
    api.mockResolvedValue({ state: remoteState, revision: 'remote-revision' })

    expect(await useStore.getState().resolveSyncConflict('remote')).toBe(true)

    expect(useStore.getState().S.routines[0].id).toBe('remote')
    expect(useStore.getState().S.active.id).toBe('in-progress')
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(localStorage.getItem('gym_sync_revision_v1')).toBe('remote-revision')
  })

  test('choosing this device overwrites only against the freshly-read revision', async () => {
    useStore.getState().replaceState(localState, false)
    localStorage.setItem('gym_dirty', '1')
    localStorage.setItem('gym_sync_revision_v1', 'stale-revision')
    api
      .mockResolvedValueOnce({ state: remoteState, revision: 'fresh-revision' })
      .mockResolvedValueOnce({ ok: true, revision: 'saved-revision' })

    expect(await useStore.getState().resolveSyncConflict('local')).toBe(true)

    const put = JSON.parse(api.mock.calls[1][1].body)
    expect(put.baseRevision).toBe('fresh-revision')
    expect(put.state.routines[0].id).toBe('local')
    expect(localStorage.getItem('gym_sync_revision_v1')).toBe('saved-revision')
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })
})
