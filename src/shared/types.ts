export type ProviderId = string & { readonly __brand: "ProviderId" };
export type BuddyId = string & { readonly __brand: "BuddyId" };
export type ConversationId = string & { readonly __brand: "ConversationId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type MemoryId = string & { readonly __brand: "MemoryId" };

export type ProviderKind = "openai" | "openai-subscription" | "anthropic" | "google" | "minimax" | "ollama" | "openrouter" | "openai-compatible";
export type PresencePattern = "always" | "daytime" | "evening" | "varied";
export type BuddySound = "classic" | "soft" | "digital" | "none";
export type BuddyFont = "Tahoma" | "Verdana" | "Arial" | "Georgia" | "Courier New";
export type CheckInFrequency = "off" | "rare" | "occasional";
export type ProfileStatus = "available" | "away";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderConfig {
  id: ProviderId;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  hasApiKey: boolean;
  disabledReason?: string;
}

export interface Buddy {
  id: BuddyId;
  screenName: string;
  displayName: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
  group: string;
  color: string;
  status: "available" | "away";
  statusMessage: string;
  awayMessage: string;
  typingStyle: "quick" | "measured" | "thoughtful";
  avatarUrl?: string;
  profileBio: string;
  profileLocation: string;
  profileInterests: string;
  profileQuote: string;
  presencePattern: PresencePattern;
  notificationSound: BuddySound;
  fontFamily: BuddyFont;
  fontColor: string;
  userRole: string;
  relationshipNotes: string;
  memories: BuddyMemory[];
  checkInFrequency: CheckInFrequency;
  nextCheckInAt?: string;
  activeUntil?: string;
}

export interface BuddyMemory {
  id: MemoryId;
  text: string;
  createdAt: string;
}

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  state: "complete" | "streaming" | "error";
}

export interface Conversation {
  id: ConversationId;
  buddyId: BuddyId;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface AppSnapshot {
  providers: ProviderConfig[];
  buddies: Buddy[];
  conversations: Conversation[];
  profile: UserProfile;
}

export interface UserProfile {
  screenName: string;
  displayName: string;
  pronouns: string;
  location: string;
  interests: string;
  aboutMe: string;
  status: ProfileStatus;
}

export type UserProfileInput = Omit<UserProfile, "status">;

export interface ProviderInput {
  id?: ProviderId;
  kind: ProviderKind;
  name: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ModelOption {
  id: string;
  name: string;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

export interface CharacterTemplateData {
  id: string;
  displayName: string;
  screenName: string;
  tagline: string;
  pack: string;
  group: string;
  userRole: string;
  color: string;
  statusMessage: string;
  awayMessage: string;
  typingStyle: "quick" | "measured" | "thoughtful";
  avatarUrl?: string;
  profileBio: string;
  profileLocation: string;
  profileInterests: string;
  profileQuote: string;
  presencePattern: PresencePattern;
  notificationSound: BuddySound;
  fontFamily: BuddyFont;
  fontColor: string;
  relationshipNotes: string;
  systemPrompt: string;
}

export interface BuddyInput {
  id?: BuddyId;
  screenName: string;
  displayName: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
  group: string;
  color: string;
  statusMessage: string;
  awayMessage: string;
  typingStyle: "quick" | "measured" | "thoughtful";
  avatarUrl?: string;
  profileBio: string;
  profileLocation: string;
  profileInterests: string;
  profileQuote: string;
  presencePattern: PresencePattern;
  notificationSound: BuddySound;
  fontFamily: BuddyFont;
  fontColor: string;
  userRole: string;
  relationshipNotes: string;
  checkInFrequency: CheckInFrequency;
}

export interface StreamEvent {
  conversationId: ConversationId;
  kind: "waiting" | "start" | "delta" | "done" | "error";
  text?: string;
}

export type SubscriptionStatus =
  | { kind: "unavailable"; message: string }
  | { kind: "signed-out" }
  | { kind: "signed-in"; email?: string; plan: string };

export interface DesktopApi {
  snapshot(): Promise<AppSnapshot>;
  quitApp(): Promise<void>;
  saveProvider(input: ProviderInput): Promise<AppSnapshot>;
  removeProvider(id: ProviderId): Promise<AppSnapshot>;
  saveBuddy(input: BuddyInput): Promise<AppSnapshot>;
  removeBuddy(id: BuddyId): Promise<AppSnapshot>;
  openChat(buddyId: BuddyId, conversationId?: ConversationId): Promise<void>;
  showBuddyList(): Promise<void>;
  openSettings(): Promise<void>;
  sendMessage(conversationId: ConversationId, content: string): Promise<void>;
  retryMessage(conversationId: ConversationId): Promise<void>;
  stopMessage(conversationId: ConversationId): Promise<void>;
  newConversation(buddyId: BuddyId): Promise<Conversation>;
  deleteConversation(id: ConversationId): Promise<AppSnapshot>;
  clearConversation(id: ConversationId): Promise<AppSnapshot>;
  subscriptionStatus(): Promise<SubscriptionStatus>;
  connectSubscription(): Promise<SubscriptionStatus>;
  choosePortrait(): Promise<string | undefined>;
  exportConversation(id?: ConversationId): Promise<boolean>;
  clearAllHistory(): Promise<AppSnapshot>;
  saveBuddyMemories(id: BuddyId, memories: string[]): Promise<AppSnapshot>;
  listModels(id: ProviderId, refresh?: boolean): Promise<ModelOption[]>;
  testProvider(id: ProviderId): Promise<string>;
  setProfileStatus(status: ProfileStatus): Promise<AppSnapshot>;
  importCharacter(): Promise<CharacterTemplateData | undefined>;
  exportBuddy(id: BuddyId): Promise<boolean>;
  saveProfile(profile: UserProfileInput): Promise<AppSnapshot>;
  openHelp(): Promise<void>;
  openDataFolder(): Promise<void>;
  exportDataBackup(): Promise<boolean>;
  importDataBackup(): Promise<AppSnapshot | undefined>;
  onStream(listener: (event: StreamEvent) => void): () => void;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}

declare global {
  interface Window { aiMessenger: DesktopApi; }
}
