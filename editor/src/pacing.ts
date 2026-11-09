// How long to wait after the person stops typing before asking for a suggestion. A suggestion per
// keystroke would hammer the provider, but a fixed wait is wrong both ways: right after accepting one the
// person is in flow and wants the next soon, and while they are deleting they are rethinking and a
// suggestion is only noise.
//
// Pure (the time is passed in), so Node can test it.

export const BASE_PAUSE_MS = 300
export const QUICK_PAUSE_MS = 120
export const SLOW_PAUSE_MS = 600

/** This many deletions within DELETE_WINDOW_MS count as rethinking. */
const DELETE_BURST = 3
const DELETE_WINDOW_MS = 1500
/** Within this long after accepting a suggestion the person is in flow. */
const FLOW_MS = 4000

export class Pacer {
  private deletions: number[] = []
  private acceptedAt = Number.NEGATIVE_INFINITY

  /** A change to the text: `deleted` when it only removed characters. */
  noteChange(deleted: boolean, now: number): void {
    if (deleted) {
      this.deletions = [...this.deletions.filter((at) => now - at < DELETE_WINDOW_MS), now]
    }
  }

  noteAccepted(now: number): void {
    this.acceptedAt = now
  }

  pause(now: number): number {
    if (this.deletions.filter((at) => now - at < DELETE_WINDOW_MS).length >= DELETE_BURST) {
      return SLOW_PAUSE_MS
    }
    return now - this.acceptedAt < FLOW_MS ? QUICK_PAUSE_MS : BASE_PAUSE_MS
  }
}
