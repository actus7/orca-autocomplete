<p align="center"><img src="assets/cover.png" alt="Autocomplete for Orca: gray suggestions as you type, from the AI you choose" width="820"></p>

# Autocomplete for Orca

Gray suggestions as you type, from the AI provider you choose. Press **Tab** to accept one, **Esc** to dismiss it.

Works with **OpenAI**, **Anthropic**, **OpenRouter**, **Ollama** (free, on your computer) and any API that speaks the OpenAI or Anthropic format.

> **Requires Orca 1.4.256 or newer.** That release adds the `editor.inlineCompletion` hook this plugin uses.

<p align="center"><img src="assets/screenshot-editor.png" alt="A gray suggestion at the cursor, with a Tab key hint" width="720"></p>

## Quick start

It takes about two minutes.

1. **Install** the plugin from *Settings → Plugins*.
2. **Open the Autocomplete panel**: the lightning icon in the right sidebar.
3. **Choose your provider**, paste your API key and press **Save and test**. Ollama needs no key.
4. **Type in any file and pause for a moment.** The suggestion appears in gray.

If something is not right, the panel says what happened and what to do next.

## Choose a provider

| Provider | API key | Notes |
| --- | --- | --- |
| OpenAI | Yes | Pick a small, fast model. |
| Anthropic (Claude) | Yes | A Haiku-class model is a good fit. |
| OpenRouter | Yes | One key, many models. |
| Ollama | No | Runs on your computer: free and private. Start Ollama first. |
| Other, OpenAI-compatible | Optional | Any gateway or proxy with a `/chat/completions` endpoint. |
| Other, Anthropic-compatible | Optional | Any endpoint with a `/v1/messages` endpoint. |

**Speed matters more than size.** Orca drops a suggestion that takes longer than about 2 seconds, so choose a small, fast model. The panel pre-fills a sensible one for each provider.

## The status bar

The lightning icon at the bottom of Orca shows the state at a glance. Click it to turn Autocomplete on or off.

| Color | Meaning |
| --- | --- |
| Green | Active. Shows how long the last answer took. |
| Gray | Off. |
| Yellow, "set up" | Finish the setup in the panel. |
| Yellow, "slow" | The provider answers too slowly; try a faster model. |
| Red | The last request failed. Hover for the reason and what to do. |

The command palette also has **Autocomplete: Turn on or off** and **Autocomplete: Test connection**.

## Privacy

When you pause typing, the text around your cursor (up to about 6,000 characters before it and 2,000 after, plus the file name and language) is sent to the provider **you** chose, and nowhere else. Your API key is stored encrypted by Orca and only sent to that provider. The plugin has no telemetry and no analytics. Turn it off any time from the panel or the status bar.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Nothing appears | Pause for a moment after typing. Check that the status bar icon is green. Not every spot gets a suggestion. |
| "The provider rejected the key" | Paste the key again in the panel and press **Save and test**. Check that it belongs to the provider you picked. |
| "Model or address not found" | Check the model name and, for the *Other* providers, the base URL. |
| "Could not reach … Is the server running?" | For Ollama, start it. Otherwise check the address and your connection. |
| Yellow "slow" | Pick a smaller model, or one hosted closer to you. |
| "Rate limit reached" | Wait a moment, or pick another model. |

## Português (pt-BR)

O painel, a barra de status e os avisos aparecem em português quando o Orca está em pt-BR.

**Começo rápido**
1. Instale o plugin em *Settings → Plugins*.
2. Abra o painel **Autocomplete** (o raio na barra lateral direita).
3. Escolha o provedor, cole a chave de API e toque em **Salvar e testar**. O Ollama não precisa de chave.
4. Digite em qualquer arquivo e faça uma pausa. A sugestão aparece em cinza; **Tab** aceita e **Esc** descarta.

**Privacidade:** o texto ao redor do cursor vai apenas para o provedor que você escolheu. A chave fica guardada criptografada pelo Orca. Não há rastreamento.

## For developers

```sh
npm test    # request/response logic, UI strings, worker behavior; no dependencies (Node 22.18+)
```

The listing images are rendered from `assets/templates` with `assets/build.mjs` (needs Playwright; see the header of that file).

MIT licensed.
