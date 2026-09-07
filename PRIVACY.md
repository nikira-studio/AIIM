# AIIM privacy notes

AI Instant Messenger stores the buddy list, user profile, chat history, and buddy memories in the current Windows user's application-data folder. It does not include analytics or advertising code.

AIIM sends the following information to the provider chosen for a buddy when that provider generates a reply:

- the buddy's character instructions;
- relevant chat messages;
- the user's profile details;
- that buddy's saved memories.

Optional spontaneous check-ins can contact a provider while AIIM is open, the user is Available, and the buddy is eligible to check in. Automatic memory learning can make a second provider request after a visible reply. Users can disable check-ins, edit or wipe memory, clear history, and remove buddies.

AIIM stores API keys and ChatGPT subscription tokens separately through Electron `safeStorage`, which uses Windows credential encryption. Portable AIIM backups and exported character files never contain credentials. During backup restore, AIIM keeps a saved API key only when the provider type and service address are unchanged; it deletes keys for changed or removed providers. Data remains subject to the privacy terms of the provider selected by the user.

The Windows uninstaller offers to remove all local AIIM data, including saved credentials. Keeping that data is the default so uninstalling or upgrading does not unexpectedly erase chats. An upgrade never shows the removal question.
