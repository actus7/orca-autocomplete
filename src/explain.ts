// Turns a failure into one sentence that says what happened and what to do next.
import { ProviderHttpError, type ProviderFormat } from './complete.ts'
import type { Translate } from './i18n.ts'

// Why whole names: `localhost.example.com` and `127.0.0.1.nip.io` start like this computer and are not it.
const LOOPBACK_NAME = /^(localhost|[\w-]+(\.[\w-]+)*\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i

/** Whether a host (with or without a port) is this computer itself. A server elsewhere on the network is not. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_NAME.test(host.replace(/:\d+$/, ''))
}

/** The host (and port) of an address, or '' when it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** What went wrong, as text, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
    return t(isLoopbackHost(host) ? 'err.networkLocal' : 'err.network', { host })
  }
  return errorMessage(error)
}
