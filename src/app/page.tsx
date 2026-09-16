/**
 * Next.js App Router Primary Page
 * Path: /src/app/page.tsx
 *
 * Unified AI Email Client Dashboard
 * Features:
 * - Multi-account sidebar with sync status
 * - Smart category filtering (urgent, personal, newsletter, automated, work, financial)
 * - Feed augmented with Gemini 1-sentence summaries and alert status
 * - Detail view with pinned AI summary & Smart Reply Server Action
 */

import React from 'react';
import App from '../App.tsx';

export const metadata = {
  title: 'AetherMail - AI Unified Email Client',
  description: 'AI-first email inbox powered by Gemini 2.5 Flash and PostgreSQL',
};

export default function NextJsPage() {
  return <App />;
}
