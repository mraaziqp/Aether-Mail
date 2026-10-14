import { promises as dns } from 'node:dns';

/**
 * Pre-send recipient checks.
 *
 * A provider like Resend accepts mail for any syntactically valid address and
 * only finds out later that the domain does not exist — by then the console
 * has already said "Sent". That is how a payout notice to
 * info@verifiedbuzlink.co.zaz (meant: verifiedbizlink.co.za) bounced with
 * "550 5.4.4 Invalid domain" while looking delivered.
 *
 * So before anything is handed to a transport, each recipient domain must be
 * able to receive mail (MX, or an A/AAAA record as the RFC 5321 implicit MX),
 * and a domain that does not resolve but sits one or two keystrokes away from
 * a domain we have corresponded with is reported with the likely correction.
 */

export type RecipientVerdict = 'ok' | 'invalid' | 'no-domain' | 'no-mail' | 'unverified';

export interface RecipientCheck {
  address: string;
  verdict: RecipientVerdict;
  /** Human-readable reason when the verdict is not 'ok'. */
  reason?: string;
  /** Non-blocking concern about an address that can receive mail. */
  warning?: string;
  /** Likely intended address when the domain looks like a typo. */
  suggestion?: string;
}

// Local part: no leading/trailing/double dots. Domain: labels of letters,
// digits and hyphens, and an alphabetic TLD of 2–24 characters.
const ADDRESS_RE =
  /^(?!\.)(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}(?<!\.)@(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

export const isValidAddress = (addr: string) => ADDRESS_RE.test(addr.trim());

/** Domains people commonly mistype; contact domains are added at check time. */
const COMMON_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'zoho.com', 'mweb.co.za',
  'telkomsa.net', 'webmail.co.za', 'vodamail.co.za', 'afrihost.co.za',
];

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; verdict: RecipientVerdict; reason?: string }>();

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), ms))]);

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** Can this domain receive mail? Cached; a resolver failure never blocks a send. */
export async function domainAcceptsMail(domain: string): Promise<{ verdict: RecipientVerdict; reason?: string }> {
  const d = domain.toLowerCase();
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  let out: { verdict: RecipientVerdict; reason?: string };
  try {
    const mx = await withTimeout(dns.resolveMx(d), 5000);
    // RFC 7505 null MX ("0 .") is an explicit "this domain takes no mail".
    if (mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.')) {
      out = { verdict: 'no-mail', reason: `${d} publishes a null MX: it does not accept email.` };
    } else if (mx.length > 0) {
      out = { verdict: 'ok' };
    } else {
      out = await implicitMx(d);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOTFOUND') {
      out = { verdict: 'no-domain', reason: `The domain ${d} does not exist.` };
    } else if (NOT_FOUND.has(code)) {
      out = await implicitMx(d);
    } else {
      // SERVFAIL, timeouts, no network: say so, but let the provider decide.
      out = { verdict: 'unverified', reason: `Could not look up ${d} (${code || (err as Error).message}).` };
    }
  }

  if (out.verdict !== 'unverified') cache.set(d, { ...out, at: Date.now() });
  return out;
}

async function implicitMx(d: string): Promise<{ verdict: RecipientVerdict; reason?: string }> {
  const has = async (fn: () => Promise<string[]>) => {
    try {
      return (await withTimeout(fn(), 5000)).length > 0;
    } catch {
      return false;
    }
  };
  if ((await has(() => dns.resolve4(d))) || (await has(() => dns.resolve6(d)))) return { verdict: 'ok' };
  return { verdict: 'no-mail', reason: `${d} has no mail server (no MX or A record).` };
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Known domains within two edits of `domain`, closest first. */
export function suggestDomains(domain: string, known: Iterable<string>): string[] {
  const d = domain.toLowerCase();
  const out: Array<{ domain: string; dist: number }> = [];
  for (const k of new Set([...known, ...COMMON_DOMAINS])) {
    if (!k || k === d) continue;
    const dist = editDistance(d, k);
    if (dist <= 2) out.push({ domain: k, dist });
  }
  return out.sort((a, b) => a.dist - b.dist).map((x) => x.domain);
}

/** The closest candidate that can itself receive mail — a known domain may be a past typo. */
async function verifiedSuggestion(domain: string, known: Iterable<string>): Promise<string | null> {
  for (const candidate of suggestDomains(domain, known).slice(0, 3)) {
    if ((await domainAcceptsMail(candidate)).verdict === 'ok') return candidate;
  }
  return null;
}

/**
 * Checks every address. `knownDomains` should hold domains already seen in
 * mail (contacts), which is what makes "did you mean …" useful for business
 * domains no static list would know.
 */
export async function checkRecipients(addresses: string[], knownDomains: Iterable<string> = []): Promise<RecipientCheck[]> {
  const known = [...knownDomains];
  return Promise.all(
    addresses.map(async (raw): Promise<RecipientCheck> => {
      const address = raw.trim().toLowerCase();
      const at = address.lastIndexOf('@');
      const domain = at > 0 ? address.slice(at + 1) : '';
      const local = at > 0 ? address.slice(0, at) : address;
      const suggestion = async () => {
        const s = domain ? await verifiedSuggestion(domain, known) : null;
        return s ? `${local}@${s}` : undefined;
      };

      if (!isValidAddress(address)) {
        return { address, verdict: 'invalid', reason: `"${raw.trim()}" is not a valid email address.` };
      }
      const res = await domainAcceptsMail(domain);
      if (res.verdict === 'unverified') return { address, ...res };
      if (res.verdict === 'ok') {
        // gmial.com and friends resolve (often typo-squatters): warn, do not block.
        const near = COMMON_DOMAINS.find((c) => c.length >= 8 && c !== domain && editDistance(domain, c) === 1);
        return near
          ? { address, verdict: 'ok', warning: `${domain} looks like a typo of ${near}.`, suggestion: `${local}@${near}` }
          : { address, verdict: 'ok' };
      }
      return { address, ...res, suggestion: await suggestion() };
    })
  );
}

/** One line per blocking problem, with the suggested fix. */
export function describeProblems(checks: RecipientCheck[]): string | null {
  const bad = checks.filter((c) => c.verdict !== 'ok' && c.verdict !== 'unverified');
  if (!bad.length) return null;
  return bad.map((c) => `${c.reason}${c.suggestion ? ` Did you mean ${c.suggestion}?` : ''}`).join(' ');
}
