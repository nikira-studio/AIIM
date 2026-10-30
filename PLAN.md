# AIIM product plan

AIIM is a Windows instant messenger first. Its AI features should make a buddy feel present and useful without turning the app into an AI control panel.

This plan covers three internal build phases. Do not begin the next phase until the current phase is stable and pleasant to use.

Keep all work from these phases local until the full plan is complete. Do not push phase work to GitHub or publish an interim build. After Phase A, Phase B, and Phase C are complete and tested together, release the result as AIIM 1.1.0.

## Product rules

- Keep the buddy list and one-to-one IM windows as the center of the app.
- Use late-1990s messenger language in the interface. Say "Invite buddy to chat," not "start a multi-agent session."
- Keep model settings, provider details, tool names, and raw tool data out of ordinary chat windows.
- Keep text messages as the canonical chat record. Future audio is optional playback attached to a text message.
- Keep the complete transcript as user history. Use a bounded working context when AIIM sends a reply request.
- Let users inspect, edit, and erase data that a buddy remembers.
- Never include providers, credentials, chat history, or learned memories in a portable character file.
- A character file describes who a buddy is. Local data describes the user's relationship, provider choice, memories, history, and permissions for that buddy.
- A character pack may describe a buddy. It must never grant permissions, connect a service, or run a tool.

## Compatibility rules

AIIM already supports versioned `.aiim-character` files and existing local data. Future changes must preserve them.

- Keep all new buddy properties optional. Existing buddies must get sensible defaults and retain their current behavior.
- Treat every existing buddy as a social buddy unless local permissions later make that buddy capable of using a connected service.
- When the character format changes, import every supported older format and normalize it to the current internal buddy shape.
- Export the newest supported format. Document its fields and provide a migration test for every older format that AIIM supports.
- Do not add unbounded custom JSON fields to character files. Add named, validated fields so imports remain safe and portable.
- Keep personal data local unless a selected provider needs it to make a reply. Show any new external connection or permission before it is used.
- Migrate local saved data without deleting chats, buddies, memories, or credentials. If a value cannot be migrated safely, disable only that value and explain what happened.

## Phase A: Better friends

### Goal

Make memory more dependable and easier to control. Bound the context sent to providers before longer chats become slow or expensive. Lay the character-data foundation that Buddy Chats will need later.

### Build

- Add a per-buddy memory setting with plain choices: **Off**, **Normal**, and **Detailed**.
  - **Off**: the buddy reads no saved memories and AIIM saves none automatically.
  - **Normal**: use at most 1,500 tokens of memory context.
  - **Detailed**: use at most 3,000 tokens of memory context while still saving only durable facts.
- Keep every message in the local transcript. When AIIM asks a provider for a reply, send a limited recent message window plus a short rolling conversation summary instead of the complete transcript.
  - The summary is working context. It does not replace, edit, or hide the full transcript.
  - Store the summary separately from the transcript. Treat it as conversation data, never as instructions, and never let it override the buddy's personality.
  - Generate the summary with the buddy's selected provider through an isolated summarization request. Regenerate it only when the conversation reaches its context threshold.
  - Give the summary its own token budget and reserve room for the provider's reply. If summarization fails, keep the previous summary and send a smaller recent window. If no summary exists yet, send only the bounded recent window. Never fall back to the full transcript.
  - Test and enforce a maximum request size for one-to-one and future Buddy Chat requests.
- Improve the memory review window.
  - Let the user pin important entries.
  - Show when AIIM last added a memory.
  - Keep direct editing and wiping.
