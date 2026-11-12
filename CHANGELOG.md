# Changelog

A listed version is permanent in Orca's catalog, so every change ships as a new version.

## 0.4.0

Needs Orca 1.4.257 or newer.

- **Orca's typography from Orca**: the editor's font, size (editor zoom included), weight, line height, ligatures, word wrap and minimap now come from `editor.readTypography` and `editor.typography.changed` (plugin host API 1.6), so a change shows up at once. The plugin no longer looks for Orca's data folder, walks parent processes or opens Orca's profile database. Thanks to @nwparker ([#1](https://github.com/actus7/orca-autocomplete/issues/1)).
- **LaTeX** ([#2](https://github.com/actus7/orca-autocomplete/pull/2), thanks to @MichielSaey): `.tex` and `.sty` files open in the plugin's editor, get the gray suggestions, and are coloured by a LaTeX grammar of its own (Monaco ships none). `texlab`, when it is installed, is started for them too, so completion covers the commands and the labels, citations and packages of the files around the open one. `.cls` and `.dockerfile` are left out of the editor's file types: Orca's catalog caps that list at 160 characters (`Dockerfile` itself still opens here).
- Fix ([#3](https://github.com/actus7/orca-autocomplete/pull/3), thanks to @mrWD): after a dot, the language server's members are listed again, above snippets and postfix templates.
- Fix ([#4](https://github.com/actus7/orca-autocomplete/pull/4), thanks to @mrWD): a file opened with unsaved edits gets its language server (the file it came from is found by the lines they share), and the editor attaches again when the worker lost the document, for example after the plugin was updated.

## 0.3.1

- Fix: the model picked in the panel is the one that is saved and tested. Saving used to put the previous model back and test that one.
- Fix: a model picked and not saved yet is kept when another setting changes, such as the on/off switch.
- Fix: the notice of a failed test goes away once suggestions work, instead of saying "could not connect" over them.

## 0.3.0

- **Next edit**: after you change a line and pause, the same change is offered where it is also needed. A rename is carried over to the other uses with no AI; with the setting on, your provider is asked for the rest. It is drawn in the theme's own colors for removed and added text, with the key that applies it (Tab) beside it.
- The panel shows the statistics as labelled numbers, asks twice before clearing them, writes dates the way your language does, and says so when the plugin does not answer instead of looking empty.
- The editor speaks Portuguese where the panel already did (actions, rename messages, the language server pill, the start failure).
- The language server pill folds down to a dot after a few seconds, so it stops covering the last lines; pointing at it shows the name again.
- Fix: an address that only starts like this computer (`localhost.example.com`, `127.0.0.1.nip.io`) is no longer said to run on this computer.
- Faster typing in large files: the editor no longer copies the whole file on every keystroke or for every suggestion.
- `npm test` works on Node 22 again, and `npm run test:panel` tests the panel in Orca's own runtime.

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
