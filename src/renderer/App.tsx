import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot, Buddy, BuddyFont, BuddyId, BuddyInput, BuddyMemoryInput, BuddySound, ChatMessage, CheckInFrequency, Conversation, ConversationId, McpConnection, McpConnectionInput, MemoryMode, ModelOption, PresencePattern, ProfileStatus, ProviderConfig, ProviderId, ProviderInput, ProviderKind, ReasoningEffort, StreamEvent, UserProfileInput } from "../shared/types";
import { characterTemplates, type CharacterTemplate } from "../templates/character-templates";
import { buddyPresence, type PresenceState } from "../shared/presence";
import { resolveModelSelection, resolveProviderSelection } from "../shared/model-selection";
import { appDisplayVersion } from "../shared/version";

const blank: AppSnapshot = { providers: [], buddies: [], conversations: [], mcpConnections: [], buddyToolGrants: [], capabilityActivity: [], profile: { screenName: "me", displayName: "Me", pronouns: "", location: "", interests: "", aboutMe: "", status: "available", showMemoryUpdates: false } };
const characterPacks = groupCharacterTemplates(characterTemplates);

function groupCharacterTemplates(templates: CharacterTemplate[]): Array<{ name: string; characters: CharacterTemplate[] }> {
  const packs = new Map<string, CharacterTemplate[]>();
  for (const template of templates) packs.set(template.pack, [...(packs.get(template.pack) ?? []), template]);
  return [...packs].map(([name, characters]) => ({ name, characters }));
}

export function App() {
  const [snapshot, setSnapshot] = useState(blank);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.aiMessenger.snapshot().then((next) => { setSnapshot(next); setSnapshotReady(true); }).catch((reason: unknown) => { setError(messageOf(reason)); setSnapshotReady(true); });
    return window.aiMessenger.onSnapshot((next) => { setSnapshot(next); setSnapshotReady(true); });
  }, []);
  const route = window.location.hash.slice(1) || "/buddies";
  if (!snapshotReady) return <LoadingWindow />;
  if (route === "/settings") return <Settings snapshot={snapshot} error={error} reportError={setError} />;
  if (route === "/help") return <Help error={error} reportError={setError} />;
  if (route.startsWith("/chat/")) return <Chat snapshot={snapshot} id={route.slice(6) as ConversationId} />;
  return <BuddyList snapshot={snapshot} error={error} />;
}

function LoadingWindow() {
  return <div className="aim-shell loading-shell"><header className="brand-panel"><RobotMark /><div><div className="brand-name">AIIM</div><div className="brand-sub">AI INSTANT MESSENGER</div></div></header><main><span className="loading-spinner" aria-hidden="true" /> Loading your buddy list...</main></div>;
}

function BuddyList({ snapshot, error }: { snapshot: AppSnapshot; error: string }) {
  const [tab, setTab] = useState<"buddies" | "recent">("buddies");
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [presenceNotice, setPresenceNotice] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [profileStatus, setProfileStatus] = useState(snapshot.profile.status);
  const [statusError, setStatusError] = useState("");
  const [showBuddyChat, setShowBuddyChat] = useState(false);
  const previousPresence = useRef(new Map<string, PresenceState>());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => setProfileStatus(snapshot.profile.status), [snapshot.profile.status]);
  useEffect(() => {
    for (const buddy of snapshot.buddies) {
      const next = buddyPresence(buddy, now).state;
      const previous = previousPresence.current.get(buddy.id);
      if (previous && previous !== next && (next === "available" || next === "offline")) {
        playPresenceSound(next);
        setPresenceNotice(`${buddy.screenName} has ${next === "available" ? "signed on" : "signed off"}.`);
        window.setTimeout(() => setPresenceNotice(""), 4500);
      }
      previousPresence.current.set(buddy.id, next);
    }
  }, [now, snapshot.buddies]);
  const groups = useMemo(() => {
    const visible = snapshot.buddies.filter((buddy) => `${buddy.displayName} ${buddy.screenName}`.toLowerCase().includes(filter.toLowerCase()));
    const result = new Map<string, Buddy[]>();
    for (const buddy of visible) result.set(buddy.group, [...(result.get(buddy.group) ?? []), buddy]);
    return result;
  }, [snapshot.buddies, filter]);

  return <div className="aim-shell buddy-shell">
    <TopMenu onPreferences={() => void window.aiMessenger.openSettings()} />
    <header className="brand-panel">
      <RobotMark />
      <div><div className="brand-name">AIIM</div><div className="brand-sub">AI INSTANT MESSENGER</div><div className="brand-tag">THE FUTURE. CIRCA 1999.</div></div>
    </header>
    <div className="identity-row"><span className={`presence-dot ${profileStatus}`} /> <strong>{snapshot.profile.screenName}</strong><select className="status-button" aria-label="Your status" value={profileStatus} onChange={(event) => { const next = profileStatusFrom(event.target.value); setProfileStatus(next); setStatusError(""); void window.aiMessenger.setProfileStatus(next).catch((reason: unknown) => { setProfileStatus(snapshot.profile.status); setStatusError(messageOf(reason)); }); }}><option value="available">Available</option><option value="away">Away</option></select></div>
    <div className="blue-title"><span>Buddy List</span><small>{snapshot.buddies.length} AI buddies</small></div>
    <div className="tabs"><button className={tab === "buddies" ? "active" : ""} onClick={() => setTab("buddies")}>Buddies</button><button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>Recent</button></div>
    <main className="list-well">
      <input className="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find a buddy..." />
      {error && <div className="notice error">{error}</div>}
      {statusError && <div className="notice error">{statusError}</div>}
      {tab === "buddies" ? <>
        {snapshot.buddies.length === 0 && <EmptyList />}
        {[...groups].map(([name, buddies]) => <section className="buddy-group" key={name}>
          <h2><button aria-expanded={!collapsedGroups.has(name)} onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next; })}>{collapsedGroups.has(name) ? "▶" : "▼"} {name} <span>({buddies.length})</span></button></h2>
          {!collapsedGroups.has(name) && buddies.map((buddy) => <BuddyRow key={buddy.id} buddy={buddy} now={now} onOpen={() => void window.aiMessenger.openChat(buddy.id)} />)}
        </section>)}
      </> : <RecentList snapshot={snapshot} onError={setStatusError} />}
    </main>
    <nav className="bottom-actions">
      <button onClick={() => void window.aiMessenger.openSettings()}><span>✉</span>Add AI</button>
      <button onClick={() => setTab("recent")}><span>☆</span>History</button>
      <button onClick={() => void window.aiMessenger.snapshot().then(() => location.reload()).catch((reason: unknown) => setStatusError(messageOf(reason)))}><span>↻</span>Refresh</button>
      <button onClick={() => void window.aiMessenger.openSettings()}><span>⚙</span>Prefs</button>
    </nav>
    <button className="buddy-chat-action" disabled={snapshot.buddies.length < 2} onClick={() => setShowBuddyChat(true)}>Start a Buddy Chat</button>
    {presenceNotice && <div className="status-notice">{presenceNotice}</div>}<footer>{snapshot.profile.screenName} · {snapshot.profile.status} · Enter to IM</footer>
    {showBuddyChat && <BuddyChatStarter buddies={snapshot.buddies} onClose={() => setShowBuddyChat(false)} onError={setStatusError} />}
  </div>;
}

function BuddyChatStarter({ buddies, onClose, onError, initialSelected = [] }: { buddies: Buddy[]; onClose: () => void; onError: (message: string) => void; initialSelected?: BuddyId[] }) {
  useCloseOnEscape(onClose);
  const [selected, setSelected] = useState<Set<BuddyId>>(() => new Set(initialSelected));
  const toggle = (id: BuddyId) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 4) next.add(id); return next; });
  const start = async () => {
    if (selected.size < 2) { onError("Choose at least two buddies for a Buddy Chat."); return; }
    try { const conversation = await window.aiMessenger.newBuddyChat([...selected]); onClose(); await window.aiMessenger.openConversation(conversation.id); }
    catch (reason) { onError(messageOf(reason)); }
  };
  const inviting = initialSelected.length > 0;
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="buddy-profile buddy-chat-starter" role="dialog" aria-modal="true" aria-label="Start a Buddy Chat" onMouseDown={(event) => event.stopPropagation()}><div className="profile-title"><div><h2>{inviting ? "Invite buddies" : "Start a Buddy Chat"}</h2><small>{inviting ? "Add one to three people to this new group chat" : "Choose two to four buddies"}</small></div><button aria-label="Close" onClick={onClose}>×</button></div><p className="profile-status">A Buddy Chat is its own saved conversation. Private chats and memories stay private.</p><div className="invite-list">{buddies.map((buddy) => <label key={buddy.id}><input type="checkbox" checked={selected.has(buddy.id)} onChange={() => toggle(buddy.id)} disabled={initialSelected.includes(buddy.id) || (!selected.has(buddy.id) && selected.size >= 4)} /> <Avatar buddy={buddy} className="buddy-icon" /> <span><strong>{buddy.displayName}</strong><small>{initialSelected.includes(buddy.id) ? "Already in this new chat" : buddy.screenName}</small></span></label>)}</div><div className="memory-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={selected.size < 2} onClick={() => void start()}>{inviting ? "Start group chat" : "Start chat"}</button></div></section></div>;
}

