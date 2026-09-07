# AIIM character template format

AIIM imports versioned UTF-8 JSON files ending in `.json` or `.aiim-character`. The three required fields are `displayName`, `screenName`, and `systemPrompt`. Every other field is optional.

The machine-readable definition is [`aiim-character.schema.json`](./aiim-character.schema.json). The simplest way to create a file is to build a buddy in Preferences and click **Export**. Exported files never contain a provider, model, credential, chat history, or memory.

Built-in packs use exactly this format in `src/templates/built-in-characters`. During development, adding another valid JSON file to that folder automatically adds it to the character picker.

```json
{
  "schemaVersion": 1,
  "id": "friendly-ani",
  "displayName": "Ani",
  "screenName": "aniOnline",
  "tagline": "A perceptive friend who checks in",
  "systemPrompt": "You are Ani, a warm and perceptive friend...",
  "color": "#6b4ea0",
  "statusMessage": "around, mostly",
  "awayMessage": "brb — real life called",
  "typingStyle": "measured",
  "profileBio": "Good listener. Bad at leaving dishes until morning.",
  "profileLocation": "Somewhere with decent coffee",
  "profileInterests": "music, old computers, people",
  "profileQuote": "Tell me the version you almost didn't say.",
  "presencePattern": "varied",
  "notificationSound": "soft",
  "fontFamily": "Verdana",
  "fontColor": "#4c327e",
  "relationshipNotes": ""
}
```

## Portraits

For an easy-to-edit two-file package, add `"avatarFile": "ani.png"` and keep the image beside the character file. Paths may point into a subfolder but cannot leave the character file's folder.

For a single portable file, add `"avatarDataUrl": "data:image/png;base64,..."`. AIIM accepts PNG, JPEG, WebP, and GIF images. Imported portraits are copied into AIIM's managed data folder, so the source files can be moved afterward.

Character files must be smaller than 1 MB before decoding an embedded portrait. Portraits must be smaller than 10 MB.
