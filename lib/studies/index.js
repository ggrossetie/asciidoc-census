import ifeval from './ifeval.js'

// To add a study, create a module next to this one and register it here.
export const studies = new Map([ifeval].map((s) => [s.name, s]))
