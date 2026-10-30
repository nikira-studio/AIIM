# AIIM 1.1 release checklist

Use this checklist after Phase A, Phase B, and Phase C in `PLAN.md` are complete. Do not publish an intermediate phase build.

## Automated checks

- [ ] Run `npm ci` on a clean Windows checkout.
- [ ] Run `npm audit` and record the result.
- [ ] Run `npm run verify`.
- [ ] Run `npm run test:ui:built` on an interactive Windows runner.
- [ ] Run the memory-quality and Buddy Chat context test sets.

## Provider checks

- [ ] Send, stop, fail, and retry a reply through OpenAI API.
- [ ] Test ChatGPT subscription sign-in, model discovery, restart, and sign-in expiry.
- [ ] Send a reply through Anthropic.
- [ ] Send a reply through Google Gemini.
- [ ] Send a reply through MiniMax and confirm hidden thinking does not leave blank space.
- [ ] Send a reply through OpenRouter.
- [ ] Send a reply through an OpenAI-compatible local server.
- [ ] Send a reply through Ollama with and without Ollama running.

## MCP checks

- [ ] Add, test, disable, reconnect, and remove a Streamable HTTP MCP connection.
- [ ] Add, test, stop, and remove a local `stdio` MCP connection without leaving a child process running.
- [ ] Test no-auth and manually saved-bearer-token web services without exposing secrets in logs or backups. Browser OAuth and secure local environment values are not part of 1.1.
- [ ] Confirm that a new connection grants no tools and that each buddy receives only its reviewed grants.
- [ ] Complete an MCP tool loop with an OpenAI-style API-key buddy (OpenAI, MiniMax, OpenRouter, or compatible service). Confirm that unsupported providers continue normal chat without receiving tool definitions.
- [ ] Test Deny, Allow once, and Always allow. Confirm that only Always allow trusts the exact buddy-tool pair, and removing the permission or changing the tool definition restores review.
- [ ] Change and remove a granted tool. Confirm that AIIM suspends the grant instead of silently substituting another tool.
- [ ] Test cancellation, timeout, malformed arguments, oversized results, multiple tool calls, an unavailable server, and an unsupported MCP extension.
- [ ] Restore a backup with MCP configuration and confirm that every restored connection remains disabled pending review.
- [ ] Confirm that raw tool calls and results do not enter transcripts, summaries, memories, or character exports.

## Windows checks

- [ ] Test a clean install, upgrade from 1.0.0, uninstall, and reinstall.
- [ ] Confirm a normal uninstall offers to remove local data and defaults to keeping it.
- [ ] Confirm an upgrade never displays the data-removal question.
- [ ] Confirm the buddy-list X hides AIIM, the tray robot reopens it, and both Quit commands stop it.
- [ ] Test at 100, 125, 150, and 200 percent display scaling.
- [ ] Test the minimum buddy-list, chat, Preferences, and Help window sizes.
- [ ] Test keyboard-only navigation and modal focus.
- [ ] Test sleep, wake, clock changes, and spontaneous-message scheduling.
- [ ] Record whether the installer is signed. If it is unsigned, publish its SHA-256 value and the SmartScreen notice.

## Data checks

- [ ] Upgrade a populated 1.0.0 data folder without losing providers, buddies, chats, profile details, portraits, or memories.
- [ ] Damage `chats.json` and confirm AIIM explains that it restored `chats.backup.json`.
- [ ] Export a backup, change the app data, restore the backup, and reconnect credentials.
- [ ] Export and import buddies with no portrait, a chosen portrait, and a bundled portrait.
- [ ] Restart AIIM and confirm that Buddy Chats retain their participants, speaker names, transcript, and summaries.

## Distribution checks

- [ ] Review examples, tests, templates, screenshots, and build logs for real names, private conversations, local user paths, email addresses, private network addresses, and credentials.
- [ ] Complete product-name and visual-brand review.
- [ ] Confirm every bundled character and portrait is original or separately licensed.
- [ ] Test ChatGPT subscription sign-in and confirm that its service limitations are described accurately.
- [ ] Confirm that GitHub private vulnerability reporting or another private security contact is available.
- [ ] Update Help, the README, the changelog, the character-format guide, and the release notes.
- [ ] Publish the privacy notes, security reporting instructions, release notes, and user guide with the installer.
- [ ] Publish the MIT license and source code.