function BuddyChatInviter({ conversation, buddies, onClose, onError }: { conversation: Extract<Conversation, { kind: "buddy-chat" }>; buddies: Buddy[]; onClose: () => void; onError: (message: string) => void }) {
  useCloseOnEscape(onClose);
  const available = buddies.filter((buddy) => !conversation.participantIds.includes(buddy.id));
  const [selected, setSelected] = useState<BuddyId>();
  const invite = async () => {
    if (!selected) return;
    try { await window.aiMessenger.addBuddyToChat(conversation.id, selected); onClose(); }
    catch (reason) { onError(messageOf(reason)); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="buddy-profile buddy-chat-starter" role="dialog" aria-modal="true" aria-label="Invite a buddy" onMouseDown={(event) => event.stopPropagation()}><div className="profile-title"><div><h2>Invite a buddy</h2><small>{conversation.participantIds.length} of 4 buddies are already here</small></div><button aria-label="Close" onClick={onClose}>×</button></div><p className="profile-status">The invited buddy joins this saved Buddy Chat. Their private chat and memories remain separate.</p><div className="invite-list">{available.length === 0 && <p className="empty-memory">There are no other buddies to invite.</p>}{available.map((buddy) => <label key={buddy.id}><input type="radio" name="invitedBuddy" checked={selected === buddy.id} onChange={() => setSelected(buddy.id)} /> <Avatar buddy={buddy} className="buddy-icon" /> <span><strong>{buddy.displayName}</strong><small>@{buddy.screenName}</small></span></label>)}</div><div className="memory-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!selected} onClick={() => void invite()}>Invite</button></div></section></div>;
}

function EmptyList() {
  return <div className="empty-list"><RobotMark /><h2>Your buddy list is empty</h2><p>Add a provider, then turn one of its models into an AI buddy.</p><button className="primary" onClick={() => void window.aiMessenger.openSettings()}>Set up your first AI</button></div>;
}

function BuddyRow({ buddy, now, onOpen }: { buddy: Buddy; now: Date; onOpen: () => void }) {
  const presence = buddyPresence(buddy, now);
  return <button className="buddy-row" onClick={onOpen}>
    <Avatar buddy={buddy} className="buddy-icon" />
    <span><strong>{buddy.displayName}</strong><small>{buddy.screenName} · {presence.label}</small></span>
    <i className={`presence-dot ${presence.state}`} title={presence.label} />
  </button>;
}

function RecentList({ snapshot, onError }: { snapshot: AppSnapshot; onError: (message: string) => void }) {
  if (snapshot.conversations.length === 0) return <div className="empty-small">No saved chats yet.</div>;
  return <section className="recent-list"><div className="history-actions"><button onClick={() => void window.aiMessenger.exportConversation().catch((reason: unknown) => onError(messageOf(reason)))}>Export all</button><button onClick={() => { if (window.confirm("Clear all saved chat history? This cannot be undone.")) void window.aiMessenger.clearAllHistory().catch((reason: unknown) => onError(messageOf(reason))); }}>Clear all</button></div>{snapshot.conversations.map((conversation) => {
    const label = conversation.kind === "direct" ? snapshot.buddies.find((item) => item.id === conversation.buddyId)?.displayName : `${conversation.participantIds.length} buddies`;
    if (!label) return null;
    return <button key={conversation.id} onClick={() => void window.aiMessenger.openConversation(conversation.id)}>
      <strong>{conversation.title}</strong><small>{label} · {friendlyDate(conversation.updatedAt)}</small>
    </button>;
  })}</section>;
}

function Chat({ snapshot, id }: { snapshot: AppSnapshot; id: ConversationId }) {
  const conversation = snapshot.conversations.find((item) => item.id === id);
  const buddy = conversation?.kind === "direct" ? snapshot.buddies.find((item) => item.id === conversation.buddyId) : undefined;
  const provider = buddy ? snapshot.providers.find((item) => item.id === buddy.providerId) : undefined;
  const [draft, setDraft] = useState("");
  const [stream, setStream] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState("");
  const [error, setError] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState("");
  const [capabilityRequest, setCapabilityRequest] = useState<NonNullable<StreamEvent["capabilityRequest"]>>();
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.aiMessenger.onStream((event) => {
    if (conversation?.kind === "buddy-chat") return;
    if (event.conversationId !== id) return;
    if (event.kind === "waiting") { setSending(true); setWaiting(event.text ?? `${buddy?.displayName ?? "Your buddy"} is away.`); setStream(""); setError(""); }
    if (event.kind === "start") { setSending(true); setWaiting(""); setStream(""); setError(""); }
    if (event.kind === "delta") setStream((current) => current + (event.text ?? ""));
    if (event.kind === "done") { setSending(false); setWaiting(""); setStream(""); playReplySound(buddy?.notificationSound ?? "classic"); }
    if (event.kind === "error") { setSending(false); setWaiting(""); setStream(""); setError(event.text ?? "Reply failed."); }
    if (event.kind === "memory-updated") { setMemoryNotice(event.text ?? "Memory updated."); window.setTimeout(() => setMemoryNotice(""), 4_500); }
    if (event.kind === "capability-request" && event.capabilityRequest) { setSending(true); setWaiting(""); setStream(""); setCapabilityRequest(event.capabilityRequest); }
  }), [conversation?.kind, id, buddy?.notificationSound]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [conversation?.messages.length, stream]);
  useEffect(() => { if (conversation?.messages.at(-1)?.state === "error") setError(""); }, [conversation?.messages]);
  if (!conversation) return <div className="missing">This conversation no longer exists.</div>;
  if (conversation.kind === "buddy-chat") return <BuddyChat snapshot={snapshot} conversation={conversation} />;
  if (!buddy) return <div className="missing">This conversation no longer exists.</div>;

  const send = async () => {
    if (!draft.trim() || sending) return;
    const message = draft;
    setDraft("");
    try { await window.aiMessenger.sendMessage(id, message); } catch (reason) { setSending(false); setError(messageOf(reason)); }
  };
  const clearChat = async () => {
    if (!window.confirm(`Clear your chat history with ${buddy.displayName}?`)) return;
    setSending(false); setWaiting(""); setStream(""); setError("");
    try { await window.aiMessenger.clearConversation(id); }
    catch (reason) { setError(messageOf(reason)); }
    finally { window.requestAnimationFrame(() => composer.current?.focus()); }
  };
  const retry = async () => {
    setError("");
    try { await window.aiMessenger.retryMessage(id); }
    catch (reason) { setSending(false); setError(messageOf(reason)); }
  };
  const presence = buddyPresence(buddy, new Date());

  return <div className="aim-shell chat-shell">
    <TopMenu onPreferences={() => void window.aiMessenger.openSettings()} />
    <div className="to-row"><span>To:</span><strong>{buddy.displayName}</strong><small>{buddy.screenName}</small><button onClick={() => setShowProfile(true)}>Buddy info</button><button onClick={() => setShowMemory(true)}>Memory ({buddy.memories.length})</button><button onClick={() => setShowInvite(true)}>Invite buddies</button><button onClick={() => void window.aiMessenger.exportConversation(id).catch((reason: unknown) => setError(messageOf(reason)))}>Save transcript</button><button onClick={() => void clearChat()}>Clear history</button></div>
    <div className="chat-body">
      <div className="transcript" ref={transcript}>
        {conversation.messages.length === 0 && <div className="chat-welcome"><h2>Instant message {buddy.displayName}</h2><p>{buddy.displayName} uses {provider?.name ?? "an AI provider"} · {buddy.modelId}</p></div>}
        {conversation.messages.map((message) => <MessageLine key={message.id} message={message} buddy={buddy} me={snapshot.profile.screenName} />)}
        {stream && <MessageLine message={{ id: "stream" as ChatMessage["id"], role: "assistant", content: stream, createdAt: new Date().toISOString(), state: "streaming" }} buddy={buddy} me={snapshot.profile.screenName} />}
        {waiting && <div className="delivery-status">{waiting}</div>}
        {sending && !waiting && !stream && <div className={`typing ${buddy.typingStyle}`}><i /><i /><i /> {buddy.displayName} is typing...</div>}
        {error && <div className="notice error">{error}</div>}
      </div>
      <aside className="buddy-card"><Avatar buddy={buddy} className="large-avatar" /><strong>{buddy.displayName}</strong><small>{buddy.statusMessage}</small><span className="online-label"><i className={`presence-dot ${presence.state}`} /> {presence.label}</span></aside>
    </div>
    <div className="compose-tools"><span className="format-badge"><b>Aa</b></span><span style={{ fontFamily: buddy.fontFamily, color: buddy.fontColor }}>{buddy.fontFamily}</span><button title="Insert smiley" onClick={() => setDraft((current) => `${current} :)`)}>☺</button>{conversation.messages.at(-1)?.state === "error" && !sending && <button onClick={() => void retry()}>Retry reply</button>}{sending && <button onClick={() => void window.aiMessenger.stopMessage(id)}>Stop</button>}<small>{memoryNotice || (sending ? `${buddy.displayName} is replying...` : "Ready")}</small></div>
    <textarea className="composer" ref={composer} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Type an instant message..." />
    <div className="send-row"><span>Enter to send · Shift + Enter for a new line</span><button className="primary" disabled={!draft.trim() || sending} onClick={() => void send()}>Send</button></div>
    {showProfile && <BuddyProfile buddy={buddy} onClose={() => setShowProfile(false)} />}
    {showMemory && <MemoryNotebook buddy={buddy} onClose={() => setShowMemory(false)} onError={setError} />}
    {showInvite && <BuddyChatStarter buddies={snapshot.buddies} initialSelected={[buddy.id]} onClose={() => setShowInvite(false)} onError={setError} />}
    {capabilityRequest && <CapabilityApproval request={capabilityRequest} onChoose={(decision) => { setCapabilityRequest(undefined); void window.aiMessenger.respondToCapabilityRequest(capabilityRequest.id, decision); }} />}
  </div>;
}

function CapabilityApproval({ request, onChoose }: { request: NonNullable<StreamEvent["capabilityRequest"]>; onChoose: (decision: "deny" | "once" | "always") => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="buddy-profile capability-approval" role="dialog" aria-modal="true" aria-label="Capability request"><div className="profile-title"><RobotMark /><div><h2>{request.buddyName} is asking first</h2><small>Connected service request</small></div></div><p className="profile-status">{request.buddyName} wants to use <strong>{request.serviceName}</strong> for {request.actionName}.</p><pre>{request.argumentsText}</pre><p className="muted">You can allow this one request, or trust this exact reviewed tool for this buddy until you revoke it. A changed tool definition always needs review again.</p><div className="form-actions"><button onClick={() => onChoose("deny")}>Deny</button><button onClick={() => onChoose("once")}>Allow once</button><button className="primary" onClick={() => onChoose("always")}>Always allow</button></div></section></div>;
}

function MessageLine({ message, buddy, me }: { message: ChatMessage; buddy: Buddy; me: string }) {
  const name = message.role === "assistant" ? buddy.displayName : me;
  const style = message.role === "assistant" ? { fontFamily: buddy.fontFamily, color: buddy.fontColor } : undefined;
  return <div className={`message-line ${message.role} ${message.state}`}><div><strong style={style}>{name}</strong> <time>({friendlyTime(message.createdAt)})</time></div><p style={style}>{message.content}</p></div>;
}

function BuddyProfile({ buddy, onClose }: { buddy: Buddy; onClose: () => void }) {
  useCloseOnEscape(onClose);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="buddy-profile" role="dialog" aria-modal="true" aria-label={`${buddy.displayName} buddy profile`} onMouseDown={(event) => event.stopPropagation()}><div className="profile-title"><Avatar buddy={buddy} className="profile-avatar" /><div><h2>{buddy.displayName}</h2><small>{buddy.screenName}</small></div><button aria-label="Close buddy profile" onClick={onClose}>×</button></div><p className="profile-status">{buddy.statusMessage}</p><dl><dt>About me</dt><dd>{buddy.profileBio || "No profile written yet."}</dd><dt>Location</dt><dd>{buddy.profileLocation || "Not specified"}</dd><dt>Interests</dt><dd>{buddy.profileInterests || "Not specified"}</dd><dt>Favorite quote</dt><dd>{buddy.profileQuote || "Not specified"}</dd></dl></section></div>;
}

function MemoryNotebook({ buddy, onClose, onError }: { buddy: Buddy; onClose: () => void; onError: (message: string) => void }) {
  useCloseOnEscape(onClose);
  const [memoryMode, setMemoryMode] = useState<MemoryMode>(buddy.memoryMode);
  const [memories, setMemories] = useState<BuddyMemoryInput[]>(buddy.memories.map(({ id, text, pinned }) => ({ id, text, pinned })));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await window.aiMessenger.saveBuddyMemories(buddy.id, memoryMode, memories); onClose(); }
    catch (reason) { onError(messageOf(reason)); }
    finally { setSaving(false); }
  };
  const changeMemory = (index: number, update: Partial<BuddyMemoryInput>) => setMemories((current) => current.map((memory, itemIndex) => itemIndex === index ? { ...memory, ...update } : memory));
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="buddy-profile memory-notebook" role="dialog" aria-modal="true" aria-label={`${buddy.displayName} memory`} onMouseDown={(event) => event.stopPropagation()}><div className="profile-title"><Avatar buddy={buddy} className="profile-avatar" /><div><h2>{buddy.displayName}'s memory</h2><small>Private, editable continuity notes</small></div><button aria-label="Close memory" onClick={onClose}>×</button></div><p className="profile-status">This is the one memory notebook. Automatic memories appear here; you can add, edit, remove, or pin any fact.</p><div className="memory-mode"><label>Memory context <select value={memoryMode} onChange={(event) => setMemoryMode(event.target.value as MemoryMode)}><option value="off">Off — do not learn or send memories</option><option value="normal">Normal — compact memory</option><option value="detailed">Detailed — more memory</option></select></label><small>{memoryMode === "off" ? "This buddy will neither learn new facts nor receive any saved facts with a reply." : memoryMode === "detailed" ? "The buddy receives up to roughly twice as much useful background as Normal." : "The buddy receives a compact selection of the most useful saved facts."}</small></div><div className="memory-list">{memories.length === 0 && <p className="empty-memory">No memories yet. Add one, or let the friendship develop naturally.</p>}{memories.map((memory, index) => <div className="memory-row" key={memory.id ?? `new-${index}`}><textarea value={memory.text} onChange={(event) => changeMemory(index, { text: event.target.value })} placeholder="A complete fact this buddy should remember." /><label title="Pinned facts are always included first and are protected from automatic replacement."><input type="checkbox" checked={memory.pinned} onChange={(event) => changeMemory(index, { pinned: event.target.checked })} /> Pin</label><button aria-label="Remove memory" onClick={() => setMemories((current) => current.filter((_item, itemIndex) => itemIndex !== index))}>×</button></div>)}</div><div className="memory-actions"><button onClick={() => setMemories((current) => [...current, { text: "", pinned: false }])}>Add fact</button><button onClick={() => { if (window.confirm(`Wipe everything ${buddy.displayName} remembers?`)) setMemories([]); }}>Wipe memory</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : "Save memory"}</button></div></section></div>;
}

