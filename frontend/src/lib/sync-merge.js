const MISSING = Symbol('missing')
const same = (a, b) => a === MISSING || b === MISSING
  ? a === b
  : JSON.stringify(a) === JSON.stringify(b)
const copy = value => value === MISSING ? MISSING : JSON.parse(JSON.stringify(value))
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const field = (value, key) => value !== MISSING && Object.prototype.hasOwnProperty.call(value, key)
  ? value[key] : MISSING

const ARRAY_KEYS = {
  workouts: item => item?.id,
  bodyweight: item => item?.t || item?.d,
  routines: item => item?.id,
  customEx: item => item?.id,
}

function mergeValue(base, local, remote, path, conflicts) {
  if (same(local, remote)) return copy(local)
  if (same(local, base)) return copy(remote)
  if (same(remote, base)) return copy(local)

  const arrayKey = ARRAY_KEYS[path]
  if (arrayKey && [base, local, remote].every(v => v === MISSING || Array.isArray(v))) {
    return mergeRecords(base === MISSING ? [] : base, local === MISSING ? [] : local,
      remote === MISSING ? [] : remote, path, arrayKey, conflicts)
  }
  if ([base, local, remote].every(v => v === MISSING || plain(v))) {
    const out = {}
    const keys = new Set([
      ...Object.keys(base === MISSING ? {} : base),
      ...Object.keys(local === MISSING ? {} : local),
      ...Object.keys(remote === MISSING ? {} : remote),
    ])
    for (const key of keys) {
      const value = mergeValue(field(base, key), field(local, key), field(remote, key),
        path ? `${path}.${key}` : key, conflicts)
      if (value !== MISSING) out[key] = value
    }
    return out
  }
  conflicts.push(path)
  return copy(local)
}

function mergeRecords(base, local, remote, path, keyOf, conflicts) {
  const maps = [base, local, remote].map(list => new Map(list.map(item => [keyOf(item), item])))
  // An item without a stable key cannot be safely merged record by record.
  if (maps.some((map, i) => map.has(undefined) && [base, local, remote][i].length)) {
    conflicts.push(path)
    return copy(local)
  }
  const order = [...remote.map(keyOf), ...local.map(keyOf)].filter((key, i, all) => all.indexOf(key) === i)
  const out = []
  for (const key of order) {
    const value = mergeValue(maps[0].get(key) ?? MISSING, maps[1].get(key) ?? MISSING,
      maps[2].get(key) ?? MISSING, `${path}.${key}`, conflicts)
    if (value !== MISSING) out.push(value)
  }
  return out
}

export function mergeStates(base, local, remote) {
  const conflicts = []
  const value = mergeValue(base || {}, local || {}, remote || {}, '', conflicts)
  delete value.active
  delete value._ts
  return { state: value, conflicts }
}
