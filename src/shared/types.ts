export type ProviderId = string & { readonly __brand: "ProviderId" };
export type BuddyId = string & { readonly __brand: "BuddyId" };
export type ConversationId = string & { readonly __brand: "ConversationId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type MemoryId = string & { readonly __brand: "MemoryId" };
export type McpConnectionId = string & { readonly __brand: "McpConnectionId" };

export type ProviderKind = "openai" | "openai-subscription" | "anthropic" | "google" | "minimax" | "ollama" | "openrouter" | "openai-compatible";
export type PresencePattern = "always" | "daytime" | "evening" | "varied";
export type BuddySound = "classic" | "soft" | "digital" | "none";
export type BuddyFont = "Tahoma" | "Verdana" | "Arial" | "Georgia" | "Courier New";
export type CheckInFrequency = "off" | "rare" | "occasional";
export type MemoryMode = "off" | "normal" | "detailed";
export type ParticipationStyle = "quiet" | "normal" | "eager";
export type ProfileStatus = "available" | "away";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type CapabilityDecision = "deny" | "once" | "always";

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
  world: string;
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
  chatTopics: string[];
  participationStyle: ParticipationStyle;
  memories: BuddyMemory[];
  memoryMode: MemoryMode;
  memoryStatus: MemoryStatus;
  checkInFrequency: CheckInFrequency;
  nextCheckInAt?: string;
  activeUntil?: string;
}

export interface BuddyMemory {
  id: MemoryId;
  text: string;
  createdAt: string;
  pinned: boolean;
}

export interface MemoryStatus {
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
  lastError?: string;
  lastCheckedUserMessageCount: number;
}

export interface BuddyMemoryInput { id?: MemoryId; text: string; pinned: boolean; }

export interface ChatMessage {
  id: MessageId;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  state: "complete" | "streaming" | "error";
  buddyId?: BuddyId;
  replyToMessageId?: MessageId;
}

interface ConversationBase {
  id: ConversationId;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  summary?: ConversationSummary;
}

export interface DirectConversation extends ConversationBase { kind: "direct"; buddyId: BuddyId; }
export interface BuddyChatConversation extends ConversationBase { kind: "buddy-chat"; participantIds: BuddyId[]; }
export type Conversation = DirectConversation | BuddyChatConversation;

export interface ConversationSummary { content: string; throughMessageId: MessageId; updatedAt: string; }

export interface AppSnapshot {
  providers: ProviderConfig[];
  buddies: Buddy[];
  conversations: Conversation[];
  profile: UserProfile;
  mcpConnections: McpConnection[];
  buddyToolGrants: BuddyToolGrant[];
  capabilityActivity: CapabilityActivity[];
}

export type McpTransportKind = "streamable-http" | "stdio";
export type McpConnectionState = "disabled" | "ready" | "unavailable" | "needs-review";

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  fingerprint: string;
}

export interface McpConnection {
  id: McpConnectionId;
  name: string;
  transport: McpTransportKind;
  endpoint?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  hasBearerToken: boolean;
  state: McpConnectionState;
  lastError?: string;
  tools: McpToolDefinition[];
  updatedAt: string;
}

export interface McpConnectionInput {
  id?: McpConnectionId;
  name: string;
  transport: McpTransportKind;
  endpoint?: string;
  command?: string;
  args?: string[];
  bearerToken?: string;
}

export interface BuddyToolGrant {
  buddyId: BuddyId;
  connectionId: McpConnectionId;
  toolName: string;
  reviewedFingerprint: string;
  grantedAt: string;
  executionMode: "ask" | "trusted";
}

export interface CapabilityActivity {
  id: string;
  createdAt: string;
  buddyId: BuddyId;
  connectionId: McpConnectionId;
  toolName: string;
  decision: "allowed" | "denied" | "failed" | "completed";
}

export interface UserProfile {
  screenName: string;
  displayName: string;
  pronouns: string;
  location: string;
  interests: string;
  aboutMe: string;
  status: ProfileStatus;
  showMemoryUpdates: boolean;
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
  chatTopics: string[];
  participationStyle: ParticipationStyle;
  systemPrompt: string;
  world: string;
}

export interface BuddyInput {
  id?: BuddyId;
  screenName: string;
  displayName: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  systemPrompt: string;
  world: string;
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
  chatTopics: string[];
  participationStyle: ParticipationStyle;
  checkInFrequency: CheckInFrequency;
}

export interface StreamEvent {
  conversationId: ConversationId;
  kind: "waiting" | "start" | "delta" | "done" | "error" | "memory-updated" | "capability-request";
  text?: string;
  buddyId?: BuddyId;
  capabilityRequest?: CapabilityRequest;
}

export interface CapabilityRequest {
  id: string;
  buddyName: string;
  serviceName: string;
  actionName: string;
  argumentsText: string;
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
  openConversation(conversationId: ConversationId): Promise<void>;
  showBuddyList(): Promise<void>;
  openSettings(): Promise<void>;
  sendMessage(conversationId: ConversationId, content: string): Promise<void>;
  retryMessage(conversationId: ConversationId, failedMessageId?: MessageId): Promise<void>;
  stopMessage(conversationId: ConversationId): Promise<void>;
  newConversation(buddyId: BuddyId): Promise<Conversation>;
  newBuddyChat(participantIds: BuddyId[]): Promise<Conversation>;
  addBuddyToChat(conversationId: ConversationId, buddyId: BuddyId): Promise<AppSnapshot>;
  deleteConversation(id: ConversationId): Promise<AppSnapshot>;
  clearConversation(id: ConversationId): Promise<AppSnapshot>;
  subscriptionStatus(): Promise<SubscriptionStatus>;
  connectSubscription(): Promise<SubscriptionStatus>;
  disconnectSubscription(): Promise<SubscriptionStatus>;
  choosePortrait(): Promise<string | undefined>;
  exportConversation(id?: ConversationId): Promise<boolean>;
  clearAllHistory(): Promise<AppSnapshot>;
  saveBuddyMemories(id: BuddyId, memoryMode: MemoryMode, memories: BuddyMemoryInput[]): Promise<AppSnapshot>;
  listModels(id: ProviderId, refresh?: boolean): Promise<ModelOption[]>;
  testProvider(id: ProviderId): Promise<string>;
  setProfileStatus(status: ProfileStatus): Promise<AppSnapshot>;
  importCharacter(): Promise<CharacterTemplateData | undefined>;
  exportBuddy(id: BuddyId): Promise<boolean>;
  saveProfile(profile: UserProfileInput): Promise<AppSnapshot>;
  saveMcpConnection(input: McpConnectionInput): Promise<AppSnapshot>;
  removeMcpConnection(id: McpConnectionId): Promise<AppSnapshot>;
  testMcpConnection(id: McpConnectionId): Promise<AppSnapshot>;
  setMcpConnectionEnabled(id: McpConnectionId, enabled: boolean): Promise<AppSnapshot>;
  saveBuddyToolGrant(buddyId: BuddyId, connectionId: McpConnectionId, toolName: string, granted: boolean): Promise<AppSnapshot>;
  clearCapabilityActivity(): Promise<AppSnapshot>;
  respondToCapabilityRequest(id: string, decision: CapabilityDecision): Promise<void>;
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