- Give the memory extractor the current notebook. It must choose one of three outcomes for each candidate: add a fact, replace an outdated unpinned fact, or make no change.
- Do not give the rolling summary to the memory extractor. Use the current notebook to identify durable facts that are already known.
- Use a language-neutral, rate-limited memory trigger. Do not discard a message only because it is short. Run no more than one automatic memory check for every three user messages or once per minute, whichever is less frequent.
- Treat any language the selected provider can process as eligible for memory learning. Test English, Spanish, and Chinese fixtures.
- Add an optional, ephemeral "Memory updated" indicator. Keep it off by default. It must never expose prompt text or a provider response, become a chat message, appear in exports, or return to a provider as conversation context.
- Show the outcome of the latest memory check in the Memory window, including a clear failure state that does not clutter the chat.
- Build a memory quality test set before release. Cover durable facts, changed facts, near-duplicates, fragments, prompt-injection attempts, and messages in several languages.
- Pinned memories count toward the memory context budget and are never evicted automatically. If pinned memories fill the budget, pause automatic learning and explain the limit in the Memory window.
- When stored memory exceeds the selected context budget, keep all entries locally and send pinned entries first, then the newest unpinned entries that fit. Do not delete existing memories during migration.

### Do not build

- Do not add chat rooms yet.
- Do not add provider tool calling yet.
- Do not add voice, speech input, audio storage, or visible streaming text.
- Do not publish a new portable character-format version yet.

### Ready when

- A new and an existing buddy both work without editing their profile.
- Memory learning does not store fragments, model-generated translations, prompt or instruction text, near-duplicate facts, or superseded unpinned facts.
- A user can turn memory off, edit it, pin an entry, and wipe it without affecting chat history.
- A user can have a long conversation without AIIM sending the complete history back to the provider on every reply.
- Memory learning works for languages that the selected provider supports, and a failed memory check has a visible status in the Memory window.
- The memory quality test set passes before release.
- Version 1 character imports still work, and exports contain no provider or private conversation data.

## Phase B: Buddy Chats

### Goal

Add a small, AIM-style group conversation without changing AIIM into a room-based or Discord-like app.

### Build

- Add an **Invite buddies to chat** action from the buddy list and an IM window.
- Support two to four AI buddies plus the user in one Buddy Chat window.
- Store participants as a list. Enforce the two-to-four limit in the product UI, not in the saved data shape.
- Use classic multi-user IM patterns in the Buddy Chat window: a simple participant list, chat transcript, staggered typing indicators, and join or leave notices. Do not add modern mention highlighting, reaction controls, or a large room sidebar.
- Reuse each buddy's existing availability, status message, away message, and presence pattern in the participant list. Do not build a separate presence system for Buddy Chats.
- Keep Buddy Chats separate from one-to-one histories. Closing a group chat must not alter any private conversation.
- Add `chatTopics` and `participationStyle` to a new portable character-format version. Import version 1 files with empty `chatTopics` and a `normal` participation style.
- Use a simple response policy.
  - A buddy named by the user answers first.
  - Otherwise, use each buddy's `chatTopics` and `participationStyle` to choose a natural responder.
  - Limit the usual turn to one reply. Allow another reply when it adds something distinct or when a buddy explicitly hands the conversation to them with their exact `@screenName`.
  - A quiet buddy does not need to answer every message.
  - Review each delivered buddy reply for an exact `@screenName`. A matching handle creates a targeted handoff turn that tells the next buddy who addressed them and which attributed transcript message to answer.
  - Choose responders with a local score from direct mentions, chat topics, participation style, and recent participation. Do not make another provider request only to route a turn.
- Send no more than three reply requests for one user group turn, including handoffs. The counter resets when the user sends a new message. Each speaker request must fit within a fixed input budget that includes instructions, private memory, the group summary, and recent group messages.
- Build one shared group preamble and then apply each speaker's own personality and profile. Do not repeat the period setting in every response prompt.
- Use the bounded-context system from 1.1 for every group request. Preserve speaker attribution in the group summary.
- Give each speaking buddy only that buddy's private memories. Do not put another buddy's memories in the speaker's context.
- Let buddies read their own memories in a Buddy Chat. Do not automatically write group-chat memories in this phase.
- Use familiar IM signals: typing indicators, staggered replies, join and leave notices, and optional buddy sounds.
- If a selected buddy fails during a group turn, save the completed replies, show a short failure notice for that buddy, and offer a retry for that buddy only.

### Do not build

- Do not add public or global chat rooms.
- Do not expose "who answers" controls, model routing controls, or agent terminology to normal users.
- Do not write the same group fact into every participant's memory.

### Ready when

