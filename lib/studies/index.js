import headerEmptyLines from './header-empty-lines.js'
import ifeval from './ifeval.js'
import ifevalEmpty from './ifeval-empty.js'

// To add a study, create a module next to this one and register it here.
export const studies = new Map([ifeval, ifevalEmpty, headerEmptyLines].map((s) => [s.name, s]))