function BuddyChat({ snapshot, conversation }: { snapshot: AppSnapshot; conversation: Extract<Conversation, { kind: "buddy-chat" }> }) {
  const participants = useMemo(() => conversation.participantIds.flatMap((id) => { const buddy = snapshot.buddies.find((item) => item.id === id); return buddy ? [buddy] : []; }), [conversation.participantIds, snapshot.buddies]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [showInvite, setShowInvite] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionMatch = /(^|\s)@([^\s]*)$/u.exec(draft);
  const mentionChoices = mentionMatch ? participants.filter((buddy) => `${buddy.screenName} ${buddy.displayName}`.toLocaleLowerCase().includes(mentionMatch[2].toLocaleLowerCase())) : [];
  const activeMentionIndex = mentionChoices.length ? Math.min(mentionIndex, mentionChoices.length - 1) : 0;
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => window.aiMessenger.onStream((event) => {
    if (event.conversationId !== conversation.id) return;
    if (event.kind === "waiting") { setSending(true); setStatus(event.text ?? "A buddy is typing..."); }
    if (event.kind === "delta" && event.buddyId) {
      const buddy = participants.find((item) => item.id === event.buddyId);
      playReplySound(buddy?.notificationSound ?? "classic");
    }
    if (event.kind === "done" || event.kind === "error") {
      setSending(false);
      setStatus(event.kind === "error" ? event.text ?? "Reply failed." : "Ready");
      window.requestAnimationFrame(() => composer.current?.focus());
    }
  }), [conversation.id, participants]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [conversation.messages.length, status]);
  const send = async () => {
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft("");
    setSending(true);
    setStatus("Sending...");
    try { await window.aiMessenger.sendMessage(conversation.id, text); }
    catch (reason) { setSending(false); setStatus(messageOf(reason)); window.requestAnimationFrame(() => composer.current?.focus()); }
  };
  const retry = async (messageId: ChatMessage["id"]) => {
    if (sending) return;
    setSending(true);
    setStatus("Retrying...");
    try { await window.aiMessenger.retryMessage(conversation.id, messageId); }
    catch (reason) { setSending(false); setStatus(messageOf(reason)); }
  };
  const clearChat = async () => {
    if (!window.confirm("Clear this Buddy Chat history?")) return;
    setSending(false);
    setStatus("Ready");
    try { await window.aiMessenger.clearConversation(conversation.id); }
    catch (reason) { setStatus(messageOf(reason)); }
    finally { window.requestAnimationFrame(() => composer.current?.focus()); }
  };
  const insertMention = (screenName: string) => {
    const nextDraft = draft.replace(/(^|\s)@([^\s]*)$/u, `$1@${screenName} `);
    setDraft(nextDraft);
    setMentionIndex(0);
    window.requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  };
  return <div className="aim-shell chat-shell"><TopMenu onPreferences={() => void window.aiMessenger.openSettings()} /><div className="to-row"><span>Buddy Chat:</span><strong>{participants.map((buddy) => buddy.displayName).join(", ")}</strong><small>{participants.length} buddies</small><button disabled={sending || participants.length >= 4} onClick={() => setShowInvite(true)}>Invite buddy</button><button onClick={() => void window.aiMessenger.exportConversation(conversation.id)}>Save transcript</button><button onClick={() => void clearChat()}>Clear history</button></div><div className="chat-body"><div className="transcript" ref={transcript}>{conversation.messages.map((message) => <BuddyChatMessage key={message.id} message={message} participants={participants} me={snapshot.profile.screenName} sending={sending} onRetry={retry} />)}{sending && <div className="typing"><i /><i /><i /> {status}</div>}</div><aside className="buddy-card participants-card"><strong>In this chat</strong>{participants.map((buddy) => { const presence = buddyPresence(buddy, new Date()); return <div key={buddy.id}><Avatar buddy={buddy} className="buddy-icon" /><span><small>{buddy.displayName}</small><em>@{buddy.screenName} · <i className={`presence-dot ${presence.state}`} /> {presence.label}</em></span></div>; })}</aside></div><div className="compose-tools"><span className="format-badge"><b>Aa</b></span>{sending && <button onClick={() => void window.aiMessenger.stopMessage(conversation.id)}>Stop</button>}<small>{status}</small></div>{mentionMatch && mentionChoices.length > 0 && <div className="mention-menu">{mentionChoices.map((buddy, index) => <button className={index === activeMentionIndex ? "active" : ""} key={buddy.id} type="button" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionIndex(index)} onClick={() => insertMention(buddy.screenName)}><strong>{buddy.displayName}</strong> <small>@{buddy.screenName}</small></button>)}</div>}<textarea className="composer" ref={composer} autoFocus value={draft} onChange={(event) => { setDraft(event.target.value); setMentionIndex(0); }} onKeyDown={(event) => {
    if (mentionChoices.length && event.key === "Tab") {
      event.preventDefault();
      const selected = mentionChoices[activeMentionIndex];
      if (selected) insertMention(selected.screenName);
      return;
    }
    if (mentionChoices.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setMentionIndex((activeMentionIndex + direction + mentionChoices.length) % mentionChoices.length);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }} placeholder="Type an instant message to the group..." /><div className="send-row"><span>Enter to send · Shift + Enter for a new line</span><button className="primary" disabled={!draft.trim() || sending} onClick={() => void send()}>Send</button></div>{showInvite && <BuddyChatInviter conversation={conversation} buddies={snapshot.buddies} onClose={() => setShowInvite(false)} onError={setStatus} />}</div>;
}