- An existing buddy with no new social fields behaves normally in a Buddy Chat.
- Mentioning a buddy produces a predictable reply from that buddy.
- The reply limit prevents a group chat from becoming a wall of text.
- One-to-one chats, memories, exports, and backups retain their existing behavior.
- A saved group chat restores its members, transcript, and settings after restart.
- An attempt to invite a fifth buddy gives a clear message and leaves the existing Buddy Chat unchanged.
- A group-context test set verifies speaker attribution, private-memory isolation, the three-request limit, the maximum request size, and a partial turn with one failed buddy.

## Phase C: MCP MVP

### Goal

Let a deliberately configured buddy use approved MCP tools from a connected Model Context Protocol (MCP) server in a direct chat, with at most one approved tool invocation per user turn. It should still feel like an instant-message reply, not an agent console.

This is an intentionally small first release. It establishes durable connection, reviewed-tool, buddy-grant, and invocation records so later support for OAuth, more provider formats, more tool rounds, and Buddy Chat can extend the system without changing saved permissions.

A buddy with no usable MCP tools behaves exactly as it did before this phase. AIIM does not build service-specific weather, GitHub, email, SSH, Agent Core, or similar integrations; external MCP servers supply capabilities.

### Architecture contract

- AIIM is the MCP host. Each configured server has an isolated client and lifecycle.
- Keep four concepts separate:
  - An **MCP connection** identifies one configured server and transport.
  - An **MCP tool** is a tool currently advertised by that connection.
  - A **buddy tool grant** permits one buddy's model to see one reviewed tool. It does not authorize an invocation.
  - A **tool invocation** ties one model request to one buddy, conversation, connection, exact tool, validated arguments, and user decision.
- Identify a grant by AIIM's stable local connection ID and the tool's case-sensitive name. Never use a display name or server-reported identity as a security key.
- Store a fingerprint of a canonical reviewed tool definition: case-sensitive name, title and description where supplied, `inputSchema`, optional `outputSchema`, and annotations, serialized with stable key ordering. A change suspends the grant until the user reviews it again; harmless JSON property ordering must not create a false change.
- Refactor reply generation behind an AIIM-owned buddy-turn coordinator. The provider-facing result is a typed union: final text or structured tool request. Provider adapters own their wire formats; the coordinator owns permissions, confirmation, cancellation, and final message behavior.
- Keep tool invocations outside the transcript, memory, and conversation summary. The only canonical chat message is the buddy's final natural-language reply.

### MVP: connect a service

- Add **Connected Services** to Preferences. Use MCP terminology only in setup and diagnostic details.
- Let the user add, test, enable, disable, reconnect, edit, and remove a connection.
- Support exactly two standard transports:
  - **Web service** uses Streamable HTTP. Require HTTPS except for loopback HTTP. Do not follow an insecure redirect or forward a credential across an origin change.
  - **Local program** uses `stdio`. Store the executable and every argument separately; never execute a raw shell command string. Launch directly where possible and use an argument-safe Windows launcher only for supported `.cmd` shims such as `npx.cmd`.
- Use the current v2 `@modelcontextprotocol/client` SDK line behind an AIIM-owned adapter, pinned to an exact tested version with automated compatibility tests. Use the SDK's supported Streamable HTTP protocol negotiation; do not implement legacy HTTP+SSE or a custom transport.
- Web services initially support no authentication or one manually entered bearer token. Store the token securely and bind it to the connection ID, transport, and normalized endpoint. Browser OAuth, PKCE, discovery, registration, and refresh are explicitly deferred.
- Local programs receive the SDK's safe inherited-environment allowlist plus explicitly configured non-secret values, never AIIM's full parent environment. Secure named environment values are a follow-up after the MVP. Capture bounded `stderr` for diagnostics but never treat it as protocol data.
- Stop local child processes when their connection is disabled or removed, on app quit, and when an in-flight request is cancelled. A failed service must not block startup or unaffected chats.
- Reconnect enabled services asynchronously after the interface is ready. Editing a transport, endpoint, or executable creates a new trust target: disable its grants, clear incompatible credentials, and require a fresh test.

### MVP: discover and grant tools

