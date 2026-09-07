import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import type { Buddy, BuddyId, ChatMessage, ConversationId, MessageId, ModelOption, ProfileStatus, ProviderId, StreamEvent } from "../shared/types";
import { streamCompletion } from "./providers";
import { AppStore } from "./store";
import { parseBuddyInput, parseProviderInput, parseStoredSnapshot, parseUserProfileInput } from "./validation";
import { OpenAiSubscriptionClient } from "./openai-subscription";
import { listProviderModels } from "./models";
import { replyDelayMs, returnDelayMs, waitForReplyTime } from "../shared/human-pacing";
import { parseCharacterFile } from "../shared/character-format";
import { personalizeUserReferences, userDisplayName } from "../shared/user-identity";
import { buildMemoryExtractionInstructions, parseMemoryCandidateText, shouldConsiderMemory } from "../shared/memory-learning";
import { buddyPresence } from "../shared/presence";
import { isTrustedRendererUrl } from "./ipc-security";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
if (process.env.AIIM_DATA_DIRECTORY) app.setPath("userData", process.env.AIIM_DATA_DIRECTORY);

let buddyWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let helpWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let explainedTrayClose = false;
const chatWindows = new Map<ConversationId, BrowserWindow>();
type RequestStopReason = "user" | "timeout" | "silent";
interface ActiveRequest { controller: AbortController; timeout: ReturnType<typeof setTimeout>; stopReason?: RequestStopReason; }
const activeRequests = new Map<ConversationId, ActiveRequest>();
const spontaneousRequests = new Set<ConversationId>();
const modelCache = new Map<ProviderId, ModelOption[]>();
let store: AppStore;
let subscription: OpenAiSubscriptionClient;
let dataDirectory: string;

function windowUrl(route: string): string {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  return devUrl ? `${devUrl}/#${route}` : `${pathToFileURL(path.join(__dirname, "../../dist/index.html")).href}#${route}`;
}

function createBuddyWindow(): void {
  buddyWindow = createWindow({ width: 342, height: 680, minWidth: 310, minHeight: 520, route: "/buddies", title: "AI Instant Messenger - Buddy List" });
  buddyWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    buddyWindow?.hide();
    if (!explainedTrayClose && tray) {
      explainedTrayClose = true;
      tray.displayBalloon({
        title: "AIIM is still running",
        content: "Open AIIM from the notification area. Choose Quit AIIM there when you want to sign off completely.",
        iconType: "info",
      });
    }
  });
  buddyWindow.on("closed", () => { buddyWindow = undefined; });
}

function showBuddyList(): void {
  if (!buddyWindow || buddyWindow.isDestroyed()) createBuddyWindow();
  else buddyWindow.show();
  buddyWindow?.focus();
}

function openSettingsWindow(): void {
  if (settingsWindow) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = createWindow({ width: 760, height: 720, minWidth: 600, minHeight: 560, route: "/settings", title: "AI Instant Messenger Preferences" });
  settingsWindow.on("closed", () => { settingsWindow = undefined; });
}

function openHelpWindow(): void {
  if (helpWindow) { helpWindow.show(); helpWindow.focus(); return; }
  helpWindow = createWindow({ width: 760, height: 720, minWidth: 590, minHeight: 520, route: "/help", title: "AI Instant Messenger Help" });
  helpWindow.on("closed", () => { helpWindow = undefined; });
}

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

function createTray(): void {
  if (tray) return;
  const iconPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(app.getAppPath(), "public", "running-robot.png")
    : path.join(__dirname, "../../dist/running-robot.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("AI Instant Messenger");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open AIIM", click: showBuddyList },
    { label: "Preferences", click: openSettingsWindow },
    { label: "Help", click: openHelpWindow },
    { type: "separator" },
    { label: "Quit AIIM", click: quitApplication },
  ]));
  tray.on("double-click", showBuddyList);
}

