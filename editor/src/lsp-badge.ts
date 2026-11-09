// A small status pill in the corner of the editor: which language server is serving this file, or
// that it stopped. It takes its colors from Orca's theme. Once the person has seen which server it is,
// it folds down to its dot so it stops covering code; pointing at it shows the name again.
import { say } from './strings.ts'

// Long enough to read a server's name, short enough not to sit on the last lines of the file.
const QUIET_AFTER_MS = 4000
const STYLE = `
.orca-lsp-badge {
  position: fixed; right: 16px; bottom: 8px; z-index: 20; display: flex; align-items: center; gap: 6px;
  max-width: 60vw; padding: 2px 10px; border-radius: 999px; font: 11px/18px system-ui, sans-serif; cursor: default;
  background: var(--orca-card); color: var(--orca-muted-foreground); border: 1px solid var(--orca-border);
  transition: opacity 0.2s ease;
}
.orca-lsp-badge-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--orca-success, #22c55e); }
.orca-lsp-badge[data-state='error'] .orca-lsp-badge-dot { background: var(--orca-destructive); }
.orca-lsp-badge-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.orca-lsp-badge[data-quiet]:not(:hover) { padding: 5px; opacity: 0.6; }
.orca-lsp-badge[data-quiet]:not(:hover) .orca-lsp-badge-label { display: none; }
@media (prefers-reduced-motion: reduce) { .orca-lsp-badge { transition: none; } }
`

let badge: HTMLElement | null = null
let quietTimer: ReturnType<typeof setTimeout> | undefined

function element(): HTMLElement {
  if (!badge) {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.append(style)
    badge = document.createElement('div')
    badge.className = 'orca-lsp-badge'
    badge.setAttribute('role', 'status')
    document.body.append(badge)
  }
  return badge
}

export function showServerBadge(state: 'ready' | 'error', detail: string): void {
  const pill = element()
  const dot = document.createElement('span')
  dot.className = 'orca-lsp-badge-dot'
  const label = document.createElement('span')
  label.className = 'orca-lsp-badge-label'
  label.textContent = state === 'ready' ? detail : say('lsp.stopped')
  pill.replaceChildren(dot, label)
  pill.dataset.state = state
  pill.title = state === 'ready' ? `${say('lsp.ready')}: ${detail}` : detail
  delete pill.dataset.quiet
  clearTimeout(quietTimer)
  // A server that stopped stays said in full: that is news the person has to act on.
  if (state === 'ready') {
    quietTimer = setTimeout(() => (pill.dataset.quiet = ''), QUIET_AFTER_MS)
  }
}
