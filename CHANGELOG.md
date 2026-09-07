# Changelog

## 1.0.0 RC7

- Limited saved and imported file portraits to AIIM's managed portrait directory, and rejected network file paths.
- Kept older HTTP compatible-provider records and their chats during restore, but disabled those providers until they use HTTPS or a loopback address.
- Saved credential changes before provider changes, so a failed credential update cannot restore a key for a changed endpoint.
- Bound every saved credential to its provider type and normalized address, so a failed provider save cannot send a new key to an older address after restart. Existing unbound keys are safely discarded once and can be re-entered in Preferences.
- Stopped keyless provider removal from requiring Windows credential encryption.
- Added ChatGPT Disconnect / switch account, which removes the saved refresh token and clears the active session. Removing a ChatGPT subscription provider now disconnects it too.
- Added a Windows CI workflow for install, audit, test, and build checks.

## 1.0.0 RC6

- Replaced the README preview with the latest Dial-Up Friends screenshot.
- Fully validated buddies, memories, conversations, messages, and profile data before restoring a backup.
- Rejected backup records with duplicate IDs, missing relationships, unsafe remote portraits, or invalid timestamps.
- Validated every privileged desktop request against the originating AIIM window.
- Preserved the final event from provider and ChatGPT subscription streams even when the connection closes without a trailing blank line.

## 1.0.0 RC5

- Returned keyboard focus to the message composer after clearing a chat.
- Changed the Windows UI smoke test to clear history through the visible button and verify that the composer accepts text afterward.

## 1.0.0 RC4

- Kept the Dial-Up Friends' daily lives, equipment, work, and cultural references within the late 1990s.
- Let period characters discuss later subjects without treating modern products or events as part of their own lives.
- Defined separate knowledge boundaries for Vince's arcade repair, Theo's record-store and radio work, Mara's film photography, and Lena's BBS administration.
- Added regression tests for each built-in character's setting and practical experience.

## 1.0.0 RC3

- Stopped buddies from claiming live access to systems, accounts, devices, or services that the conversation did not establish.
- Stopped buddies from inventing earlier tests, settings, messages, and shared experiences.
- Corrected Lena's BBS troubleshooting so it distinguishes direct dial-up, telnet, and web access without mixing them.
- Standardized build output as `dist`, `dist-electron`, and `releases`.
- Made Windows packaging clear the previous release before it creates the current installer.

## 1.0.0 RC2

- Replaced the fan-character pack with four original Dial-Up Friends and period-style portraits while keeping character-file import support.
- Added automatic history backups and damaged-file recovery.
- Added portable AIIM data backup and restore without credentials.
- Validated restored provider records and discarded saved keys when a provider type or address changes.
- Added provider connection checks and model-list timeouts.
- Added Stop and Retry controls for failed or slow replies.
- Moved automatic memory learning after visible reply delivery.
- Prevented offline buddies from starting spontaneous check-ins.
- Added buddy export with optional embedded portraits.
- Added in-app help and a versioned character JSON schema.
- Fixed provider and model dropdowns after providers are edited or removed.
- Pinned build dependencies and added an Electron UI smoke-test script.
- Added a Windows notification-area menu and made the buddy-list X hide the app instead of quitting.
- Added an explicit Quit command to every window.
- Made uninstall offer to erase local data, with keeping data as the default and no prompt during upgrades.
- Added MIT licensing, Nikira Studio publisher details, contribution notes, and a Git-friendly ignore file.
- Prevented Preferences from appearing interactive before saved data is ready.
- Kept the Model control visible during provider loading and added a clear progress message without blocking the rest of the buddy form.
- Disabled hidden Ollama thinking traces so Qwen 3.5 cannot spend its whole reply budget on text AIIM intentionally discards.
- Broadened automatic memory detection for natural first-person details.
- Restricted learned memories to structured, third-person facts and rejected conversational prose, multi-sentence replies, formatting, and speaker-relative language.

## 0.9.0

- Added Ollama, MiniMax, OpenAI-compatible providers, and ChatGPT subscription sign-in.
- Added saved history, editable memory, user profiles, presence, character packs, and human-paced replies.
