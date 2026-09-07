# Security

## Reporting a problem

AIIM uses [GitHub private vulnerability reporting](https://github.com/nikira-studio/AIIM/security/advisories/new) when the repository setting is enabled. Enable it before public release. Do not include API keys, subscription tokens, private chat history, or personal profile details. Include the AIIM version, Windows version, provider type, steps to reproduce, and the exact error with secrets removed.

## Local protections

- Renderer windows use Electron context isolation, sandboxing, and no Node.js integration.
- Renderer navigation and pop-up windows are restricted.
- A content security policy blocks injected scripts and embedded objects.
- Windows credential encryption protects saved provider secrets.
- Character files have path, file-type, and size checks.
- Portable backups exclude credentials. Existing keys are removed before a changed provider type or address is saved.
- Restored portraits can only refer to AIIM-managed local portrait files. Network and arbitrary local file URLs are ignored.

AIIM does not treat imported character files as code and character files cannot grant provider or tool access.