- Discover tools when a connection is tested, enabled, or reconnected. Treat tool data as untrusted runtime availability, not as permanent AIIM features.
- Persist the last reviewed definition and fingerprint with each grant. A temporarily missing tool stays suspended; it becomes available again only when the same connection, case-sensitive name, and fingerprint return.
- A changed definition shows the user what changed and requires review before the buddy can see it again. Immediately before execution, refresh and revalidate the selected tool definition, recompute its canonical fingerprint, and cancel the invocation if it differs from the reviewed fingerprint.
- Add a **Capabilities** section to buddy settings. Group reviewed tools by connected service and show a readable description and availability.
- Default every tool to **Not granted**. The user can grant or revoke each tool for each buddy; importing a character or connecting a service grants nothing.
- A buddy's usable tools are the intersection of reviewed grants, enabled connection, current discovery result, and provider adapter support.
- Map each MCP tool to a request-local, provider-safe name. Resolve returned provider names only through that map, preventing collisions or naming limits from selecting a different tool.
- Back up non-secret connection configuration. Restore every connection disabled and clear its grants and tokens so they must be reviewed again. Character imports and exports contain no MCP configuration, endpoints, tools, grants, or credentials.

### MVP: one safe tool turn

- Support MCP tool use in **direct chats only**. Buddy Chat tool use is deferred, but the coordinator receives conversation context so it can be added later without changing connection or grant data.
- Add the standard OpenAI-style tool-call adapter for `ProviderKind: openai`, `minimax`, `openrouter`, and `openai-compatible`, plus the native Ollama tool-call adapter. MiniMax preserves the complete first assistant tool-call response for the follow-up result turn. Native Anthropic, Gemini, and subscription adapters remain follow-up work; Ollama models that explicitly do not support tools continue ordinary chat.
- For each user message, allow at most one requested tool call and two provider rounds: the model requests one tool, AIIM returns its result, and the model returns final text. If the first provider response contains two or more tool calls, execute none of them—whether or not it also includes text—and end the tool round with a clear failure. No parallel calls, chaining, spontaneous check-in tools, or background agent loops in the MVP.
- During a tool-enabled first provider round, buffer assistant text rather than streaming or committing it to the conversation. If that round requests a tool, discard the provisional text and show only AIIM's working status. If it requests no tool, deliver the buffered text as the normal final reply. After an approved or denied tool request, only the second provider round may create the canonical buddy message.
- Each requested call for a buddy and reviewed tool shows a compact confirmation unless that exact buddy-tool pair was explicitly trusted: buddy, connected service, action, and readable arguments, with **Allow once**, **Always allow**, and **Deny**. Always allow trusts only that buddy and exact tool fingerprint; removing the permission or any changed definition returns it to review. No annotation can bypass confirmation.
- Immediately before running a call, recheck the conversation and buddy, connection availability, exact fingerprint, grant, request-local identity, argument schema and size limits, and either a current approval or trusted status for that precise buddy-tool pairing.
- Bound input depth and size, tool-call timeout, result text/JSON size, and total turn size. Results are untrusted data sent only through the provider's tool-result channel; do not follow resource links or accept arbitrary binary, file, image, audio, or embedded content.
- **Stop**, chat-window closure, service removal, timeout, and app shutdown cancel provider and MCP work together. An unanswered confirmation times out cleanly.
- Show a brief working status such as **"Mara is looking that up..."**. Once final text is ready, apply the usual human pacing. Never show server names, raw tool names, JSON, protocol frames, or agent-loop steps in the chat window.
- If the call fails or is denied, let the provider produce a short natural reply when possible; otherwise show a targeted AIIM failure state outside the transcript.

### MVP: persistence, diagnostics, and tests

