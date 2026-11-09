# Changelog

A listed version is permanent in Orca's catalog, so every change ships as a new version.

## 0.2.0

- **Snippets**, with no AI and no language server: short words that expand into common code for TypeScript, JavaScript, Python, Go, Rust, Java, C#, C and C++, PHP, Ruby, Shell and SQL. They open with Ctrl+Space, so they never compete with the gray suggestion.
- **Postfix templates**, also with no AI: `ready.if`, `.else`, `.null`, `.not`, `.var`, `.return`, `.log`, `.for`, `.await` and the equivalents for Python, Go, Rust, Java and C#. Nothing is offered in a string or a comment.
- **Accept a suggestion a line at a time** with Ctrl+Alt+→ (a word at a time was already Ctrl+→).
- The browser tests now also load the built bundle (`editor/dist`) the way Orca does, so what ships is what is tested.
- README: keys, what the editor does with the AI off, and what is not here yet.

## 0.1.0

First public release.

- Gray inline suggestions from the provider you choose: OpenAI, Anthropic, OpenRouter, Mistral / Codestral, Ollama, or any OpenAI- or Anthropic-compatible API. Chat or native fill-in-the-middle, depending on the provider.
- An editor of its own (Monaco) that matches Orca's file editor, follows its theme and settings, and works on any Orca from 1.4.248 with no change to Orca.
- Language servers found on your computer, for errors, completion with automatic imports, hover, signature help, definitions, references, outline, formatting, rename and quick fixes.
- Model picker with the provider's own list, a speed test and measured latency; statistics kept on your computer; the panel says where your code goes; nothing is sent when a secret is near the cursor; prose suggestions in Markdown and text files.
