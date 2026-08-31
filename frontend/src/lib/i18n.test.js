import { describe, expect, it } from 'vitest'
import { exerciseName, instrFor, setLang } from './i18n.js'

const trapBarDeadlift = {
  id: '0811',
  n: 'trap bar deadlift',
  st: ['English fallback instruction.']
}

describe('localized exercise content', () => {
  it('loads pt-BR names and instructions by stable exercise id', async () => {
    await setLang('pt-BR')

    expect(exerciseName(trapBarDeadlift)).toBe('levantamento terra com trap bar')
    expect(instrFor(trapBarDeadlift)[0]).toContain('trap bar')
    expect(instrFor(trapBarDeadlift)).not.toEqual(trapBarDeadlift.st)
  })

  it('keeps canonical English as the fallback', async () => {
    await setLang('en')

    expect(exerciseName(trapBarDeadlift)).toBe(trapBarDeadlift.n)
    expect(instrFor(trapBarDeadlift)).toEqual(trapBarDeadlift.st)
  })
})
