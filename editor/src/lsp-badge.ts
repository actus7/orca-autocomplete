// A small status pill in the corner of the editor: which language server is serving this file, or
// that it stopped. It takes its colors from Orca's theme and never covers the code.

let badge: HTMLElement | null = null

const TEXT = {
  en: { ready: 'Language server', error: 'Language server stopped' },
  pt: { ready: 'Servidor de linguagem', error: 'Servidor de linguagem parou' }
}

function element(): HTMLElement {
  if (!badge) {
    badge = document.createElement('div')
    badge.setAttribute('role', 'status')
    badge.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:8px', 'z-index:20', 'display:flex', 'align-items:center', 'gap:6px',
      'padding:2px 10px', 'border-radius:999px', 'font:11px/18px system-ui,sans-serif', 'pointer-events:none',
      'background:var(--orca-card)', 'color:var(--orca-muted-foreground)', 'border:1px solid var(--orca-border)'
    ].join(';')
    document.body.append(badge)
  }
  return badge
}

export function showServerBadge(state: 'ready' | 'error', detail: string): void {
  const words = TEXT[/^pt/i.test(orca.locale) ? 'pt' : 'en']
  const pill = element()
  const dot = document.createElement('span')
  dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:${state === 'ready' ? '#22c55e' : 'var(--orca-destructive)'}`
  const label = document.createElement('span')
  label.textContent = state === 'ready' ? detail : words.error
  pill.replaceChildren(dot, label)
  pill.title = state === 'ready' ? `${words.ready}: ${detail}` : detail
}
