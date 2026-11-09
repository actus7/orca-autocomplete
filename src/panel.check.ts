// Scenarios for `orca plugin check` and `orca plugin shot --scenario <name>`: the panel in each state.
import { defineCheck } from 'orca/testing'

const openai = {
  enabled: true,
  format: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini'
}

const modelList = {
  ok: true,
  message: '',
  models: ['gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-5-mini', 'o4-mini']
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
    requests: { 'status.get': snapshot({ state: 'setup', hasKey: false }), 'models.list': modelList }
  },
  ready: {
    settings: openai,
    requests: { 'status.get': snapshot({ lastMs: 612, suggested: 14 }), 'models.list': modelList }
  },
  slow: {
    settings: openai,
    requests: { 'status.get': snapshot({ state: 'slow', lastMs: 612, suggested: 14 }), 'models.list': modelList }
  },
  failed: {
    settings: openai,
    requests: {
      'status.get': snapshot({
        state: 'error',
        reason: 'The provider rejected the key. Check it and press Save and test.'
      }),
      'models.list': modelList
    }
  },
  'pick-model': {
    settings: { ...openai, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:1.5b' },
    requests: {
      'status.get': snapshot({ state: 'setup', host: 'localhost:11434', model: 'qwen2.5-coder:1.5b', hasKey: false }),
      'models.list': {
        ok: true,
        message: '',
        models: ['codellama:7b', 'deepseek-coder:1.3b', 'qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'starcoder2:3b']
      }
    }
  },
  off: {
    settings: { ...openai, enabled: false },
    requests: { 'status.get': snapshot({ state: 'off', lastMs: 612, suggested: 14 }) }
  }
})
