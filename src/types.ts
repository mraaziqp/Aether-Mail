export type EmailCategory = 'urgent' | 'personal' | 'newsletter' | 'automated' | 'work' | 'financial';

export interface Account {
  id: string;
  provider: 'google' | 'outlook' | 'custom' | string;
  email_address: string;
  oauth_tokens?: Record<string, unknown> | null;
  sync_status: 'synced' | 'syncing' | 'error' | string;
  created_at?: string;
}

export interface EmailItem {
  id: string;
  account_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  body_snippet: string;
  full_body: string;
  category: EmailCategory;
  ai_summary: string;
  requires_alert: boolean;
  is_read: boolean;
  received_at: string;
  account_email?: string;
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
