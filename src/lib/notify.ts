/**
 * Phone push for mail that needs attention, via ntfy.
 *
 * There is deliberately no default topic. ntfy topics are public to anyone who
 * knows the name, and the old fallback ('aethermail-alerts') broadcast sender,
 * subject and summary of flagged business mail to a guessable channel. Set
 * NTFY_TOPIC to a long random string, or NTFY_URL + NTFY_TOKEN for a
 * protected topic, or leave it unset for no push.
 */
export async function pushAlert(input: { subject: string; sender: string; summary: string; account?: string }) {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return false;

  const server = (process.env.NTFY_URL?.trim() || 'https://ntfy.sh').replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.NTFY_TOKEN?.trim()) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN.trim()}`;

  try {
    const res = await fetch(server, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        topic,
        title: `AetherMail · ${input.subject.slice(0, 80)}`,
        message: `${input.account ? `To: ${input.account}\n` : ''}From: ${input.sender}\n\n${input.summary.slice(0, 280)}`,
        priority: 4,
        tags: ['envelope', 'warning'],
        ...(process.env.APP_URL ? { click: process.env.APP_URL } : {}),
      }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch (err) {
    console.warn('[ntfy] push failed:', (err as Error).message);
    return false;
  }
}
