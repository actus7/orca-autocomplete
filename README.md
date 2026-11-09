# Autocomplete for Orca

Inline AI code completion (ghost text, like Copilot) in Orca's editor. Bring your own provider:
anything that speaks the **OpenAI** (`/chat/completions`) or **Anthropic** (`/v1/messages`) API.

> Needs an Orca release that includes the `editor.inlineCompletion` plugin hook (`engines.orca >=1.4.255`).

## Setup

1. Install the plugin from Settings → Plugins.
2. Settings → Plugins → Autocomplete: choose the format, base URL and model.
3. Open the **Autocomplete** panel, paste your API key, press **Save key**, then **Test connection**.
4. Type in any file and pause for a moment: the suggestion appears as ghost text. `Tab` accepts it.

The key is stored in Orca's encrypted plugin secrets and is only sent to the base URL you set.
Leave it empty for local servers.

## Provider examples

| Provider | Format | Base URL | Model |
| --- | --- | --- | --- |
| OpenAI | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama (local) | OpenAI | `http://localhost:11434/v1` | `qwen2.5-coder:1.5b` |
| OpenRouter | OpenAI | `https://openrouter.ai/api/v1` | any fast model |
| Anthropic | Anthropic | `https://api.anthropic.com` | a Haiku model |

Pick a **fast** model: Orca drops a hook answer that takes longer than about 2 seconds.

## Privacy

On each pause the text around your cursor (up to ~6,000 characters before and ~2,000 after, plus the
file path and language) is sent to the provider you configured, and nowhere else. The plugin has no
telemetry. Turn it off with the **Enabled** setting.

## Development

```sh
npm test   # request/response logic, no dependencies (Node 22.18+)
```

MIT licensed.
