<p align="center"><img src="assets/cover.png" alt="Autocomplete for Orca: gray suggestions as you type, from the AI you choose" width="820"></p>

# Autocomplete for Orca

Gray suggestions as you type, from the AI provider you choose. Press **Tab** to accept one, **Esc** to dismiss it.

Works with **OpenAI**, **Anthropic**, **OpenRouter**, **Ollama** (free, on your computer) and any API that speaks the OpenAI or Anthropic format.

> **Requires Orca 1.4.248 or newer.** The plugin brings its own editor (Monaco), so it does not depend on any change to Orca itself.

<p align="center"><img src="assets/screenshot-editor.png" alt="A gray suggestion at the cursor, with a Tab key hint" width="720"></p>

## Quick start

It takes about two minutes.

1. **Install** the plugin from *Settings → Plugins*.
2. **Open the Autocomplete panel**: the lightning icon in the right sidebar.
3. **Choose your provider**, paste your API key, then type a model name or pick one from the list your provider offers. Press **Save and test**. Ollama needs no key.
4. **Open a code file and pause while typing.** The suggestion appears in gray.

Files in the languages below open in the plugin's editor by default. Files Orca always opens itself (`.ts`, `.md`, `.yaml`, `.env` and a few more) stay in Orca's editor; switch them with the view toggle in the file's tab.

## The editor

A full code editor (Monaco, the engine behind VS Code) that follows Orca's theme and stays in step with the file: saving, unsaved-change and outside-change handling are Orca's own.

- **Looks like Orca's editor:** it sits in the same tab, so the path bar, the view toggle, saving and the outside-change banner are Orca's own. Inside, it uses the same options and the same stock dark or light theme as Orca's editor (line numbers, no minimap, wrapped lines, 2-space tabs, no caret animation), and it follows the app when you switch between dark and light.
- **Matching your Orca settings:** Orca does not share its editor settings (font, size, wrap, minimap) with plugins yet, so set the same values in *Settings → Plugins → Autocomplete* (*Editor font*, *Editor font size*, *Wrap long lines*, *Show the minimap*). Leave them alone and the editor matches Orca's defaults. Changes apply immediately.
- **Languages with their own editor:** TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C and C++, PHP, Ruby, Swift, Shell, SQL, HTML. A **Code** editor handles CSS, SCSS, Less, XML, YAML, Markdown, Dart, Lua, R, PowerShell, Batch, Scala, Elixir, Clojure, Perl, F#, Julia, Terraform, Protocol Buffers, GraphQL and Dockerfile, recognising the language from the file's content.
- **Built in, nothing to install:** errors, completion, hover, go to definition and rename for TypeScript and JavaScript, HTML and CSS.
- **Language servers:** if a language server is installed on your computer (`rust-analyzer`, `gopls`, `pyright`, `clangd`, `typescript-language-server`, `kotlin-language-server`, `csharp-ls`, `intelephense`, `solargraph`, `sourcekit-lsp`, `bash-language-server`, `lua-language-server`, `yaml-language-server`, Dart's), the plugin starts it for files inside an Orca workspace and adds its errors, completion, hover, signature help, definitions, references, outline, formatting, rename and quick fixes. Turn it off in *Settings → Plugins → Autocomplete → Use language servers*. If the server cannot start, a red note in the editor's corner says why.
- **Limits:** a language server needs the file to be inside a local Orca workspace (remote hosts are not reached). Definitions and renames that touch other files are not followed yet. TypeScript needs the project's own `typescript` package in `node_modules`.

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

**Pick the model from the list, or type its name.** A short list (up to 15 models) is just a picker, with a small link for a model it does not show. A long list gets a search box and a second tab to type the name. If the list cannot be loaded, you get a plain text field. Models are listed with how fast they are: a time followed by a × (for example `0.6s (14×)`) is the median of your own real suggestions, which is the most honest number. Where it makes sense (Ollama, OpenRouter and other long lists, not OpenAI or Anthropic) **Test speed** times up to 12 models with one short request each, your current model first. A star marks the fastest, a cross marks models that failed or answered something unusable, and **Use the fastest** selects the best.

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

When you pause typing, the text around your cursor (up to about 6,000 characters before it and 2,000 after, plus the file name and language) is sent to the provider **you** chose, and nowhere else. Your API key is stored encrypted by Orca and is tied to the provider it was saved for: if you switch providers, the panel asks for a new key, and the old one is never sent to the new one. Language servers run on your computer and nothing from them is sent anywhere. The plugin has no telemetry and no analytics. Turn it off any time from the panel or the status bar.

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
3. Escolha o provedor, cole a chave de API, depois digite o nome de um modelo ou escolha na lista do seu provedor. Toque em **Salvar e testar**. O Ollama não precisa de chave.
4. Digite em qualquer arquivo e faça uma pausa. A sugestão aparece em cinza; **Tab** aceita e **Esc** descarta.

**Privacidade:** o texto ao redor do cursor vai apenas para o provedor que você escolheu. A chave fica guardada criptografada pelo Orca. Não há rastreamento.

## For developers

```sh
npm install
npm test            # worker, language server bridge, editor logic (Node 22.18+)
npm run typecheck   # types for the worker, the panel and the editor
npm run build       # bundles Monaco and the editor into editor/dist (commit the result)
```

Orca installs a plugin as plain files, so `editor/dist` is committed; its source is `editor/src`. `editor/languages.mjs` is the one table that drives the pages, the loaders and the `customEditors` of the manifest, and a test keeps them in line with Orca's limits (16 editors, 32 extensions each).

### Permissions

The plugin asks Orca for: its own settings, secrets and storage; and `workspace:read`, only to learn the folders of your local workspaces so a language server can be started in the right one. It does not ask to open files, run commands or change workspaces.

The listing images are rendered from `assets/templates` with `assets/build.mjs` (needs Playwright; see the header of that file).

MIT licensed.
