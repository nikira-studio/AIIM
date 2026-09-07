# AIIM 1.0 release checklist

## Automated checks

- [ ] Run `npm ci` on a clean Windows checkout.
- [x] Run `npm audit` and record the result: 0 known vulnerabilities on 2026-09-07.
- [x] Run `npm run verify`.
- [x] Run `npm run test:ui:built` on an interactive Windows runner.

## Provider checks

- [ ] Send, stop, fail, and retry a reply through OpenAI API.
- [ ] Test ChatGPT subscription sign-in, model discovery, restart, and sign-in expiry.
- [ ] Send a reply through Anthropic.
- [ ] Send a reply through Google Gemini.
- [ ] Send a reply through MiniMax and confirm hidden thinking does not leave blank space.
- [ ] Send a reply through OpenRouter.
- [ ] Send a reply through an OpenAI-compatible local server.
- [ ] Send a reply through Ollama with and without Ollama running.

## Windows checks

- [ ] Test a clean install, upgrade from 0.9, uninstall, and reinstall.
- [ ] Confirm a normal uninstall offers to remove local data and defaults to keeping it.
- [ ] Confirm an upgrade never displays the data-removal question.
- [ ] Confirm the buddy-list X hides AIIM, the tray robot reopens it, and both Quit commands stop it.
- [ ] Test at 100, 125, 150, and 200 percent display scaling.
- [ ] Test the minimum buddy-list, chat, Preferences, and Help window sizes.
- [ ] Test keyboard-only navigation and modal focus.
- [ ] Test sleep, wake, clock changes, and spontaneous-message scheduling.
- [ ] Sign and timestamp the installer, then verify its Authenticode signature.

## Data checks

- [ ] Upgrade a populated 0.9 data folder without losing providers, buddies, chats, profile details, or memories.
- [ ] Damage `chats.json` and confirm AIIM explains that it restored `chats.backup.json`.
- [ ] Export a backup, change the app data, restore the backup, and reconnect credentials.
- [ ] Export and import buddies with no portrait, a chosen portrait, and a bundled portrait.

## Distribution checks

- [ ] Review examples, tests, templates, screenshots, and build logs for real names, private conversations, local user paths, email addresses, private network addresses, and credentials.
- [ ] Complete product-name and visual-brand review.
- [ ] Confirm every bundled character and portrait is original or separately licensed.
- [ ] Confirm that ChatGPT subscription access uses a supported integration suitable for distribution.
- [ ] Publish the privacy notes, security contact, release notes, and user guide with the installer.
- [ ] Publish the MIT license and source code.
