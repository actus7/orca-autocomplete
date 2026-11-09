// Every user-facing string, in English and Brazilian Portuguese. The panel and the worker share it.

export type Locale = 'en' | 'pt'

export function pickLocale(tag: string | null | undefined): Locale {
  return /^pt(?![a-z])/i.test(tag ?? '') ? 'pt' : 'en'
}

const en = {
  title: 'Autocomplete',
  tagline: 'Gray suggestions as you type, from the AI provider you choose.',
  'state.on': 'Active',
  'state.off': 'Off',
  'state.setup': 'Needs setup',
  'state.slow': 'Slow',
  'state.error': 'Error',
  'bar.off': 'off',
  'bar.setup': 'set up',
  'bar.slow': 'slow',
  'bar.error': 'error',
  switch: 'Suggest as I type',
  'setup.title': 'Finish setup',
  'setup.withKey': 'Choose a provider, paste your API key and press Save and test.',
  'setup.noKey': 'Check the model and press Save and test.',
  'ready.body':
    'Ready. Type in any file and pause for a moment: the suggestion appears in gray. Tab accepts it, Esc dismisses it.',
  'stats.line': 'Last answer {seconds} s · Suggestions shown: {count}',
  'slow.title': 'Answers are too slow',
  'slow.body':
    'The provider took more than {seconds} s, so Orca dropped the suggestion. Try a faster model.',
  'error.title': 'The last request failed',
  'provider.title': 'Provider',
  provider: 'Provider',
  apiKey: 'API key',
  'apiKey.empty': 'Paste your key',
  'apiKey.saved': 'Saved. Type to replace it.',
  'apiKey.hint': 'Stored encrypted and only sent to {host}.',
  'apiKey.optional': 'Optional. Leave it empty if your server needs no key.',
  'apiKey.local': 'No key needed: this runs on your computer.',
  model: 'Model',
  'model.hint': 'Pick a fast one: answers slower than {seconds} s are dropped.',
  baseUrl: 'Base URL',
  'baseUrl.hint': 'For OpenAI-style APIs this usually ends in /v1.',
  saveTest: 'Save and test',
  testing: 'Testing…',
  'test.ok.title': 'Connected',
  'test.ok.body': 'Answered in {seconds} s. Now type in any file and pause for a moment.',
  'test.fail.title': 'Could not connect',
  'test.needsSetup': 'Add a base URL that starts with http:// or https:// and a model.',
  'help.title': 'How it works',
  'help.pause': 'Type, then pause for a moment. A gray suggestion appears.',
  'help.accept': 'Tab accepts it. Esc, or just keep typing, dismisses it.',
  'help.bar': 'The lightning icon in the status bar turns autocomplete on or off.',
  'help.privacy':
    'Privacy: the text around your cursor goes only to the provider you chose. There is no tracking.',
  'preset.openai': 'OpenAI',
  'preset.anthropic': 'Anthropic (Claude)',
  'preset.openrouter': 'OpenRouter',
  'preset.ollama': 'Ollama (on your computer)',
  'preset.custom-openai': 'Other, OpenAI-compatible',
  'preset.custom-anthropic': 'Other, Anthropic-compatible',
  'tip.setup': 'Autocomplete needs setup. Open the Autocomplete panel in the right sidebar.',
  'tip.off': 'Autocomplete is off. Click to turn it on.',
  'tip.on':
    'Autocomplete on · {where} · last answer {ms} ms · {count} shown · click to turn off',
  'tip.onFresh': 'Autocomplete on · {where} · waiting for the first suggestion · click to turn off',
  'tip.slow':
    'Answers take over {seconds} s and get dropped · {where} · try a faster model · click to turn off',
  'tip.error': 'The last request failed: {reason} · click to turn off',
  'cmd.on': 'Autocomplete is on.',
  'cmd.off': 'Autocomplete is off.',
  'cmd.testOk': 'Test passed: answered in {seconds} s.',
  'cmd.testFail': 'Test failed: {reason}',
  'err.auth': 'The provider rejected the key. Check it and press Save and test.',
  'err.notFound': 'Model or address not found. Check the model name and the base URL.',
  'err.rateLimit': 'Rate limit reached. Wait a moment or pick another model.',
  'err.server': 'The provider had a problem (HTTP {status}). Try again in a moment.',
  'err.http': 'The provider answered HTTP {status}.',
  'err.network': 'Could not reach {host}. Check the address and your connection.',
  'err.networkLocal': 'Could not reach {host}. Is the server running?',
  'err.timeout': 'No answer in {seconds} s.'
} as const

export type Key = keyof typeof en
export const KEYS = Object.keys(en) as Key[]

