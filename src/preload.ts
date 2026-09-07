import { contextBridge, ipcRenderer } from "electron";
import type { BuddyId, BuddyInput, ConversationId, DesktopApi, ProfileStatus, ProviderId, ProviderInput, StreamEvent, AppSnapshot, UserProfileInput } from "./shared/types";

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke("snapshot"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  saveProvider: (input: ProviderInput) => ipcRenderer.invoke("provider:save", input),
  removeProvider: (id: ProviderId) => ipcRenderer.invoke("provider:remove", id),
  saveBuddy: (input: BuddyInput) => ipcRenderer.invoke("buddy:save", input),
  removeBuddy: (id: BuddyId) => ipcRenderer.invoke("buddy:remove", id),
  openChat: (buddyId: BuddyId, conversationId?: ConversationId) => ipcRenderer.invoke("chat:open", buddyId, conversationId),
  showBuddyList: () => ipcRenderer.invoke("buddy-list:show"),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  sendMessage: (conversationId: ConversationId, content: string) => ipcRenderer.invoke("message:send", conversationId, content),
  retryMessage: (conversationId: ConversationId) => ipcRenderer.invoke("message:retry", conversationId),
  stopMessage: (conversationId: ConversationId) => ipcRenderer.invoke("message:stop", conversationId),
  newConversation: (buddyId: BuddyId) => ipcRenderer.invoke("conversation:new", buddyId),
  deleteConversation: (id: ConversationId) => ipcRenderer.invoke("conversation:delete", id),
  clearConversation: (id: ConversationId) => ipcRenderer.invoke("conversation:clear", id),
  subscriptionStatus: () => ipcRenderer.invoke("subscription:status"),
  connectSubscription: () => ipcRenderer.invoke("subscription:connect"),
  choosePortrait: () => ipcRenderer.invoke("portrait:choose"),
  exportConversation: (id?: ConversationId) => ipcRenderer.invoke("history:export", id),
  clearAllHistory: () => ipcRenderer.invoke("history:clear-all"),
  saveBuddyMemories: (id: BuddyId, memories: string[]) => ipcRenderer.invoke("buddy:memories", id, memories),
  listModels: (id: ProviderId, refresh?: boolean) => ipcRenderer.invoke("provider:models", id, refresh),
  testProvider: (id: ProviderId) => ipcRenderer.invoke("provider:test", id),
  setProfileStatus: (status: ProfileStatus) => ipcRenderer.invoke("profile:status", status),
  importCharacter: () => ipcRenderer.invoke("character:import"),
  exportBuddy: (id: BuddyId) => ipcRenderer.invoke("character:export", id),
  saveProfile: (profile: UserProfileInput) => ipcRenderer.invoke("profile:save", profile),
  openHelp: () => ipcRenderer.invoke("help:open"),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  exportDataBackup: () => ipcRenderer.invoke("data:export"),
  importDataBackup: () => ipcRenderer.invoke("data:import"),
  onStream: (listener: (event: StreamEvent) => void) => subscribe("stream", listener),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => subscribe("snapshot:changed", listener),
};

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("aiMessenger", api);
