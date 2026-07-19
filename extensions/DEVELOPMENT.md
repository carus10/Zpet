# Zpet Extension Development Guide

## Extension Structure

Each extension lives in its own folder inside `extensions/`:

```
extensions/
  my-extension/
    manifest.json   # Required: metadata and settings schema
    main.js         # Required: extension entry point
    settings.json   # Auto-generated: user settings (do not commit)
```

## manifest.json

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "What this extension does",
  "author": "Your Name",
  "main": "main.js",
  "settingsSchema": [
    {
      "key": "option1",
      "label": "Option Label",
      "type": "select",
      "options": ["value1", "value2"],
      "default": "value1"
    },
    {
      "key": "enabled",
      "label": "Enable Feature",
      "type": "toggle",
      "default": true
    },
    {
      "key": "interval",
      "label": "Interval (ms)",
      "type": "number",
      "min": 100,
      "max": 60000,
      "default": 5000
    }
  ]
}
```

## main.js API

Your extension must export these functions:

### `activate(context)` — Required
Called when the extension is enabled and the engine starts.

**context** object provides:
- `context.log(message)` — Log to console
- `context.getSettings()` — Get current settings object
- `context.saveSettings(data)` — Persist settings

### `deactivate()` — Optional
Called when the extension is disabled or the engine stops.

### `onStateChange(newState, prevState)` — Optional
Called whenever the pet state changes.

States: `"idle"`, `"working"`, `"waiting"`

### `onSettingsChange(newSettings)` — Optional
Called when the user saves new settings from the UI.

## Installing Extensions

### From this repository:
1. Copy the extension folder from `extensions/` to your Zpet data directory:
   - Windows: `%APPDATA%/zpet/zpet_data/extensions/`
   - macOS: `~/Library/Application Support/zpet/zpet_data/extensions/`
   - Linux: `~/.config/zpet/zpet_data/extensions/`
2. Restart Zpet or toggle the extension in the Extensions tab.

### Publishing your extension:
1. Create a folder in `extensions/` with your extension
2. Include `manifest.json` and `main.js`
3. Submit a Pull Request to this repository

## Example

See `extensions/example-notifier/` for a complete working example.
