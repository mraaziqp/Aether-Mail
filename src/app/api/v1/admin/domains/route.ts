import { db } from '../../../../../db/index.ts';
import { domains, type NewDomain } from '../../../../../db/schema.ts';
import { generateDkimKeyPair, buildDomainDnsRecords } from '../../../../../lib/dkim.ts';
import { provisionStalwartDomain } from '../../../../../lib/stalwart.ts';
import { eq, desc } from 'drizzle-orm';

export interface RegisterDomainRequest {
  domain_name: string;
}

export interface RegisterDomainResponse {
  success: boolean;
  domain: {
    id: string;
    domain_name: string;
    is_verified: boolean;
    created_at: string;
    dns_records: Array<{
      type: 'MX' | 'TXT';
      host: string;
      value: string;
      priority?: number;
      description: string;
    }>;
  };
  instructions: string;
}

/**
 * POST /api/v1/admin/domains
 * Provisions a new business domain, generates 2048-bit DKIM keys,
 * registers with Stalwart Mail Server, and returns required DNS records.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body: RegisterDomainRequest = await request.json();

    if (!body.domain_name || typeof body.domain_name !== 'string') {
      return Response.json(
        { success: false, error: 'A valid domain_name string is required (e.g. "acme-corp.com").' },
        { status: 400 }
      );
    }

    const normalizedDomain = body.domain_name.trim().toLowerCase();

    // Check if domain is already registered
    const existing = await db
      .select()
      .from(domains)
      .where(eq(domains.domain_name, normalizedDomain))
      .limit(1);

    if (existing.length > 0) {
      const existingDomain = existing[0];
      const dnsConfig = buildDomainDnsRecords(existingDomain.domain_name, existingDomain.dkim_public_key);

      return Response.json({
        success: true,
        message: 'Domain already registered. Retrieved existing DNS configuration.',
        domain: {
          id: existingDomain.id,
          domain_name: existingDomain.domain_name,
          is_verified: existingDomain.is_verified,
          created_at: existingDomain.created_at?.toISOString() || new Date().toISOString(),
          dns_records: dnsConfig.records,
        },
        instructions: 'Add these records to your domain registrar DNS settings to complete verification.',
      });
    }

    // 1. Generate cryptographic RSA 2048-bit DKIM keypair
    const dkim = generateDkimKeyPair();

    // 2. Build full DNS bundle (MX, SPF, DKIM, DMARC)
    const dnsConfig = buildDomainDnsRecords(normalizedDomain, dkim.dnsTxtValue);

    // 3. Write domain record into Neon/PostgreSQL via Drizzle
    const domainId = `dom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newDomainRecord: NewDomain = {
      id: domainId,
      domain_name: normalizedDomain,
      is_verified: false,
      dkim_private_key: dkim.privateKey,
      dkim_public_key: dkim.dnsTxtValue,
      dns_mx_record: dnsConfig.mxRecord,
      dns_spf_record: dnsConfig.spfRecord,
      created_at: new Date(),
    };

    const [inserted] = await db.insert(domains).values(newDomainRecord).returning();

    // 4. Register domain with Stalwart Mail Server REST API
    await provisionStalwartDomain(normalizedDomain);

    return Response.json(
      {
        success: true,
        domain: {
          id: inserted.id,
          domain_name: inserted.domain_name,
          is_verified: inserted.is_verified,
          created_at: inserted.created_at ? inserted.created_at.toISOString() : new Date().toISOString(),
          dns_records: dnsConfig.records,
        },
        instructions: 'Configure these DNS records with your registrar. Once DNS propagates, mailboxes can be activated.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Domain provisioning error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal domain provisioning failure',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/admin/domains
 * Lists all registered domains and their current verification status
 */
export async function GET(): Promise<Response> {
  try {
    const allDomains = await db.select().from(domains).orderBy(desc(domains.created_at));

    const enriched = allDomains.map((d) => {
      const dnsConfig = buildDomainDnsRecords(d.domain_name, d.dkim_public_key);
      return {
        id: d.id,
        domain_name: d.domain_name,
        is_verified: d.is_verified,
        created_at: d.created_at ? d.created_at.toISOString() : null,
        dns_records: dnsConfig.records,
      };
    });

    return Response.json({
      success: true,
      count: enriched.length,
      domains: enriched,
    });
  } catch (error) {
    console.error('List domains error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list domains',
      },
      { status: 500 }
    );
  }
}