function createWindow(input: { width: number; height: number; minWidth: number; minHeight: number; route: string; title: string }): BrowserWindow {
  const allowedUrl = new URL(windowUrl(input.route));
  const window = new BrowserWindow({
    width: input.width, height: input.height, minWidth: input.minWidth, minHeight: input.minHeight, title: input.title,
    backgroundColor: "#d5d5ca", autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "../preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    const candidate = new URL(target);
    if (candidate.origin !== allowedUrl.origin || candidate.pathname !== allowedUrl.pathname) event.preventDefault();
  });
  void window.loadURL(allowedUrl.href);
  return window;
}

async function openChat(buddyId: BuddyId, requestedId?: ConversationId): Promise<void> {
  const conversation = requestedId ? store.conversation(requestedId) : store.latestConversation(buddyId) ?? await store.newConversation(buddyId);
  const existing = chatWindows.get(conversation.id);
  if (existing) { existing.show(); existing.focus(); return; }
  const buddy = store.buddy(conversation.buddyId);
  const window = createWindow({ width: 690, height: 610, minWidth: 530, minHeight: 450, route: `/chat/${conversation.id}`, title: `${buddy.displayName} - Instant Message` });
  chatWindows.set(conversation.id, window);
  window.on("closed", () => { stopRequest(conversation.id, "silent"); chatWindows.delete(conversation.id); });
  broadcastSnapshot();
}

function broadcastSnapshot(): void {
  const snapshot = store.snapshot();
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("snapshot:changed", snapshot);
}

function handleIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (!sourceWindow || event.senderFrame !== event.sender.mainFrame || !isTrustedRendererUrl(event.senderFrame.url, windowUrl("/"))) {
      throw new Error("AIIM rejected a request from an untrusted window.");
    }
    return listener(event, ...args);
  });
}

