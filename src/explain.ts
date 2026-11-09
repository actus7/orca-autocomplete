// Turns a failure into one sentence that says what happened and what to do next.
import { ProviderHttpError, type ProviderFormat } from './complete.ts'
import type { Translate } from './i18n.ts'

const LOCAL_HOST = /^(localhost|127\.|\[?::1)/i

export function explainFailure(error: unknown, t: Translate, host: string, timeoutMs: number, format?: ProviderFormat): string {
  const seconds = (timeoutMs / 1000).toString()
  if (error instanceof ProviderHttpError) {
    const { status } = error
    if (status === 401 || status === 403) {
      return t('err.auth')
    }
    if (status === 404) {
      return t('err.notFound')
    }
    // Why only Ollama: it answers 400 when the model has no support for a suffix, and says nothing more we read.
    if (status === 400 && format === 'ollama') {
      return t('err.noInsert')
    }
    if (status === 429) {
      return t('err.rateLimit')
    }
    return status >= 500 ? t('err.server', { status }) : t('err.http', { status })
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return t('err.timeout', { seconds })
  }
  // Why: fetch reports every connection problem as a TypeError ("fetch failed").
  if (error instanceof TypeError) {
    return t(LOCAL_HOST.test(host) ? 'err.networkLocal' : 'err.network', { host })
  }
  return error instanceof Error ? error.message : String(error)
}
