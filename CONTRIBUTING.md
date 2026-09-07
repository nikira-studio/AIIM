# Contributing to AIIM

AIIM is a hobby project from Nikira Studio, released under the MIT License. Bug fixes, provider improvements, accessibility work, and original character packs are welcome.

## Set up a development copy

1. Install a current Node.js release on Windows.
2. Run `npm install`.
3. Run `npm run dev` to open the development app.
4. Run `npm run verify` before sharing a change.

Do not commit API keys, subscription sessions, local chat data, generated build folders, or copyrighted character material that you do not have permission to redistribute.

## Add a character

Read `src/templates/README.md` and validate the file against `src/templates/aiim-character.schema.json`. Character packs must stay app-agnostic. Put setting-specific facts in the character definition, not in shared AIIM behavior.

## Add a provider

Keep provider authentication and protocol details inside the provider adapter. Buddies should continue to refer to a provider ID and a vendor model ID rather than depending on vendor-specific response formats.