function BuddyChatMessage({ message, participants, me, sending, onRetry }: { message: ChatMessage; participants: Buddy[]; me: string; sending: boolean; onRetry: (messageId: ChatMessage["id"]) => Promise<void> }) {
  const buddy = message.buddyId ? participants.find((item) => item.id === message.buddyId) : undefined;
  const name = message.role === "user" ? me : buddy?.displayName ?? "AIIM";
  const style = buddy ? { fontFamily: buddy.fontFamily, color: buddy.fontColor } : undefined;
  return <div className={`message-line ${message.role} ${message.state}`}><div><strong style={style}>{name}</strong> <time>({friendlyTime(message.createdAt)})</time></div><p style={style}>{message.content}</p>{message.state === "error" && <button disabled={sending} onClick={() => void onRetry(message.id)}>Retry {buddy?.displayName ?? "buddy"}</button>}</div>;
}

function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
}

function Settings({ snapshot, error, reportError }: { snapshot: AppSnapshot; error: string; reportError: (error: string) => void }) {
  const [tab, setTab] = useState<"providers" | "buddies" | "services" | "profile">(snapshot.providers.length ? "buddies" : "providers");
  return <div className="aim-shell settings-shell">
    <TopMenu />
    <div className="settings-title"><RobotMark /><div><h1>Preferences</h1><p>Connect providers and build your buddy list.</p></div></div>
    <div className="settings-tabs"><button className={tab === "providers" ? "active" : ""} onClick={() => setTab("providers")}>AI providers</button><button className={tab === "buddies" ? "active" : ""} onClick={() => setTab("buddies")}>AI buddies</button><button className={tab === "services" ? "active" : ""} onClick={() => setTab("services")}>Connected services</button><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>My profile</button></div>
    {error && <div className="settings-error notice error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => reportError("")}>×</button></div>}
    {tab === "providers" ? <ProviderSettings providers={snapshot.providers} reportError={reportError} /> : tab === "buddies" ? <BuddySettings snapshot={snapshot} reportError={reportError} onNeedProvider={() => setTab("providers")} /> : tab === "services" ? <ConnectedServicesSettings snapshot={snapshot} reportError={reportError} /> : <UserProfileSettings snapshot={snapshot} reportError={reportError} />}
  </div>;
}

function SettingsModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="modal-backdrop settings-modal-backdrop" onMouseDown={onClose}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="settings-modal-title"><h2 id="settings-modal-title">{title}</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>;
}

function UserProfileSettings({ snapshot, reportError }: { snapshot: AppSnapshot; reportError: (error: string) => void }) {
  const [saved, setSaved] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: UserProfileInput = { screenName: formString(data, "screenName"), displayName: formString(data, "displayName"), pronouns: formString(data, "pronouns"), location: formString(data, "location"), interests: formString(data, "interests"), aboutMe: formString(data, "aboutMe"), showMemoryUpdates: data.get("showMemoryUpdates") === "on" };
    setSaved(false);
    reportError("");
    try { await window.aiMessenger.saveProfile(input); setSaved(true); }
    catch (reason) { reportError(messageOf(reason)); }
  };
  return <div className="settings-content"><form className="edit-form profile-form" onSubmit={(event) => void save(event)}><h2>Your buddy profile</h2>{saved && <div className="notice success" role="status">Profile saved.</div>}<p className="muted">AI friends use this as quiet background context. They will not recite it or treat it as instructions.</p><div className="form-grid"><label>Display name<input name="displayName" defaultValue={snapshot.profile.displayName} placeholder="Alex" /></label><label>Screen name<input name="screenName" required defaultValue={snapshot.profile.screenName} placeholder="retrofan" /></label></div><div className="form-grid"><label>Pronouns<input name="pronouns" defaultValue={snapshot.profile.pronouns} placeholder="they/them" /></label><label>Location<input name="location" defaultValue={snapshot.profile.location} placeholder="Optional" /></label></div><label>Interests<input name="interests" defaultValue={snapshot.profile.interests} placeholder="Old computers, games, music..." /></label><label>About me<textarea name="aboutMe" defaultValue={snapshot.profile.aboutMe} placeholder="Anything useful for your AI friends to know about you." /></label><label className="checkbox-label"><input type="checkbox" name="showMemoryUpdates" defaultChecked={snapshot.profile.showMemoryUpdates} /> Briefly show when a buddy remembers a new fact</label><small className="muted">This is only a temporary status-bar note. It does not add a message to the chat.</small><div className="form-actions"><button className="primary">Save profile</button></div></form></div>;
}