function registerIpc(): void {
  handleIpc("snapshot", () => store.snapshot());
  handleIpc("app:quit", quitApplication);
  handleIpc("provider:save", async (_event, raw: unknown) => {
    const input = parseProviderInput(raw);
    const snapshot = await store.saveProvider(input);
    if (input.id) modelCache.delete(input.id);
    broadcastSnapshot();
    return snapshot;
  });
  handleIpc("provider:remove", async (_event, id: ProviderId) => { const snapshot = await store.removeProvider(id); modelCache.delete(id); broadcastSnapshot(); return snapshot; });
  handleIpc("provider:models", async (_event, id: ProviderId, refresh = false) => {
    const cached = modelCache.get(id);
    if (cached && !refresh) return cached;
    const provider = store.provider(id);
    assertProviderEnabled(provider);
    const models = provider.kind === "openai-subscription" ? await subscription.models() : await listProviderModels(provider, store.apiKey(id));
    modelCache.set(id, models);
    return models;
  });
  handleIpc("provider:test", async (_event, id: ProviderId) => {
    const provider = store.provider(id);
    assertProviderEnabled(provider);
    if (provider.kind === "openai-subscription") {
      const status = await subscription.status();
      if (status.kind !== "signed-in") throw new Error("Connect your ChatGPT subscription first.");
      const models = await subscription.models();
      modelCache.set(id, models);
      return `Connected. ${models.length} models are available.`;
    }
    const models = await listProviderModels(provider, store.apiKey(id), true);
    modelCache.set(id, models);
    return `Connected. ${models.length} models are available.`;
  });
  handleIpc("buddy:save", async (_event, raw: unknown) => { const snapshot = await store.saveBuddy(parseBuddyInput(raw, { managedPortraitDirectory: path.join(app.getPath("userData"), "data", "portraits") })); broadcastSnapshot(); return snapshot; });
  handleIpc("buddy:remove", async (_event, id: BuddyId) => {
    const conversationIds = store.snapshot().conversations.filter((conversation) => conversation.buddyId === id).map((conversation) => conversation.id);
    for (const conversationId of conversationIds) {
      stopRequest(conversationId, "silent");
      chatWindows.get(conversationId)?.close();
    }
    const snapshot = await store.removeBuddy(id);
    broadcastSnapshot();
    return snapshot;
  });
  handleIpc("chat:open", (_event, buddyId: BuddyId, conversationId?: ConversationId) => openChat(buddyId, conversationId));
  handleIpc("buddy-list:show", showBuddyList);
  handleIpc("settings:open", openSettingsWindow);
  handleIpc("help:open", openHelpWindow);
  handleIpc("conversation:new", async (_event, buddyId: BuddyId) => { const conversation = await store.newConversation(buddyId); broadcastSnapshot(); return conversation; });
  handleIpc("conversation:delete", async (_event, id: ConversationId) => { const snapshot = await store.deleteConversation(id); chatWindows.get(id)?.close(); broadcastSnapshot(); return snapshot; });
  handleIpc("conversation:clear", async (_event, id: ConversationId) => { stopRequest(id, "silent"); const snapshot = await store.clearConversation(id); broadcastSnapshot(); return snapshot; });
  handleIpc("history:clear-all", async () => { for (const id of activeRequests.keys()) stopRequest(id, "silent"); for (const window of chatWindows.values()) window.close(); const snapshot = await store.clearAllHistory(); broadcastSnapshot(); return snapshot; });
  handleIpc("buddy:memories", async (_event, id: BuddyId, raw: unknown) => { const memories = parseMemoryEntries(raw); const snapshot = await store.saveBuddyMemories(id, memories); broadcastSnapshot(); return snapshot; });
  handleIpc("profile:status", async (_event, raw: unknown) => {
    const status: ProfileStatus = raw === "away" ? "away" : "available";
    if (status === "away") for (const id of spontaneousRequests) stopRequest(id, "silent");
    const snapshot = await store.setProfileStatus(status);
    broadcastSnapshot();
    return snapshot;
  });
  handleIpc("profile:save", async (_event, raw: unknown) => { const snapshot = await store.saveProfile(parseUserProfileInput(raw)); broadcastSnapshot(); return snapshot; });
  handleIpc("history:export", async (_event, id?: ConversationId) => {
    const snapshot = store.snapshot();
    const conversations = id ? snapshot.conversations.filter((conversation) => conversation.id === id) : snapshot.conversations;
    if (!conversations.length) throw new Error("There is no chat history to export.");
    const suggested = id ? `${safeFilename(conversations[0].title)}.txt` : "AIIM History.txt";
    const result = await dialog.showSaveDialog({ title: "Export chat history", defaultPath: suggested, filters: [{ name: "Text document", extensions: ["txt"] }] });
    if (result.canceled || !result.filePath) return false;
    const text = conversations.map((conversation) => {
      const buddy = snapshot.buddies.find((item) => item.id === conversation.buddyId);
      const heading = `${conversation.title}\n${buddy?.displayName ?? "Unknown buddy"} · ${new Date(conversation.createdAt).toLocaleString()}\n${"=".repeat(48)}`;
      return `${heading}\n\n${conversation.messages.map((message) => `[${new Date(message.createdAt).toLocaleString()}] ${message.role === "assistant" ? buddy?.displayName ?? "Buddy" : snapshot.profile.screenName}: ${message.content}`).join("\n\n")}`;
    }).join("\n\n\n");
    await fs.writeFile(result.filePath, text, "utf8");
    return true;
  });
  handleIpc("subscription:status", () => subscription.status());
  handleIpc("subscription:connect", () => subscription.connect((url) => shell.openExternal(url)));
  handleIpc("portrait:choose", async () => {
    const result = await dialog.showOpenDialog({ title: "Choose a buddy picture", properties: ["openFile"], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    if ((await fs.stat(result.filePaths[0])).size > 10_000_000) throw new Error("Buddy pictures must be smaller than 10 MB.");
    const extension = path.extname(result.filePaths[0]).toLowerCase();
    const portraitDirectory = path.join(app.getPath("userData"), "data", "portraits");
    await fs.mkdir(portraitDirectory, { recursive: true });
    const target = path.join(portraitDirectory, `${randomUUID()}${extension}`);
    await fs.copyFile(result.filePaths[0], target);
    return pathToFileURL(target).href;
  });
  handleIpc("character:import", async () => {
    const result = await dialog.showOpenDialog({ title: "Import an AIIM character", properties: ["openFile"], filters: [{ name: "AIIM character", extensions: ["json", "aiim-character"] }] });
    const source = result.filePaths[0];
    if (result.canceled || !source) return undefined;
    const sourceSize = (await fs.stat(source)).size;
    if (sourceSize > 1_000_000) throw new Error("Character files must be smaller than 1 MB.");
    const raw: unknown = JSON.parse(await fs.readFile(source, "utf8"));
    const imported = parseCharacterFile(raw);
    const avatarUrl = await importCharacterPortrait(imported.avatarFile, imported.avatarDataUrl, path.dirname(source));
    return { ...imported.template, ...(avatarUrl ? { avatarUrl } : {}) };
  });
  handleIpc("character:export", async (_event, id: BuddyId) => {
    const buddy = store.buddy(id);
    const result = await dialog.showSaveDialog({ title: `Export ${buddy.displayName}`, defaultPath: `${safeFilename(buddy.screenName)}.aiim-character`, filters: [{ name: "AIIM character", extensions: ["aiim-character"] }] });
    if (result.canceled || !result.filePath) return false;
    const avatarDataUrl = buddy.avatarUrl ? await readPortraitDataUrl(buddy.avatarUrl) : undefined;
    const character = {
      schemaVersion: 1,
      id: buddy.screenName.toLowerCase(), displayName: buddy.displayName, screenName: buddy.screenName,
      tagline: buddy.statusMessage || "AI friend", pack: "Custom", group: buddy.group, userRole: buddy.userRole,
      color: buddy.color, statusMessage: buddy.statusMessage, awayMessage: buddy.awayMessage, typingStyle: buddy.typingStyle,
      profileBio: buddy.profileBio, profileLocation: buddy.profileLocation, profileInterests: buddy.profileInterests,
      profileQuote: buddy.profileQuote, presencePattern: buddy.presencePattern, notificationSound: buddy.notificationSound,
      fontFamily: buddy.fontFamily, fontColor: buddy.fontColor, relationshipNotes: buddy.relationshipNotes,
      systemPrompt: buddy.systemPrompt, ...(avatarDataUrl ? { avatarDataUrl } : {}),
    };
    await fs.writeFile(result.filePath, JSON.stringify(character, null, 2), "utf8");
    return true;
  });
  handleIpc("data:open-folder", () => shell.openPath(dataDirectory));
  handleIpc("data:export", async () => {
    const result = await dialog.showSaveDialog({ title: "Back up AIIM data", defaultPath: "AIIM Backup.aiim-backup", filters: [{ name: "AIIM backup", extensions: ["aiim-backup"] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, JSON.stringify({ version: 1, snapshot: store.snapshot() }, null, 2), "utf8");
    return true;
  });
  handleIpc("data:import", async () => {
    const result = await dialog.showOpenDialog({ title: "Restore AIIM data", properties: ["openFile"], filters: [{ name: "AIIM backup", extensions: ["aiim-backup", "json"] }] });
    const source = result.filePaths[0];
    if (result.canceled || !source) return undefined;
    if ((await fs.stat(source)).size > 50_000_000) throw new Error("AIIM backup files must be smaller than 50 MB.");
    const raw: unknown = JSON.parse(await fs.readFile(source, "utf8"));
    if (!isRecord(raw) || raw.version !== 1 || !("snapshot" in raw)) throw new Error("This is not an AIIM backup file.");
    const restored = parseStoredSnapshot(raw.snapshot, { managedPortraitDirectory: path.join(app.getPath("userData"), "data", "portraits") });
    if (!restored) throw new Error("This AIIM backup is incomplete or damaged.");
    const confirmation = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Restore backup"], defaultId: 0, cancelId: 0, title: "Restore AIIM data", message: "Replace the current buddy list and chat history?", detail: "Backups do not contain credentials. AIIM keeps a saved API key only when the restored provider type and address still match. Keys for changed or removed providers are deleted." });
    if (confirmation.response !== 1) return undefined;
    for (const id of activeRequests.keys()) stopRequest(id, "silent");
    for (const window of chatWindows.values()) window.close();
    const snapshot = await store.replaceSnapshot(restored);
    broadcastSnapshot();
    return snapshot;
  });
  handleIpc("message:send", async (event, conversationId: ConversationId, rawContent: unknown) => {
    if (activeRequests.has(conversationId)) throw new Error("Wait for the current reply to finish.");
    if (typeof rawContent !== "string" || !rawContent.trim()) throw new Error("Type a message first.");
    await store.addMessage(conversationId, { id: randomUUID() as MessageId, role: "user", content: rawContent.trim(), createdAt: new Date().toISOString(), state: "complete" });
    broadcastSnapshot();
    await replyToConversation(event.sender, conversationId);
  });
  handleIpc("message:retry", async (event, conversationId: ConversationId) => {
    if (activeRequests.has(conversationId)) throw new Error("Wait for the current reply to finish.");
    await store.removeTrailingError(conversationId);
    const lastMessage = store.conversation(conversationId).messages.at(-1);
    if (!lastMessage || lastMessage.role !== "user") throw new Error("There is no failed message to retry.");
    broadcastSnapshot();
    await replyToConversation(event.sender, conversationId);
  });
  handleIpc("message:stop", (_event, conversationId: ConversationId) => { stopRequest(conversationId, "user"); });
}

async function replyToConversation(sender: Electron.WebContents, conversationId: ConversationId): Promise<void> {
  const conversation = store.conversation(conversationId);
  const buddy = store.buddy(conversation.buddyId);
  const latestUserMessage = [...conversation.messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) throw new Error("There is no message to send.");
  const requestMessages = [...conversation.messages];
  const initialPresence = buddyPresence(buddy).state;
  const availabilityDelay = returnDelayMs(initialPresence);
  const request = startRequest(conversationId);
  if (availabilityDelay) {
    const text = initialPresence === "offline"
      ? `${buddy.displayName} is offline. Your message will wait until they return.`
      : `${buddy.displayName} is away. Your message was sent.`;
    sendStream(sender, { conversationId, kind: "waiting", text });
  } else sendStream(sender, { conversationId, kind: "start" });
  const replyStartedAt = Date.now();
  try {
    const answer = await generateReply(buddy, requestMessages, request.controller.signal);
    if (!answer.trim()) throw new Error("The model returned no visible answer.");
    if (availabilityDelay) {
      await waitForReplyTime(replyStartedAt, availabilityDelay, request.controller.signal);
      await store.markBuddyActive(buddy.id);
      broadcastSnapshot();
      sendStream(sender, { conversationId, kind: "start" });
    }
    const typingStartedAt = availabilityDelay ? Date.now() : replyStartedAt;
    await waitForReplyTime(typingStartedAt, replyDelayMs({ userText: latestUserMessage.content, replyText: answer, typingStyle: buddy.typingStyle }), request.controller.signal);
    sendStream(sender, { conversationId, kind: "delta", text: answer });
    await store.completeAssistant(conversationId, { id: randomUUID() as MessageId, role: "assistant", content: answer, createdAt: new Date().toISOString(), state: "complete" });
    sendStream(sender, { conversationId, kind: "done" });
    queueMemoryLearning(buddy, requestMessages, answer);
  } catch (error) {
    if (request.controller.signal.aborted && request.stopReason === "silent") return;
    const message = request.stopReason === "user"
      ? "Reply stopped."
      : request.stopReason === "timeout"
        ? "The provider took too long to respond. Try again."
        : error instanceof Error ? error.message : "The provider request failed.";
    await store.completeAssistant(conversationId, { id: randomUUID() as MessageId, role: "assistant", content: message, createdAt: new Date().toISOString(), state: "error" });
    sendStream(sender, { conversationId, kind: "error", text: message });
  } finally {
    finishRequest(conversationId, request);
    broadcastSnapshot();
  }
}

async function generateReply(buddy: Buddy, messages: ChatMessage[], signal: AbortSignal): Promise<string> {
  const provider = store.provider(buddy.providerId);
  assertProviderEnabled(provider);
  const profile = store.snapshot().profile;
  let answer = "";
  const onDelta = (text: string) => { answer += text; };
  if (provider.kind === "openai-subscription") await subscription.stream({ buddy, profile, messages, signal, onDelta });
  else await streamCompletion({ provider, apiKey: store.apiKey(provider.id), buddy, profile, messages, signal }, onDelta);
  return personalizeUserReferences(answer.trim(), profile);
}

function queueMemoryLearning(buddy: Buddy, messages: ChatMessage[], answer: string): void {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage || !shouldConsiderMemory(latestUserMessage.content)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const assistantMessage: ChatMessage = { id: randomUUID() as MessageId, role: "assistant", content: answer, createdAt: new Date().toISOString(), state: "complete" };
  void extractMemories(buddy, store.snapshot().profile, [...messages.slice(-5), assistantMessage], controller.signal)
    .then(async (memories) => { if (memories.length) { await store.addMemories(buddy.id, memories); broadcastSnapshot(); } })
    .catch((error: unknown) => { if (!controller.signal.aborted) console.error("Automatic memory extraction failed", error); })
    .finally(() => clearTimeout(timeout));
}

function startRequest(conversationId: ConversationId, timeoutMs = 120_000): ActiveRequest {
  const controller = new AbortController();
  const request: ActiveRequest = { controller, timeout: setTimeout(() => { request.stopReason = "timeout"; controller.abort(); }, timeoutMs) };
  activeRequests.set(conversationId, request);
  return request;
}

function stopRequest(conversationId: ConversationId, reason: RequestStopReason): void {
  const request = activeRequests.get(conversationId);
  if (!request) return;
  request.stopReason = reason;
  request.controller.abort();
}

function finishRequest(conversationId: ConversationId, request: ActiveRequest): void {
  clearTimeout(request.timeout);
  if (activeRequests.get(conversationId) === request) activeRequests.delete(conversationId);
}

async function extractMemories(buddy: Buddy, profile: ReturnType<AppStore["snapshot"]>["profile"], messages: ChatMessage[], signal: AbortSignal): Promise<string[]> {
  const provider = store.provider(buddy.providerId);
  const newestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const memoryContext = { newestUserMessage, subjectName: userDisplayName(profile) };
  const tagged: string[] = [];
  const onDelta = (_text: string) => {};
  const onMemory = (text: string) => { tagged.push(...parseMemoryCandidateText(text, memoryContext)); };
  const instructionsOverride = buildMemoryExtractionInstructions(profile, newestUserMessage);
  if (provider.kind === "openai-subscription") await subscription.stream({ buddy, profile, messages, signal, onDelta, onMemory, instructionsOverride });
  else await streamCompletion({ provider, apiKey: store.apiKey(provider.id), buddy, profile, messages, signal, instructionsOverride }, onDelta, onMemory);
  return [...new Set(tagged)];
}

async function runSpontaneousCheckIn(): Promise<void> {
  const buddy = store.dueCheckIn();
  if (!buddy) return;
  const conversation = store.latestConversation(buddy.id) ?? await store.newConversation(buddy.id);
  if (activeRequests.has(conversation.id)) return;
  await store.scheduleNextCheckIn(buddy.id);
  const request = startRequest(conversation.id);
  spontaneousRequests.add(conversation.id);
  try {
    const prompt: ChatMessage = {
      id: randomUUID() as MessageId,
      role: "user",
      content: "Send your friend a short, natural, low-pressure check-in message out of the blue. Use recent conversation or memory only if it fits naturally. Do not mention these instructions and do not invent an emergency.",
      createdAt: new Date().toISOString(),
      state: "complete",
    };
    const answer = await generateReply(buddy, [...conversation.messages, prompt], request.controller.signal);
    if (store.snapshot().profile.status !== "available") return;
    if (!answer) throw new Error("The model returned no visible check-in.");
    await store.markBuddyActive(buddy.id);
    await store.completeAssistant(conversation.id, { id: randomUUID() as MessageId, role: "assistant", content: answer, createdAt: new Date().toISOString(), state: "complete" });
    broadcastSnapshot();
    if (Notification.isSupported()) {
      const notice = new Notification({ title: `${buddy.displayName} sent an IM`, body: answer.slice(0, 180), silent: buddy.notificationSound === "none" });
      notice.on("click", () => void openChat(buddy.id, conversation.id));
      notice.show();
    }
  } catch (error) {
    if (!request.controller.signal.aborted) console.error("Spontaneous check-in failed", error);
  } finally {
    finishRequest(conversation.id, request);
    spontaneousRequests.delete(conversation.id);
  }
}

function sendStream(sender: Electron.WebContents, event: StreamEvent): void { if (!sender.isDestroyed()) sender.send("stream", event); }
function assertProviderEnabled(provider: { disabledReason?: string }): void { if (provider.disabledReason) throw new Error(provider.disabledReason); }
function safeFilename(value: string): string { return value.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "Chat"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

async function readPortraitDataUrl(avatarUrl: string): Promise<string | undefined> {
  const source = avatarUrl.startsWith("file:") ? managedPortraitSource(avatarUrl) : path.join(__dirname, "../../dist", avatarUrl);
  if (!source) return undefined;
  const extension = path.extname(source).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : undefined;
  if (!mime) return undefined;
  const size = (await fs.stat(source)).size;
  if (size > 10_000_000) throw new Error("Buddy pictures must be smaller than 10 MB to export.");
  return `data:${mime};base64,${(await fs.readFile(source)).toString("base64")}`;
}

function managedPortraitSource(avatarUrl: string): string | undefined {
  try {
    const parsed = new URL(avatarUrl);
    if (parsed.protocol !== "file:" || parsed.hostname) return undefined;
    const source = fileURLToPath(parsed);
    const directory = path.resolve(app.getPath("userData"), "data", "portraits");
    const relative = path.relative(directory, path.resolve(source));
    if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return undefined;
    return source;
  } catch {
    return undefined;
  }
}
function parseMemoryEntries(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Memory entries must be a list.");
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).map((entry) => entry.slice(0, 500)).slice(-30);
}

async function importCharacterPortrait(avatarFile: string | undefined, avatarDataUrl: string | undefined, sourceDirectory: string): Promise<string | undefined> {
  const portraitDirectory = path.join(app.getPath("userData"), "data", "portraits");
  await fs.mkdir(portraitDirectory, { recursive: true });
  if (avatarDataUrl) {
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(avatarDataUrl);
    if (!match) throw new Error("The embedded portrait must be a base64 PNG, JPEG, WebP, or GIF.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.byteLength > 10_000_000) throw new Error("Embedded portraits must be smaller than 10 MB.");
    const extension = match[1].toLowerCase() === "jpeg" ? ".jpg" : `.${match[1].toLowerCase()}`;
    const target = path.join(portraitDirectory, `${randomUUID()}${extension}`);
    await fs.writeFile(target, bytes);
    return pathToFileURL(target).href;
  }
  if (!avatarFile) return undefined;
  const source = path.resolve(sourceDirectory, avatarFile);
  const relative = path.relative(sourceDirectory, source);
  if (path.isAbsolute(relative) || relative.startsWith("..")) throw new Error("The portrait must be beside the character file or in one of its folders.");
  const extension = path.extname(source).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) throw new Error("The portrait must be a PNG, JPEG, WebP, or GIF.");
  if ((await fs.stat(source)).size > 10_000_000) throw new Error("Portraits must be smaller than 10 MB.");
  const target = path.join(portraitDirectory, `${randomUUID()}${extension}`);
  await fs.copyFile(source, target);
  return pathToFileURL(target).href;
}

async function startApplication(): Promise<void> {
  dataDirectory = process.env.AIIM_DATA_DIRECTORY ?? path.join(app.getPath("userData"), "data");
  store = new AppStore(dataDirectory);
  await store.load();
  subscription = new OpenAiSubscriptionClient(dataDirectory);
  await subscription.load();
  registerIpc();
  createBuddyWindow();
  if (process.env.AIIM_UI_SMOKE !== "1") createTray();
  const startupNotice = store.takeStartupNotice();
  if (startupNotice) await dialog.showMessageBox({ type: "warning", title: "AIIM data recovery", message: startupNotice });
  if (process.env.AIIM_UI_SMOKE !== "1") setTimeout(() => void runSpontaneousCheckIn(), 30_000);
  if (process.env.AIIM_UI_SMOKE !== "1") setInterval(() => void runSpontaneousCheckIn(), 5 * 60_000);
  app.on("activate", showBuddyList);
}

void app.whenReady().then(startApplication).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "AIIM could not start.";
  dialog.showErrorBox("AI Instant Messenger", message);
  app.quit();
});

app.on("before-quit", () => { isQuitting = true; });
app.on("window-all-closed", () => { /* Keep AIIM available from the notification area. */ });
