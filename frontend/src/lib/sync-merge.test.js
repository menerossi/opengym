import { describe, expect, test } from 'vitest'
import { mergeStates } from './sync-merge.js'

describe('three-way state merge', () => {
  test('combines independent workouts and preference changes', () => {
    const base = { theme: 'dark', workouts: [{ id: 'w1', d: '2026-01-01' }] }
    const local = { ...base, theme: 'light', workouts: [...base.workouts, { id: 'w2', d: '2026-01-02' }] }
    const remote = { ...base, unit: 'lb', workouts: [...base.workouts, { id: 'w3', d: '2026-01-03' }] }
    const result = mergeStates(base, local, remote)
    expect(result.conflicts).toEqual([])
    expect(result.state).toMatchObject({ theme: 'light', unit: 'lb' })
    expect(result.state.workouts.map(w => w.id)).toEqual(['w1', 'w3', 'w2'])
  })

  test('reports concurrent edits to the same record', () => {
    const base = { routines: [{ id: 'r1', name: 'Base', ex: [] }] }
    const local = { routines: [{ id: 'r1', name: 'Local', ex: [] }] }
    const remote = { routines: [{ id: 'r1', name: 'Remote', ex: [] }] }
    const result = mergeStates(base, local, remote)
    expect(result.conflicts).toContain('routines.r1.name')
    expect(result.state.routines[0].name).toBe('Local')
  })

  test('keeps a deletion when the other side did not edit the record', () => {
    const base = { customEx: [{ id: 'x1', n: 'Carry' }] }
    const result = mergeStates(base, { customEx: [] }, base)
    expect(result).toEqual({ state: { customEx: [] }, conflicts: [] })
  })

  test('preserves explicit null values', () => {
    const base = { targetW: 80, coach: null }
    const result = mergeStates(base, { targetW: null, coach: null }, { targetW: 80, coach: { enabled: true } })
    expect(result).toEqual({ state: { targetW: null, coach: { enabled: true } }, conflicts: [] })
  })
})