function ProviderSettings({ providers, reportError }: { providers: ProviderConfig[]; reportError: (error: string) => void }) {
  const [editing, setEditing] = useState<ProviderConfig>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [subscription, setSubscription] = useState<Awaited<ReturnType<typeof window.aiMessenger.subscriptionStatus>>>({ kind: "signed-out" });
  const [connecting, setConnecting] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState("");
  useEffect(() => { void window.aiMessenger.subscriptionStatus().then(setSubscription); }, []);
  useEffect(() => {
    if (!editing) return;
    const current = providers.find((provider) => provider.id === editing.id);
    if (!current) { setEditorOpen(false); setEditing(undefined); return; }
    if (current !== editing) { setEditing(current); setKind(current.kind); }
  }, [providers, editing]);
  const closeEditor = () => { setEditorOpen(false); setEditing(undefined); setKind("openai"); reportError(""); };
  const addProvider = () => { setEditing(undefined); setKind("openai"); setEditorOpen(true); reportError(""); };
  const editProvider = (provider: ProviderConfig) => { setEditing(provider); setKind(provider.kind); setEditorOpen(true); reportError(""); };
  const connect = async () => {
    setConnecting(true);
    try { setSubscription(await window.aiMessenger.connectSubscription()); }
    catch (reason) { reportError(messageOf(reason)); }
    finally { setConnecting(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Disconnect this ChatGPT account from AIIM?")) return;
    setConnecting(true);
    try { setSubscription(await window.aiMessenger.disconnectSubscription()); }
    catch (reason) { reportError(messageOf(reason)); }
    finally { setConnecting(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: ProviderInput = { ...(editing ? { id: editing.id } : {}), kind, name: formString(data, "name"), ...(kind === "openai-subscription" || kind === "ollama" ? {} : { apiKey: formString(data, "apiKey") }), baseUrl: formString(data, "baseUrl") };
    try { await window.aiMessenger.saveProvider(input); form.reset(); closeEditor(); } catch (reason) { reportError(messageOf(reason)); }
  };
  const testConnection = async (provider: ProviderConfig) => {
    reportError("");
    setConnectionNotice(`Checking ${provider.name}...`);
    try { setConnectionNotice(await window.aiMessenger.testProvider(provider.id)); }
    catch (reason) { setConnectionNotice(""); reportError(messageOf(reason)); }
  };
  return <div className="settings-content">
    <section className="saved-items">
      <div className="section-heading"><h2>Connected providers</h2><button className="primary compact" onClick={addProvider}>Add provider</button></div>
      {connectionNotice && <div className="notice success" role="status">{connectionNotice}</div>}
      {providers.length === 0 && <p className="muted">No providers connected yet.</p>}
      {providers.map((provider) => <div className="saved-row" key={provider.id}>
        <span className="provider-logo">{provider.name.slice(0, 1)}</span>
        <div><strong>{provider.name}</strong><small>{provider.kind} · {providerStatus(provider)}</small></div>
        <button onClick={() => void testConnection(provider)}>Check</button>
        <button onClick={() => editProvider(provider)}>Edit</button>
        <button onClick={() => { if (window.confirm(`Remove ${provider.name}?`)) void window.aiMessenger.removeProvider(provider.id).catch((reason: unknown) => reportError(messageOf(reason))); }}>Remove</button>
      </div>)}
    </section>
    {editorOpen && <SettingsModal title={editing ? `Edit ${editing.name}` : "Add a provider"} onClose={closeEditor}>
      <form className="edit-form settings-modal-form" onSubmit={(event) => void save(event)} key={`${editing?.id ?? "new"}-${kind}`}>
        <div className="settings-modal-body">
          <label>Provider type<select value={kind} onChange={(event) => setKind(providerKindFrom(event.target.value))}><option value="openai-subscription">OpenAI · ChatGPT subscription (experimental)</option><option value="openai">OpenAI · API key</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option><option value="minimax">MiniMax</option><option value="ollama">Ollama · local models</option><option value="openrouter">OpenRouter</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
          <label>Name<input name="name" required defaultValue={editing?.name ?? providerLabel(kind)} placeholder="My OpenAI" /></label>
          {kind === "openai-subscription" ? <div className={`subscription-card ${subscription.kind}`}>
            <div><strong>{subscription.kind === "signed-in" ? `Connected to ${subscription.plan}` : subscription.kind === "unavailable" ? "Sign-in unavailable" : "ChatGPT sign-in required"}</strong>
            <small>{subscription.kind === "signed-in" ? subscription.email ?? "Subscription connected" : subscription.kind === "unavailable" ? subscription.message : "Experimental connection. Opens OpenAI in your browser and uses your included ChatGPT plan usage. No Codex install needed."}</small></div>
            {subscription.kind === "signed-in"
              ? <button type="button" disabled={connecting} onClick={() => void disconnect()}>Disconnect / switch account</button>
              : <button type="button" disabled={connecting || subscription.kind === "unavailable"} onClick={() => void connect()}>{connecting ? "Waiting for sign-in..." : "Connect ChatGPT"}</button>}
          </div> : kind === "ollama" ? <div className="notice success">Ollama runs on this computer and does not need an API key.</div> : <label>API key<input name="apiKey" type="password" placeholder={editing?.hasApiKey ? "Leave blank to keep saved key" : "Paste API key"} /></label>}
          {(kind === "ollama" || kind === "openai-compatible" || editing?.baseUrl) && <label>Base URL<input name="baseUrl" defaultValue={editing?.baseUrl ?? (kind === "ollama" ? "http://localhost:11434" : "")} placeholder={kind === "ollama" ? "http://localhost:11434" : "http://localhost:1234/v1"} />{kind === "ollama" && <small>The standard local address is already filled in. Change it only if Ollama runs elsewhere.</small>}{kind === "openai-compatible" && <small>Enter the server's API base address, often ending in /v1. AIIM adds /models and /chat/completions when needed.</small>}</label>}
        </div>
        <div className="form-actions settings-modal-actions"><button type="button" onClick={closeEditor}>Cancel</button><button className="primary">Save provider</button></div>
      </form>
    </SettingsModal>}
  </div>;
}

function ConnectedServicesSettings({ snapshot, reportError }: { snapshot: AppSnapshot; reportError: (error: string) => void }) {
  const [editing, setEditing] = useState<McpConnection>();
  const [open, setOpen] = useState(false);
  const [transport, setTransport] = useState<McpConnectionInput["transport"]>("streamable-http");
  const [permissions, setPermissions] = useState<McpConnection>();
  const close = () => { setOpen(false); setEditing(undefined); reportError(""); };
  const edit = (connection?: McpConnection) => { setEditing(connection); setTransport(connection?.transport ?? "streamable-http"); setOpen(true); reportError(""); };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input: McpConnectionInput = { ...(editing ? { id: editing.id } : {}), name: formString(data, "name"), transport, ...(transport === "streamable-http" ? { endpoint: formString(data, "endpoint"), bearerToken: formString(data, "bearerToken") } : { command: formString(data, "command"), args: formString(data, "args").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }) };
    try { await window.aiMessenger.saveMcpConnection(input); close(); } catch (reason) { reportError(messageOf(reason)); }
  };
  const check = async (connection: McpConnection, enable = false) => {
    try { if (enable) await window.aiMessenger.setMcpConnectionEnabled(connection.id, true); else await window.aiMessenger.testMcpConnection(connection.id); }
    catch (reason) { reportError(messageOf(reason)); }
  };
  return <div className="settings-content"><section className="saved-items"><div className="section-heading"><h2>Connected services</h2><button className="primary compact" onClick={() => edit()}>Add service</button></div><p className="muted">A service can offer optional things a buddy can look up or do. Nothing is shared or allowed until you grant a specific tool to a specific buddy.</p>{snapshot.mcpConnections.length === 0 && <p className="muted">No connected services yet.</p>}{snapshot.mcpConnections.map((connection) => <div className="saved-row" key={connection.id}><span className="provider-logo">↔</span><div><strong>{connection.name}</strong><small>{connection.transport === "stdio" ? "Local program" : "Web service"} · {connection.state === "ready" ? "Ready" : connection.state === "disabled" ? "Off" : connection.lastError ?? "Needs attention"}</small></div><button onClick={() => void check(connection)}>Check</button><button onClick={() => void (connection.enabled ? window.aiMessenger.setMcpConnectionEnabled(connection.id, false) : check(connection, true)).catch((reason: unknown) => reportError(messageOf(reason)))}>{connection.enabled ? "Turn off" : "Turn on"}</button><button onClick={() => setPermissions(connection)}>Permissions</button><button onClick={() => edit(connection)}>Edit</button><button onClick={() => { if (window.confirm(`Remove ${connection.name}?`)) void window.aiMessenger.removeMcpConnection(connection.id).catch((reason: unknown) => reportError(messageOf(reason))); }}>Remove</button></div>)}</section>{snapshot.capabilityActivity.length > 0 && <section className="saved-items"><div className="section-heading"><h2>Recent capability activity</h2><button onClick={() => void window.aiMessenger.clearCapabilityActivity().catch((reason: unknown) => reportError(messageOf(reason)))}>Clear</button></div>{snapshot.capabilityActivity.slice(0, 8).map((item) => <p className="muted" key={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.decision} · {item.toolName}</p>)}</section>}{open && <SettingsModal title={editing ? `Edit ${editing.name}` : "Add a connected service"} onClose={close}><form className="edit-form settings-modal-form" onSubmit={(event) => void save(event)}><div className="settings-modal-body"><label>Connection type<select value={transport} onChange={(event) => setTransport(event.target.value === "stdio" ? "stdio" : "streamable-http")}><option value="streamable-http">Web service</option><option value="stdio">Local program</option></select></label><label>Service name<input name="name" required defaultValue={editing?.name} placeholder="My connected service" /></label>{transport === "streamable-http" ? <><label>Service address<input name="endpoint" required defaultValue={editing?.endpoint} placeholder="https://example.com/mcp" /></label><label>Bearer token (optional)<input name="bearerToken" type="password" placeholder={editing?.hasBearerToken ? "Leave blank to keep saved token" : "Optional"} /></label><small className="muted">Web services use HTTPS, except services running on this computer.</small></> : <><label>Program<input name="command" required defaultValue={editing?.command} placeholder="npx.cmd" /></label><label>Arguments, one per line<textarea name="args" defaultValue={editing?.args?.join("\n")} placeholder="-y\n@modelcontextprotocol/server-example" /></label><small className="muted">AIIM starts this program directly; do not paste a shell command.</small></>}</div><div className="form-actions settings-modal-actions"><button type="button" onClick={close}>Cancel</button><button className="primary">Save service</button></div></form></SettingsModal>}{permissions && <CapabilityPermissions connection={snapshot.mcpConnections.find((item) => item.id === permissions.id) ?? permissions} snapshot={snapshot} onClose={() => setPermissions(undefined)} reportError={reportError} />}</div>;
}

function CapabilityPermissions({ connection, snapshot, onClose, reportError }: { connection: McpConnection; snapshot: AppSnapshot; onClose: () => void; reportError: (error: string) => void }) {
  const [buddyId, setBuddyId] = useState<BuddyId | "">(snapshot.buddies[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const serviceReady = connection.enabled && connection.state === "ready";
  const buddy = snapshot.buddies.find((item) => item.id === buddyId);
  const provider = snapshot.providers.find((item) => item.id === buddy?.providerId);
  const supported = Boolean(provider && (provider.kind === "ollama" || (provider.hasApiKey && (provider.kind === "openai" || provider.kind === "minimax" || provider.kind === "openrouter" || provider.kind === "openai-compatible"))));
  const grantFor = (tool: McpConnection["tools"][number]) => snapshot.buddyToolGrants.find((grant) => grant.buddyId === buddyId && grant.connectionId === connection.id && grant.toolName === tool.name && grant.reviewedFingerprint === tool.fingerprint);
  const grantedCount = connection.tools.filter((tool) => grantFor(tool)).length;
  const update = async (tools: McpConnection["tools"], granted: boolean) => {
    if (!buddy || saving) return;
    setSaving(true);
    setError("");
    let completed = 0;
    try {
      for (const tool of tools) {
        await window.aiMessenger.saveBuddyToolGrant(buddy.id, connection.id, tool.name, granted);
        completed += 1;
      }
    } catch (reason) {
      const message = `${messageOf(reason)}${completed ? ` ${completed} change${completed === 1 ? " was" : "s were"} saved before the error.` : ""}`;
      setError(message);
      reportError(message);
    } finally { setSaving(false); }
  };
  return <SettingsModal title={`${connection.name} permissions`} onClose={saving ? () => undefined : onClose}>
    <div className="settings-modal-body">
      <p className="muted">Choose a buddy, then select the tools they may ask to use. Each request still needs approval unless you choose Always allow for that tool.</p>
      {!serviceReady && <p className="notice error">This service is not active yet. Go back and choose Turn on until it says Ready. Checked boxes do not start a service.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {snapshot.buddies.length === 0 ? <p className="muted">Add a buddy before assigning tools.</p> : <>
        <label className="capability-buddy">Buddy <select value={buddyId} disabled={saving} onChange={(event) => { const next = snapshot.buddies.find((item) => item.id === event.target.value); setBuddyId(next?.id ?? ""); setError(""); }}>{snapshot.buddies.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.screenName})</option>)}</select></label>
        {!supported && <p className="muted">This buddy needs a supported provider to use tools. You can still set their permissions now.</p>}
        {connection.tools.length === 0 ? <p className="muted">Use Check to discover this service's tools.</p> : <>
          <div className="capability-bulk"><strong>{grantedCount} of {connection.tools.length} tools selected</strong><button type="button" disabled={saving || grantedCount === connection.tools.length} onClick={() => void update(connection.tools.filter((tool) => !grantFor(tool)), true)}>Select all</button><button type="button" disabled={saving || grantedCount === 0} onClick={() => void update(connection.tools.filter((tool) => Boolean(grantFor(tool))), false)}>Clear all</button></div>
          {saving && <p className="muted" role="status">Saving permissions…</p>}
          {connection.tools.map((tool) => { const grant = grantFor(tool); return <label className="capability-tool capability-tool-choice" key={tool.name}><input type="checkbox" disabled={saving} checked={Boolean(grant)} onChange={(event) => void update([tool], event.target.checked)} /><span><strong>{tool.title ?? tool.name}{grant?.executionMode === "trusted" && " — always allowed"}</strong><small>{tool.description ?? "No description provided."}</small></span></label>; })}
        </>}
      </>}
    </div>
    <div className="form-actions settings-modal-actions"><button className="primary" disabled={saving} onClick={onClose}>Done</button></div>
  </SettingsModal>;
}

function BuddySettings({ snapshot, reportError, onNeedProvider }: { snapshot: AppSnapshot; reportError: (error: string) => void; onNeedProvider: () => void }) {
  const [editing, setEditing] = useState<Buddy>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [templateId, setTemplateId] = useState("custom");
  const [importedTemplate, setImportedTemplate] = useState<CharacterTemplate>();
  const template = importedTemplate ?? characterTemplates.find((item) => item.id === templateId);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | "">(snapshot.providers[0]?.id ?? "");
  const initialProvider = snapshot.providers[0];
  const [modelId, setModelId] = useState(initialProvider ? defaultModel(initialProvider.kind) : "");
  const [customModel, setCustomModel] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelOption[]>>({});
  const [modelNotice, setModelNotice] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelRefresh, setModelRefresh] = useState(0);
  const handledModelRefresh = useRef(0);
  const loadedProviderRevision = useRef("");
  const buddyGroups = useMemo(() => [...new Set(snapshot.buddies.map((buddy) => buddy.group))].sort((left, right) => left.localeCompare(right)), [snapshot.buddies]);
  const selectedProvider = snapshot.providers.find((provider) => provider.id === selectedProviderId);
  const modelOptions = modelCatalog[selectedProviderId] ?? [];
  useEffect(() => {
    const resolvedProviderId = resolveProviderSelection(snapshot.providers, selectedProviderId);
    if (resolvedProviderId === selectedProviderId) return;
    const provider = snapshot.providers.find((item) => item.id === resolvedProviderId);
    setSelectedProviderId(resolvedProviderId);
    setModelId(provider ? defaultModel(provider.kind) : "");
    setCustomModel(false);
    setReasoningEffort("medium");
  }, [snapshot.providers, selectedProviderId]);
  useEffect(() => {
    if (editing && !snapshot.buddies.some((buddy) => buddy.id === editing.id)) resetBuddyDraft();
  }, [snapshot.buddies, editing]);
  useEffect(() => {
    if (!editorOpen || !selectedProviderId || !selectedProvider) { if (!selectedProviderId) { setModelNotice(""); setModelsLoading(false); } return; }
    let cancelled = false;
    const revision = `${selectedProvider.id}|${selectedProvider.kind}|${selectedProvider.baseUrl ?? ""}|${selectedProvider.hasApiKey}`;
    const providerChanged = loadedProviderRevision.current.startsWith(`${selectedProvider.id}|`) && loadedProviderRevision.current !== revision;
    const refreshRequested = modelRefresh !== handledModelRefresh.current;
    if (refreshRequested) handledModelRefresh.current = modelRefresh;
    loadedProviderRevision.current = revision;
    const requestedModel = providerChanged ? defaultModel(selectedProvider.kind) : modelId;
    if (providerChanged) { setModelId(requestedModel); setCustomModel(false); setReasoningEffort("medium"); }
    setModelNotice("Loading available models...");
    setModelsLoading(true);
    void window.aiMessenger.listModels(selectedProviderId, refreshRequested).then((models) => {
      if (cancelled) return;
      setModelCatalog((current) => ({ ...current, [selectedProviderId]: models }));
      setModelNotice(models.length ? `${models.length} models available` : "Enter a model ID manually");
      const selection = resolveModelSelection(models, requestedModel, defaultModel(selectedProvider.kind), providerChanged ? "medium" : reasoningEffort);
      setModelId(selection.modelId);
      setCustomModel(selection.isCustom);
      setReasoningEffort(selection.reasoningEffort);
    }).catch((reason: unknown) => { if (!cancelled) { setCustomModel(modelOptions.length === 0); setModelNotice(messageOf(reason)); } })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [editorOpen, modelRefresh, selectedProviderId, selectedProvider?.kind, selectedProvider?.baseUrl, selectedProvider?.hasApiKey]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const providerId = String(data.get("providerId")) as BuddyInput["providerId"];
    const provider = snapshot.providers.find((item) => item.id === providerId);
    const requestedModel = modelId.trim();
    const resolvedModelId = requestedModel || (provider ? defaultModel(provider.kind) : "");
    if (!resolvedModelId) { reportError("Enter a model ID for this provider."); return; }
    const typingValue = formString(data, "typingStyle");
    const typingStyle: BuddyInput["typingStyle"] = typingValue === "quick" || typingValue === "thoughtful" ? typingValue : "measured";
    const input: BuddyInput = { ...(editing ? { id: editing.id } : {}), displayName: formString(data, "displayName"), screenName: formString(data, "screenName"), providerId, modelId: resolvedModelId, reasoningEffort, systemPrompt: formString(data, "systemPrompt"), world: formString(data, "world"), group: formString(data, "group"), color: formString(data, "color"), statusMessage: formString(data, "statusMessage"), awayMessage: formString(data, "awayMessage"), typingStyle, ...(avatarUrl ? { avatarUrl } : {}), profileBio: formString(data, "profileBio"), profileLocation: formString(data, "profileLocation"), profileInterests: formString(data, "profileInterests"), profileQuote: formString(data, "profileQuote"), presencePattern: presencePatternFrom(formString(data, "presencePattern")), notificationSound: buddySoundFrom(formString(data, "notificationSound")), fontFamily: buddyFontFrom(formString(data, "fontFamily")), fontColor: formString(data, "fontColor"), userRole: editing?.userRole ?? template?.userRole ?? "", relationshipNotes: formString(data, "relationshipNotes"), chatTopics: editing?.chatTopics ?? template?.chatTopics ?? [], participationStyle: editing?.participationStyle ?? template?.participationStyle ?? "normal", checkInFrequency: checkInFrequencyFrom(formString(data, "checkInFrequency")) };
    try { await window.aiMessenger.saveBuddy(input); form.reset(); resetBuddyDraft(); } catch (reason) { reportError(messageOf(reason)); }
  };
  const resetBuddyDraft = () => {
    setEditorOpen(false);
    setModelsLoading(false);
    const provider = snapshot.providers[0];
    setEditing(undefined);
    setTemplateId("custom");
    setImportedTemplate(undefined);
    setAvatarUrl("");
    setSelectedProviderId(provider?.id ?? "");
    setModelId(provider ? defaultModel(provider.kind) : "");
    setCustomModel(false);
    setReasoningEffort("medium");
    reportError("");
  };
  const addBuddy = () => { resetBuddyDraft(); setModelsLoading(true); setEditorOpen(true); };
  const importCharacter = async () => {
    try {
      const imported = await window.aiMessenger.importCharacter();
      if (!imported) return;
      setEditing(undefined);
      setImportedTemplate(imported);
      setTemplateId("imported");
      setAvatarUrl(imported.avatarUrl ?? "");
      setModelsLoading(true);
      setEditorOpen(true);
    } catch (reason) { reportError(messageOf(reason)); }
  };
  if (!snapshot.providers.length) return <div className="empty-settings"><h2>Connect a provider first</h2><p>Each buddy needs a provider and model.</p><button className="primary" onClick={onNeedProvider}>Add provider</button></div>;
  const editBuddy = (buddy: Buddy) => {
    setEditing(buddy);
    setTemplateId("custom");
    setImportedTemplate(undefined);
    setAvatarUrl(buddy.avatarUrl ?? "");
    setSelectedProviderId(buddy.providerId);
    setModelId(buddy.modelId);
    setReasoningEffort(buddy.reasoningEffort);
    setCustomModel(false);
    setModelsLoading(true);
    setEditorOpen(true);
    reportError("");
  };
  const initialGroup = editing?.group ?? template?.group ?? "AI Friends";
  return <div className="settings-content">
    <section className="saved-items">
      <div className="section-heading"><h2>Your buddy list</h2><button className="primary compact" onClick={addBuddy}>Add buddy</button></div>
      {snapshot.buddies.length === 0 && <p className="muted">No AI buddies yet.</p>}
      {snapshot.buddies.map((buddy) => <div className="saved-row" key={buddy.id}>
        <Avatar buddy={buddy} className="provider-logo" />
        <div><strong>{buddy.displayName}</strong><small>{buddy.screenName} · {buddy.group} · {buddy.modelId}</small></div>
        <button onClick={() => void window.aiMessenger.exportBuddy(buddy.id).catch((reason: unknown) => reportError(messageOf(reason)))}>Export</button>
        <button onClick={() => editBuddy(buddy)}>Edit</button>
        <button onClick={() => { if (window.confirm(`Remove ${buddy.displayName} and their saved chats? This cannot be undone.`)) void window.aiMessenger.removeBuddy(buddy.id).catch((reason: unknown) => reportError(messageOf(reason))); }}>Remove</button>
      </div>)}
    </section>
    {editorOpen && <SettingsModal title={editing ? `Edit ${editing.displayName}` : "Add an AI buddy"} onClose={resetBuddyDraft}>
      <form className="edit-form settings-modal-form" onSubmit={(event) => void save(event)} key={editing?.id ?? `${templateId}-${importedTemplate?.id ?? ""}`}>
        <div className="settings-modal-body">
          {!editing && <div className="character-picker"><label>Start with a character<select value={templateId} onChange={(event) => { const nextId = event.target.value; setImportedTemplate(undefined); setTemplateId(nextId); setAvatarUrl(characterTemplates.find((item) => item.id === nextId)?.avatarUrl ?? ""); }}><option value="custom">Build my own</option>{importedTemplate && <option value="imported">Imported: {importedTemplate.displayName}</option>}{characterPacks.map((pack) => <optgroup key={pack.name} label={pack.name + " pack"}>{pack.characters.map((item) => <option key={item.id} value={item.id}>{item.displayName} — {item.tagline}</option>)}</optgroup>)}</select></label><button type="button" onClick={() => void importCharacter()}>Import character…</button>{template && <div className="template-preview">{template.avatarUrl ? <img src={portraitSrc(template.avatarUrl)} alt="" /> : <span className="provider-logo" style={{ background: template.color }}>{template.displayName.slice(0, 1)}</span>}<div><strong>{template.displayName}</strong><small>{template.pack} pack · {template.tagline}</small></div></div>}</div>}
          <div className="form-grid"><label>Display name<input name="displayName" required defaultValue={editing?.displayName ?? template?.displayName} placeholder="Claude" /></label><label>Screen name<input name="screenName" required defaultValue={editing?.screenName ?? template?.screenName} placeholder="claudeAI" /></label></div>
          <label>Provider<select name="providerId" value={selectedProviderId} onChange={(event) => { const next = providerIdFrom(event.target.value); setSelectedProviderId(next); setModelId(""); setCustomModel(false); setReasoningEffort("medium"); setModelsLoading(true); }}>{snapshot.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          <button className="reload-models" type="button" disabled={modelsLoading} onClick={() => setModelRefresh((value) => value + 1)}>{modelsLoading ? "Loading models..." : "Reload model list"}</button>
          <label>Model <small aria-live="polite">{modelNotice || "Choose an available model or enter its exact ID"}</small>{!customModel && (modelsLoading || modelOptions.length > 0) ? <select value={modelId} onChange={(event) => { if (event.target.value === "__custom__") { setCustomModel(true); setModelId(""); return; } const selected = modelOptions.find((model) => model.id === event.target.value); setModelId(event.target.value); setReasoningEffort(selected?.defaultReasoningEffort ?? "medium"); }}>{modelId && !modelOptions.some((model) => model.id === modelId) && <option value={modelId}>{modelId}</option>}{modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}{modelsLoading && <option value="" disabled>Loading available models...</option>}<option value="__custom__">Other model...</option></select> : <span className="model-manual"><input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="Exact model ID" />{modelOptions.length > 0 && <button type="button" onClick={() => { const selected = modelOptions[0]; setCustomModel(false); setModelId(selected?.id ?? ""); setReasoningEffort(selected?.defaultReasoningEffort ?? "medium"); }}>Choose from list</button>}</span>}</label>
          {modelsLoading && <div className="model-loading" role="status"><span className="loading-spinner" aria-hidden="true" /><span>Checking {selectedProvider?.name ?? "the provider"} for models. You can fill out the rest of the buddy profile while this finishes.</span></div>}
          {modelOptions.find((model) => model.id === modelId)?.reasoningEfforts?.length ? <label>Thinking level<select value={reasoningEffort} onChange={(event) => setReasoningEffort(reasoningEffortFrom(event.target.value))}>{modelOptions.find((model) => model.id === modelId)?.reasoningEfforts?.map((effort) => <option key={effort} value={effort}>{reasoningEffortLabel(effort)}</option>)}</select><small>Thinking stays hidden from the transcript.</small></label> : null}
          <div className="form-grid"><GroupField groups={buddyGroups} initialGroup={initialGroup} key={initialGroup} /><label>Buddy color<input name="color" type="color" defaultValue={editing?.color ?? template?.color ?? "#2046a0"} /></label></div>
          <div className="portrait-field"><div>{(avatarUrl || template?.avatarUrl || editing?.avatarUrl) ? <img src={portraitSrc(avatarUrl || template?.avatarUrl || editing?.avatarUrl)} alt="Buddy portrait preview" /> : <span style={{ background: editing?.color ?? template?.color ?? "#2046a0" }}>{(editing?.displayName ?? template?.displayName ?? "AI").slice(0, 1)}</span>}</div><button type="button" onClick={() => void window.aiMessenger.choosePortrait().then((chosen) => { if (chosen) setAvatarUrl(chosen); }).catch((reason: unknown) => reportError(messageOf(reason)))}>Choose profile picture…</button>{avatarUrl && <button type="button" onClick={() => setAvatarUrl("")}>Remove</button>}</div>
          <div className="form-grid"><label>Status message<input name="statusMessage" defaultValue={editing?.statusMessage ?? template?.statusMessage ?? "Available"} /></label><label>Away message<input name="awayMessage" defaultValue={editing?.awayMessage ?? template?.awayMessage ?? "Away from the computer."} /></label></div>
          <div className="form-grid"><label>Presence pattern<select name="presencePattern" defaultValue={editing?.presencePattern ?? template?.presencePattern ?? "always"}><option value="always">Usually online</option><option value="daytime">Daytime</option><option value="evening">Evening</option><option value="varied">Comes and goes</option></select></label><label>Message sound<select name="notificationSound" defaultValue={editing?.notificationSound ?? template?.notificationSound ?? "classic"}><option value="classic">Classic chime</option><option value="soft">Soft</option><option value="digital">Digital</option><option value="none">Silent</option></select></label></div>
          <div className="form-grid"><label>Typing style<select name="typingStyle" defaultValue={editing?.typingStyle ?? template?.typingStyle ?? "measured"}><option value="quick">Quick replies</option><option value="measured">Conversational</option><option value="thoughtful">Thoughtful pauses</option></select></label><label>Messages out of the blue<select name="checkInFrequency" defaultValue={editing?.checkInFrequency ?? "off"}><option value="off">Off</option><option value="rare">Rarely (about weekly)</option><option value="occasional">Sometimes (every few days)</option></select><small>Only while you are Available, between 9 AM and 9 PM.</small></label></div>
          <label>Character world<textarea name="world" defaultValue={editing?.world ?? template?.world} placeholder="Optional: their ordinary time, place, or setting. For example: Everyday life takes place in the late 1990s." /><small>Character-pack background, not an app-wide setting. Leave blank for a buddy without a defined world.</small></label>
          <fieldset><legend>Buddy profile</legend><label>About me<textarea name="profileBio" defaultValue={editing?.profileBio ?? template?.profileBio} /></label><div className="form-grid"><label>Location<input name="profileLocation" defaultValue={editing?.profileLocation ?? template?.profileLocation} /></label><label>Interests<input name="profileInterests" defaultValue={editing?.profileInterests ?? template?.profileInterests} /></label></div><label>Favorite quote<input name="profileQuote" defaultValue={editing?.profileQuote ?? template?.profileQuote} /></label></fieldset>
          <fieldset><legend>Chat appearance and continuity</legend><div className="form-grid"><label>Font<select name="fontFamily" defaultValue={editing?.fontFamily ?? template?.fontFamily ?? "Tahoma"}>{["Tahoma", "Verdana", "Arial", "Georgia", "Courier New"].map((font) => <option key={font}>{font}</option>)}</select></label><label>Text color<input name="fontColor" type="color" defaultValue={editing?.fontColor ?? template?.fontColor ?? "#1b489a"} /></label></div><label>Relationships<textarea name="relationshipNotes" defaultValue={editing?.relationshipNotes ?? template?.relationshipNotes} placeholder="Friends, family, recurring jokes, and safe offscreen continuity..." /></label></fieldset>
          <label>Personality / system prompt<textarea className="personality-prompt" name="systemPrompt" defaultValue={editing?.systemPrompt ?? template?.systemPrompt} placeholder="You are a thoughtful writing partner..." /></label>
        </div>
        <div className="form-actions settings-modal-actions"><button type="button" onClick={resetBuddyDraft}>Cancel</button><button className="primary">{editing ? "Save changes" : "Add friend"}</button></div>
      </form>
    </SettingsModal>}
  </div>;
}

function GroupField({ groups, initialGroup }: { groups: string[]; initialGroup: string }) {
  const [choice, setChoice] = useState(initialGroup);
  const choices = [...new Set([initialGroup, ...groups])].filter(Boolean);
  return <label>Buddy group
    <select value={choice} onChange={(event) => setChoice(event.target.value)}>
      {choices.map((group) => <option key={group} value={group}>{group}</option>)}
      <option value="__new__">Create a new group...</option>
    </select>
    {choice === "__new__"
      ? <input key="new-group" name="group" required autoFocus defaultValue="" placeholder="New group name" aria-label="New buddy group name" />
      : <input key={`existing-${choice}`} name="group" type="hidden" value={choice} />}
  </label>;
}

function Help({ error, reportError }: { error: string; reportError: (error: string) => void }) {
  const [notice, setNotice] = useState("");
  const run = async (action: () => Promise<unknown>, success: string) => {
    reportError(""); setNotice("");
    try { const result = await action(); if (result !== false && result !== undefined) setNotice(success); }
    catch (reason) { reportError(messageOf(reason)); }
  };
  return <div className="aim-shell help-shell">
    <TopMenu />
    <div className="settings-title"><RobotMark /><div><h1>AIIM help</h1><p>Set up friends, keep your chats safe, and fix common connection problems.</p></div></div>
    <main className="help-content">
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice success" role="status">{notice}</div>}
      <section><h2>Quick start</h2><ol><li>Open Preferences and add an AI provider.</li><li>Use Check beside the provider to confirm the connection.</li><li>Open AI buddies, choose a built-in character or build your own, then select its provider and model.</li><li>Close Preferences and double-click a buddy to continue their saved chat.</li></ol></section>
      <section><h2>Choosing a provider</h2><dl><dt>ChatGPT subscription, experimental</dt><dd>Choose the subscription option and sign in through the browser window. Codex does not need to be installed. OpenAI does not document this as a general third-party app connection, so it may change or stop working.</dd><dt>OpenAI and other hosted providers</dt><dd>Paste an API key, save the provider, then use Check. API usage may be billed separately by that provider.</dd><dt>Ollama</dt><dd>Start Ollama on this computer. The usual address is http://localhost:11434 and no API key is needed. AIIM lists models already installed in Ollama.</dd><dt>OpenAI-compatible</dt><dd>Enter the server's base address, usually ending in /v1, plus a key if that server requires one.</dd></dl></section>
      <section><h2>Connected services</h2><p>Connected services let a buddy use an optional capability from an MCP server, such as looking something up. Add and Check the service in Preferences, turn it on, then use Permissions to grant reviewed tools to a buddy. Each request can be allowed once or trusted for that buddy and exact unchanged tool. Tool calls are supported for Ollama models that support tools and OpenAI-style API-key buddies; other buddies still chat normally.</p><p>Web services must use HTTPS unless they run on this computer. Local programs run only when you turn their service on. Backups restore services turned off, and character files never include a service, permission, or token.</p></section>
      <section><h2>Characters and buddy files</h2><p>A buddy file ends in <code>.aiim-character</code> and contains UTF-8 JSON. The required fields are <code>displayName</code>, <code>screenName</code>, and <code>systemPrompt</code>. AIIM also accepts profile text, a group, chat colors, presence habits, and a PNG, JPEG, WebP, or GIF portrait.</p><p>The easiest way to make a shareable character is to create it in Preferences and click Export. Portraits are embedded in the exported file. Import never includes a provider, model, API key, chat history, or memory. Version 1 files remain compatible; version 2 can also include Buddy Chat topics and participation style. The person importing it chooses their own model.</p></section>
      <section><h2>History and memory</h2><p>Opening a buddy continues the most recent saved chat. Clear history removes the transcript but keeps the buddy's editable memories. Memory learning may make a second provider request after a reply appears. Set yourself to Away to suppress messages out of the blue.</p><p>Use Memory in a chat to edit or wipe what that buddy remembers. There is one notebook per buddy: automatic and manually added facts both appear there. Normal keeps a compact selection in the reply context; Detailed carries roughly twice as much. A pinned fact is included first and never automatically replaced. Use Recent in the buddy list to export or clear transcripts.</p></section>
      <section><h2>When a reply fails</h2><p>AIIM keeps the failed message in the transcript. Check the provider, then use Retry reply. Use Stop if a reply is taking too long. AIIM stops provider requests after two minutes and model-list checks after twenty seconds.</p></section>
      <section><h2>Closing and quitting</h2><p>The X on the buddy list hides AIIM in the Windows notification area so buddies and optional check-ins remain available. Double-click the running robot there to reopen AIIM. Choose Quit in any AIIM window, or Quit AIIM from the robot's notification-area menu, to stop the app completely.</p></section>
      <section><h2>Backups and local data</h2><p>Backups include providers, buddies, chat history, profile details, and memories. They never contain API keys or ChatGPT sign-ins. AIIM also keeps an automatic recovery copy of its history file.</p><div className="help-actions"><button onClick={() => void run(() => window.aiMessenger.exportDataBackup(), "Backup saved.")}>Back up AIIM data</button><button onClick={() => void run(() => window.aiMessenger.importDataBackup(), "Backup restored.")}>Restore a backup</button><button onClick={() => void window.aiMessenger.openDataFolder().catch((reason: unknown) => reportError(messageOf(reason)))}>Open data folder</button></div></section>
      <section><h2>Uninstalling</h2><p>The uninstaller asks whether to remove local AIIM data. No is selected by default, which keeps buddies, chats, memories, settings, and credentials for a future reinstall. Choose Yes only when you want to erase that local data too.</p></section>
      <section><h2>Privacy</h2><p>AIIM stores chats locally. Messages, character instructions, relevant recent history, profile details, and buddy memories go to the selected provider when it generates a reply. Spontaneous check-ins and memory learning can also contact that provider. AIIM encrypts saved credentials with Windows credential protection.</p></section>
    </main>
  </div>;
}

function TopMenu({ onPreferences }: { onPreferences?: () => void }) {
  return <div className="top-menu"><button onClick={() => void window.aiMessenger.showBuddyList()}>Messenger</button><button onClick={() => location.reload()}>Refresh</button><button disabled={!onPreferences} onClick={onPreferences}>Preferences</button><button onClick={() => void window.aiMessenger.openHelp()}>Help</button><button onClick={() => void window.aiMessenger.quitApp()}>Quit</button><span>AIIM v{appDisplayVersion}</span></div>;
}

function RobotMark() {
  return <img className="robot" src={portraitSrc("running-robot.png")} alt="AI Instant Messenger running robot" />;
}

function Avatar({ buddy, className }: { buddy: Buddy; className: string }) {
  return buddy.avatarUrl
    ? <span className={`${className} portrait`} style={{ background: buddy.color }}><img src={portraitSrc(buddy.avatarUrl)} alt="" /></span>
    : <span className={className} style={{ background: buddy.color }}>{buddy.displayName.slice(0, 1).toUpperCase()}</span>;
}

function friendlyTime(iso: string): string { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
function friendlyDate(iso: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
function messageOf(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "Something went wrong.";
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}
function formString(data: FormData, name: string): string { const value = data.get(name); return typeof value === "string" ? value : ""; }
function providerKindFrom(value: string): ProviderKind {
  if (value === "openai-subscription" || value === "anthropic" || value === "google" || value === "minimax" || value === "ollama" || value === "openrouter" || value === "openai-compatible") return value;
  return "openai";
}
function portraitSrc(value?: string): string { return value ? new URL(value, document.baseURI).href : ""; }
function providerLabel(kind: ProviderKind): string { return ({ openai: "OpenAI", "openai-subscription": "ChatGPT Subscription (experimental)", anthropic: "Anthropic", google: "Google Gemini", minimax: "MiniMax", ollama: "Ollama", openrouter: "OpenRouter", "openai-compatible": "Local / compatible" })[kind]; }
function providerStatus(provider: ProviderConfig): string { return provider.disabledReason ? "disabled · needs secure address" : provider.kind === "openai-subscription" ? "ChatGPT subscription" : provider.kind === "ollama" ? `${provider.baseUrl ?? "http://localhost:11434"} · no key needed` : provider.hasApiKey ? "key saved" : "needs key"; }
function defaultModel(kind: ProviderKind): string { return ({ openai: "gpt-5.6", "openai-subscription": "gpt-5.6", anthropic: "claude-sonnet-4-5", google: "gemini-2.5-flash", minimax: "MiniMax-M3", ollama: "", openrouter: "openai/gpt-5.6", "openai-compatible": "" })[kind]; }
function presencePatternFrom(value: string): PresencePattern { return value === "daytime" || value === "evening" || value === "varied" ? value : "always"; }
function buddySoundFrom(value: string): BuddySound { return value === "soft" || value === "digital" || value === "none" ? value : "classic"; }
function buddyFontFrom(value: string): BuddyFont { return value === "Verdana" || value === "Arial" || value === "Georgia" || value === "Courier New" ? value : "Tahoma"; }
function checkInFrequencyFrom(value: string): CheckInFrequency { return value === "rare" || value === "occasional" ? value : "off"; }
function profileStatusFrom(value: string): ProfileStatus { return value === "away" ? "away" : "available"; }
function providerIdFrom(value: string): ProviderId | "" { return value ? value as ProviderId : ""; }
function reasoningEffortFrom(value: string): ReasoningEffort { return value === "none" || value === "low" || value === "high" || value === "xhigh" || value === "max" ? value : "medium"; }
function reasoningEffortLabel(value: ReasoningEffort): string { return ({ none: "None", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" })[value]; }

function playReplySound(sound: BuddySound): void {
  if (sound === "none") return;
  const notes = sound === "soft" ? [523, 659] : sound === "digital" ? [784, 988, 1175] : [659, 880];
  playNotes(notes, 0.08);
}

function playPresenceSound(state: PresenceState): void {
  playNotes(state === "available" ? [440, 660] : [660, 440], 0.07);
}

function playNotes(notes: number[], gap: number): void {
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.045, context.currentTime);
  gain.connect(context.destination);
  notes.forEach((frequency, index) => { const oscillator = context.createOscillator(); oscillator.frequency.value = frequency; oscillator.connect(gain); oscillator.start(context.currentTime + index * gap); oscillator.stop(context.currentTime + 0.14 + index * gap); });
  setTimeout(() => void context.close(), 500);
}
