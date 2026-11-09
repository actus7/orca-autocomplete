// What the worker and the panel must agree on about the plugin's state: one place, so they cannot drift apart.

// Why: a suggestion that arrives later than this comes after the person has moved on, so stop waiting.
// The panel shows the same number as its "fast enough" limit.
export const REQUEST_TIMEOUT_MS = 1800

/** The colour of each state, on the status bar item and on the panel's badge. */
export const STATE_TONES = { on: 'success', off: 'neutral', setup: 'warning', error: 'danger', slow: 'warning' } as const

export type State = keyof typeof STATE_TONES
