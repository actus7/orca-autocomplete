// Scenarios for `orca plugin check` and `orca plugin shot --scenario <name>`: the panel in each state.
import { defineCheck } from 'orca/testing'

const openai = {
  enabled: true,
  format: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini'
}

function snapshot(fields: Record<string, unknown>) {
  return {
    state: 'on',
    lastMs: null,
    suggested: 0,
    reason: null,
    host: 'api.openai.com',
    model: 'gpt-4o-mini',
    hasKey: true,
    ...fields
  }
}

export default defineCheck({
  'first-run': {
    settings: openai,
    requests: { 'status.get': snapshot({ state: 'setup', hasKey: false }) }
  },
  ready: {
    settings: openai,
    requests: { 'status.get': snapshot({ lastMs: 612, suggested: 14 }) }
  },
  slow: {
    settings: openai,
    requests: { 'status.get': snapshot({ state: 'slow', lastMs: 612, suggested: 14 }) }
  },
  failed: {
    settings: openai,
    requests: {
      'status.get': snapshot({
        state: 'error',
        reason: 'The provider rejected the key. Check it and press Save and test.'
      })
    }
  },
  off: {
    settings: { ...openai, enabled: false },
    requests: { 'status.get': snapshot({ state: 'off', lastMs: 612, suggested: 14 }) }
  }
})