- Store connections, reviewed tool metadata, grants, and a bounded activity log in local AIIM data. Keep secrets in the existing secure credential store. The activity log contains time, buddy, service, tool, approval decision, and success or failure—not credentials, raw arguments, or complete results.
- Removing a connection removes its credentials and grants. Disabling preserves them. Add enough Preferences diagnostics to distinguish connection, discovery, provider-compatibility, and execution failures.
- Build test fixtures for one local `stdio` service and one Streamable HTTP service, including a harmless lookup tool, malformed arguments, changed definitions, timeout/cancellation, and same-named tools from different connections.
- Test that: no configured MCP service changes nothing; grants are never automatic; ungranted, changed, missing, malformed, over-limit, or denied calls cannot run; restore never starts a process or contacts a service; cancellation leaves no child process; secrets and raw results never enter normal saved data; and unsupported providers still chat normally.
- Manually test one supported `ProviderKind: openai` or `ProviderKind: minimax` model with each transport before release. Also test Agent Core once as an ordinary Streamable HTTP service if it is available; fix any failure in the generic MCP implementation, never with Agent Core-specific code, settings, permissions, or behavior.

### Explicitly deferred extensions

- Browser OAuth with PKCE, dynamic registration, discovery, and token refresh.
- Tool-call adapters for Anthropic, Google, ChatGPT subscription, and other provider formats.
- Multiple ordered calls, parallel calls, longer tool loops, and background or spontaneous tool work.
- Buddy Chat tool calls. When added, a call remains attached to the existing speaker turn and never creates another speaker turn.
- MCP Tasks, resources, prompts, sampling, roots, elicitation, Apps, and other protocol extensions.
- Secure local-program environment values and a richer service-configuration experience.
- Additional server-specific compatibility testing beyond the one generic Agent Core interoperability check. If a server works through the supported transports and tool protocol, it should require no special AIIM behavior or permissions.

### Do not build

- Do not bundle, download, install, catalog, or automatically discover MCP servers.
- Do not grant an entire server, newly discovered tools, or imported characters any permission automatically.
- Do not let a model, prompt, tool result, or server create or change a grant.
- Do not turn ordinary chat windows into a model-routing, protocol, or agent-console interface.
- Do not merge MCP results or service data into buddy memory.
- Do not require MCP for ordinary conversations.

### Ready when

- AIIM works identically with no MCP connections configured.
- A user can test, enable, disable, reconnect, edit, and remove both a Streamable HTTP service and a local `stdio` service.
- Adding a service grants no tool to any buddy; grants are individual, reviewed, immediately revocable, and tied to the exact tool definition.
- A supported buddy can complete one approved provider-tool-result turn and send one ordinary final IM message.
- The first invocation of each buddy-tool pair shows the exact buddy, service, action, and arguments before the user allows or denies it; exact unchanged tools can then be trusted until revoked.
- No ungranted, changed, unavailable, malformed, over-limit, denied, stale, or cancelled request can execute.
- A provider or model without tool-call support keeps ordinary chat working.
- Losing or restoring a service cannot block startup, launch a service unexpectedly, leave a stuck request, or leave an orphan local process.
- Character files contain no MCP state; transcripts, memories, summaries, and backups contain no secrets or raw tool results.
- The two transport fixtures and the direct-chat flow pass automated tests, including collision, failure, and cancellation cases.
- When available, Agent Core passes one manual interoperability test through the normal Streamable HTTP connection, discovery, grant, confirmation, execution, and result path.
- Existing one-to-one chats, Buddy Chats, memories, backups, presence, pacing, and portable characters retain their previous behavior.

## Future consideration: voice

Voice is not part of Phase A, Phase B, or Phase C. If AIIM adds it later, voice must remain a small layer on top of text messaging.

- The text reply appears, types, saves, and exports exactly as it does today.
- A user may choose to play a voice version of a reply after it arrives.
- Voice configuration is optional per buddy and disabled by default.
- Do not download or use a voice sample from an imported character pack without the user's explicit choice.
- Use a versioned optional voice descriptor when the feature is designed. Do not reserve unvalidated fields now.

## Final review before AIIM 1.1.0

- Test upgrade from the prior released version with chats, memories, providers, portraits, and imported character files.
- Test a clean installation and an empty buddy list.
- Test a character file from every supported format version.
- Test with a hosted provider and a local Ollama model where the phase changes message handling.
- Check that the late-1990s UI language still makes sense without reading documentation.
- Update the format guide, Help, README, changelog, and release checklist before packaging.