const pt: Record<Key, string> = {
  title: 'Autocomplete',
  tagline: 'Sugestões em cinza enquanto você digita, do provedor de IA que você escolher.',
  'state.on': 'Ativo',
  'state.off': 'Desligado',
  'state.setup': 'Falta configurar',
  'state.slow': 'Lento',
  'state.error': 'Erro',
  'bar.off': 'off',
  'bar.setup': 'configurar',
  'bar.slow': 'lento',
  'bar.error': 'erro',
  switch: 'Sugerir enquanto eu digito',
  'setup.title': 'Termine a configuração',
  'setup.withKey': 'Escolha um provedor, cole sua chave de API e toque em Salvar e testar.',
  'setup.noKey': 'Confira o modelo e toque em Salvar e testar.',
  'ready.body':
    'Pronto. Digite em qualquer arquivo e faça uma pausa: a sugestão aparece em cinza. Tab aceita, Esc descarta.',
  'stats.line': 'Última resposta {seconds} s · Sugestões mostradas: {count}',
  'slow.title': 'Respostas lentas demais',
  'slow.body':
    'O provedor demorou mais de {seconds} s e o Orca descartou a sugestão. Tente um modelo mais rápido.',
  'error.title': 'A última requisição falhou',
  'provider.title': 'Provedor',
  provider: 'Provedor',
  apiKey: 'Chave de API',
  'apiKey.empty': 'Cole sua chave',
  'apiKey.saved': 'Salva. Digite para substituir.',
  'apiKey.hint': 'Guardada criptografada e enviada só para {host}.',
  'apiKey.optional': 'Opcional. Deixe vazio se o seu servidor não pedir chave.',
  'apiKey.local': 'Sem chave: isso roda no seu computador.',
  model: 'Modelo',
  'model.hint': 'Escolha um modelo rápido: respostas acima de {seconds} s são descartadas.',
  baseUrl: 'URL base',
  'baseUrl.hint': 'Em APIs no estilo OpenAI, costuma terminar em /v1.',
  saveTest: 'Salvar e testar',
  testing: 'Testando…',
  'test.ok.title': 'Conectado',
  'test.ok.body': 'Respondeu em {seconds} s. Agora digite em qualquer arquivo e faça uma pausa.',
  'test.fail.title': 'Não foi possível conectar',
  'test.needsSetup': 'Informe uma URL base que comece com http:// ou https:// e um modelo.',
  'help.title': 'Como funciona',
  'help.pause': 'Digite e faça uma pausa. Uma sugestão em cinza aparece.',
  'help.accept': 'Tab aceita. Esc, ou continuar digitando, descarta.',
  'help.bar': 'O raio na barra de status liga ou desliga o autocomplete.',
  'help.privacy':
    'Privacidade: o texto ao redor do cursor vai apenas para o provedor que você escolheu. Não há rastreamento.',
  'preset.openai': 'OpenAI',
  'preset.anthropic': 'Anthropic (Claude)',
  'preset.openrouter': 'OpenRouter',
  'preset.ollama': 'Ollama (no seu computador)',
  'preset.custom-openai': 'Outro, compatível com OpenAI',
  'preset.custom-anthropic': 'Outro, compatível com Anthropic',
  'tip.setup': 'Falta configurar. Abra o painel Autocomplete na barra lateral direita.',
  'tip.off': 'Autocomplete desligado. Clique para ligar.',
  'tip.on':
    'Autocomplete ligado · {where} · última resposta {ms} ms · {count} mostradas · clique para desligar',
  'tip.onFresh': 'Autocomplete ligado · {where} · aguardando a primeira sugestão · clique para desligar',
  'tip.slow':
    'Respostas levam mais de {seconds} s e são descartadas · {where} · tente um modelo mais rápido · clique para desligar',
  'tip.error': 'A última requisição falhou: {reason} · clique para desligar',
  'cmd.on': 'Autocomplete ligado.',
  'cmd.off': 'Autocomplete desligado.',
  'cmd.testOk': 'Teste passou: respondeu em {seconds} s.',
  'cmd.testFail': 'Teste falhou: {reason}',
  'err.auth': 'O provedor recusou a chave. Confira e toque em Salvar e testar.',
  'err.notFound': 'Modelo ou endereço não encontrado. Confira o nome do modelo e a URL base.',
  'err.rateLimit': 'Limite de uso atingido. Aguarde um instante ou escolha outro modelo.',
  'err.server': 'O provedor teve um problema (HTTP {status}). Tente de novo em instantes.',
  'err.http': 'O provedor respondeu HTTP {status}.',
  'err.network': 'Não foi possível alcançar {host}. Confira o endereço e a conexão.',
  'err.networkLocal': 'Não foi possível alcançar {host}. O servidor está rodando?',
  'err.timeout': 'Sem resposta em {seconds} s.'
}

const TABLES: Record<Locale, Record<Key, string>> = { en, pt }

/** Looks a string up and fills its `{name}` placeholders. */
export function translate(
  locale: Locale,
  key: Key,
  vars: Record<string, string | number> = {}
): string {
  return TABLES[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  )
}

export type Translate = (key: Key, vars?: Record<string, string | number>) => string

export function translator(locale: Locale): Translate {
  return (key, vars) => translate(locale, key, vars)
}
