# Model Quick Switch

A SillyTavern extension that adds a small floating model switcher to the API connections window. It lets you swap between models **within the same provider** without opening the full connections panel or touching connection profiles, and it remembers your models per provider for one-click switching.

## What it does

A swap-arrows button appears next to the Connection Profiles dropdown in the API connections window (plug icon). It opens a floating panel with two tabs:

- **Remembered** — the models you saved for the current provider. Clicking one applies it to the live connection *and* writes it into the active connection profile. SillyTavern normally only stores the model when you press the profile's Update button; this extension updates the stored profile for you, touching only the model field (an "Exclude from profile" setting on the model field is honored).
- **Available** — the provider's model list (the same one the connections window shows) plus a free-text Model ID field, so you can remember a model even before the list has loaded.

Behavior notes:

- The panel can be dragged anywhere and minimized to its title bar; position and state survive page reloads. The model currently in use is always visible: it is highlighted in the Remembered tab (shown as a check-mark row even when not remembered), offered as the **★ Currently selected** first entry of the Available tab's dropdown, and auto-filled into the Model ID field whenever you open the panel or the live model changes.
- Models are remembered **per provider** (e.g. your custom OpenAI-compatible endpoint, OpenRouter, Google), so you can never apply a model id that belongs to a different provider. Switching providers shows that provider's own list.
- Works with all chat-completion sources that expose a model field (OpenAI, Claude, OpenRouter, Google, Mistral, DeepSeek, Groq, xAI, custom endpoints, …). Text-completion backends (koboldCpp, textgen, NovelAI, …) are not supported and show a notice instead.

## Install

In SillyTavern, go to **Extensions → Install extension**, paste

```
https://github.com/Flythos/Model-Quick-Switch
```

and confirm. Then restart SillyTavern and hard-refresh the browser tab (Ctrl+F5).

Requires SillyTavern 1.19.x. Connection Profiles are used for the profile-update part; without an active profile the extension just sets the live model.

## Uninstall

Delete the extension folder from `data/<your-user-handle>/extensions/` and refresh. Your remembered models live under the `modelQuickSwitch` key in the SillyTavern settings; deleting that key cleans up the rest.

## How it works

- Applying a model sets the same DOM control the connections window uses and fires SillyTavern's own change handler, so settings persistence, context-size caps and model-change events all behave as if you picked the model by hand.
- The stored profile is updated surgically: only the profile's `model` field is written (honoring its exclude list), then the same events the profile Update button emits are fired so profile details and other extensions stay in sync.
- The model lists shown are the ones SillyTavern caches when you connect to a provider — the extension never talks to the API provider itself.
- No auto-connect: if you are disconnected, applying a model still requires you to press Connect.

## Development

No build step; plain ES modules + jQuery, loaded by SillyTavern as-is. `npm test` runs the store logic tests, `npm run audit` checks every SillyTavern import used by the code against the ST sources.
