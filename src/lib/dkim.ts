import crypto from 'node:crypto';

export interface GeneratedDkimKeys {
  privateKey: string;
  publicKey: string;
  dnsTxtValue: string;
}

export interface DnsRecordRequirement {
  type: 'MX' | 'TXT';
  host: string;
  value: string;
  priority?: number;
  description: string;
}

export interface DomainDnsConfig {
  domainName: string;
  selector: string;
  mxRecord: string;
  spfRecord: string;
  dkimTxtValue: string;
  dkimHost: string;
  dmarcRecord: string;
  dmarcHost: string;
  records: DnsRecordRequirement[];
}

/**
 * Generates an RSA 2048-bit DKIM keypair and formats the DNS TXT record
 */
export function generateDkimKeyPair(): GeneratedDkimKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Strip PEM header, footer, and linebreaks to produce clean Base64 string for DNS p= tag
  const cleanBase64PublicKey = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');

  const dnsTxtValue = `v=DKIM1; k=rsa; p=${cleanBase64PublicKey}`;

  return {
    privateKey,
    publicKey,
    dnsTxtValue,
  };
}

/**
 * Builds the required DNS records (MX, SPF, DKIM, DMARC) for a registered domain
 */
export function buildDomainDnsRecords(domainName: string, dkimTxtValue: string): DomainDnsConfig {
  const normalizedDomain = domainName.trim().toLowerCase();
  const mailHost = process.env.MAIL_SERVER_HOST || `mail.${normalizedDomain}`;
  const selector = 'default';
  const mxRecord = `10 ${mailHost}`;
  const spfRecord = 'v=spf1 mx -all';
  const dkimHost = `${selector}._domainkey`;
  const dmarcHost = '_dmarc';
  const dmarcRecord = `v=DMARC1; p=quarantine; rua=mailto:postmaster@${normalizedDomain}`;

  const records: DnsRecordRequirement[] = [
    {
      type: 'MX',
      host: '@',
      value: mxRecord,
      priority: 10,
      description: 'Directs incoming email traffic to Stalwart Mail Server',
    },
    {
      type: 'TXT',
      host: '@',
      value: spfRecord,
      description: 'SPF policy permitting only designated MX server to dispatch mail',
    },
    {
      type: 'TXT',
      host: dkimHost,
      value: dkimTxtValue,
      description: 'Cryptographic DKIM public key for authenticating outbound signatures',
    },
    {
      type: 'TXT',
      host: dmarcHost,
      value: dmarcRecord,
      description: 'DMARC policy instructing recipient servers to quarantine spoofed emails',
    },
  ];

  return {
    domainName: normalizedDomain,
    selector,
    mxRecord,
    spfRecord,
    dkimTxtValue,
    dkimHost,
    dmarcRecord,
    dmarcHost,
    records,
  };
}
