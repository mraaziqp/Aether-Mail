export type EmailCategory = 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial' | 'spam';

export interface Account {
  id: string;
  provider: 'google' | 'outlook' | 'custom' | string;
  email_address: string;
  display_name?: string | null;
  sync_status: 'synced' | 'syncing' | 'error' | string;
  created_at?: string;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  settings?: { imap_host: string | null; imap_port: number | null; smtp_host: string | null; has_password: boolean };
  /** From /api/status */
  total?: number;
  unread?: number;
  latest?: string | null;
}

export interface EmailItem {
  id: string;
  account_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  body_snippet: string;
  /** Only present once the message has been opened (fetched per message). */
  full_body?: string;
  category: EmailCategory;
  ai_summary: string;
  requires_alert: boolean;
  is_read: boolean;
  received_at: string;
  account_email?: string;
  recipients?: string | null;
  direction?: 'inbound' | 'outbound' | string;
  folder?: string | null;
  has_attachments?: boolean;
  message_id?: string | null;
  /** Outbound only: 'sent' | 'delivery_delayed' | 'delivered' | 'bounced' | 'complained' | 'failed'. */
  delivery_status?: DeliveryStatus | null;
  delivery_detail?: string | null;
  delivery_updated_at?: string | null;
  transport?: string | null;
}

export type DeliveryStatus = 'sent' | 'delivery_delayed' | 'delivered' | 'bounced' | 'complained' | 'failed';

export interface DeliveryInfo {
  id: string;
  status: DeliveryStatus | null;
  detail: string | null;
  updatedAt: string | null;
  transport: string | null;
  trackable: boolean;
}

export interface RecipientCheck {
  address: string;
  verdict: 'ok' | 'invalid' | 'no-domain' | 'no-mail' | 'unverified';
  reason?: string;
  warning?: string;
  suggestion?: string;
}

export interface SendResult {
  success: boolean;
  provider?: string;
  emailId?: string;
  deliveryStatus?: DeliveryStatus;
  trackable?: boolean;
  error?: string;
  recipientChecks?: RecipientCheck[];
  attempts?: Array<{ provider: string; error: string }>;
}

export interface Capabilities {
  resend: boolean;
  resendInbound: boolean;
  smtpRelay: boolean;
  gmailRelay: boolean;
  ai: boolean;
  push: boolean;
  credentialVault: boolean;
  backgroundSync: boolean;
  serverless: boolean;
  defaultSender: string | null;
  /** Largest request the server accepts; attachments must fit inside it. */
  maxBodyBytes?: number;
}

export interface StatusPayload {
  serverTime: string;
  latestEmailId: string | null;
  latestEmailAt: string | null;
  alertCount: number;
  categories: Array<{ category: string; unread: number; total: number }>;
  accounts: Account[];
  capabilities: Capabilities;
}

export interface SessionUser {
  username: string;
  displayName: string;
  role: string;
  primaryEmail: string;
  domain: string;
}

export interface WebhookEmailPayload {
  id?: string;
  account_id: string;
  thread_id?: string;
  subject: string;
  sender: string;
  body_snippet?: string;
  full_body: string;
  received_at?: string;
}

export interface GeminiExtractionResult {
  category: EmailCategory;
  summary: string;
  requires_alert: boolean;
}

export interface SmartReplyRequest {
  emailId: string;
  instructions?: string;
  tone?: 'professional' | 'concise' | 'friendly' | 'firm';
}

export interface SmartReplyResponse {
  reply: string;
  bulletPoints?: string[];
  actionRequired?: boolean;
}

export interface ParsedSearchIntent {
  category: EmailCategory | null;
  requires_alert: boolean | null;
  keywords: string[];
  sender: string | null;
  days_ago: number | null;
  intent_explanation: string;
}

export type BatchActionType = 'mark_read' | 'mark_unread' | 'delete';

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string | null;
}

export interface GeneratedKeyPayload extends ApiKeyInfo {
  rawKey: string;
}

export interface SystemMetrics {
  totalEmails: number;
  unreadCount: number;
  alertCount: number;
  categoryDistribution: Record<string, number>;
  activeKeysCount: number;
  syncStatus: string;
  lastUpdated: string;
}

export interface ContactItem {
  email: string;
  name: string | null;
  count: number;
  isAccount?: boolean;
}
