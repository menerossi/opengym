// Mutable exercise index shared by the lightweight state store and the catalogue module.
// Keeping custom-exercise registration here prevents the full built-in catalogue from being
// pulled into the app's authentication/bootstrap bundle.
export const EXIDX = {}

let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
