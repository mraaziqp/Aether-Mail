import crypto from 'node:crypto';
import { db } from '../../../../../db/index.ts';
import { mailboxes, domains, accounts, type NewMailbox, type NewAccount } from '../../../../../db/schema.ts';
import { provisionStalwartMailbox } from '../../../../../lib/stalwart.ts';
import { eq, desc } from 'drizzle-orm';

export interface CreateMailboxRequest {
  domain_id?: string;
  domain_name?: string;
  email_address: string;
  password?: string;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * POST /api/v1/admin/mailboxes
 * Provisions a new virtual mailbox user in Stalwart Mail Server
 * and records it in Neon/PostgreSQL via Drizzle.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body: CreateMailboxRequest = await request.json();

    if (!body.email_address || !body.email_address.includes('@')) {
      return Response.json(
        { success: false, error: 'A valid email_address is required (e.g. "contact@company.com").' },
        { status: 400 }
      );
    }

    const email = body.email_address.trim().toLowerCase();
    const domainPart = email.split('@')[1];

    // Find the associated domain record
    let targetDomainId = body.domain_id;
    if (!targetDomainId) {
      const matchedDomain = await db
        .select()
        .from(domains)
        .where(eq(domains.domain_name, domainPart))
        .limit(1);

      if (matchedDomain.length === 0) {
        return Response.json(
          {
            success: false,
            error: `Domain "${domainPart}" is not registered in AetherMail. Register the domain first via /api/v1/admin/domains.`,
          },
          { status: 404 }
        );
      }
      targetDomainId = matchedDomain[0].id;
    }

    // Check if mailbox already exists
    const existingMbx = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email_address, email))
      .limit(1);

    if (existingMbx.length > 0) {
      return Response.json(
        { success: false, error: `Mailbox "${email}" already exists.` },
        { status: 409 }
      );
    }

    // Hash password or generate high-entropy default
    const plainPassword = body.password || crypto.randomBytes(12).toString('base64');
    const pwdHash = hashPassword(plainPassword);

    // 1. Provision user inside Stalwart Mail Server
    await provisionStalwartMailbox(email, pwdHash);

    // 2. Persist in Drizzle mailboxes table
    const mailboxId = `mbx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newMbx: NewMailbox = {
      id: mailboxId,
      domain_id: targetDomainId,
      email_address: email,
      password_hash: pwdHash,
      is_active: true,
      created_at: new Date(),
    };

    const [inserted] = await db.insert(mailboxes).values(newMbx).returning();

    // 3. Sync to unified accounts table so it appears in the AetherMail inbox view
    const newAcc: NewAccount = {
      id: mailboxId,
      provider: 'stalwart',
      email_address: email,
      sync_status: 'synced',
      created_at: new Date(),
    };

    await db.insert(accounts).values(newAcc).onConflictDoNothing();

    return Response.json(
      {
        success: true,
        message: `Mailbox ${email} provisioned and activated successfully.`,
        mailbox: {
          id: inserted.id,
          domain_id: inserted.domain_id,
          email_address: inserted.email_address,
          is_active: inserted.is_active,
          created_at: inserted.created_at ? inserted.created_at.toISOString() : new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Mailbox provisioning error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal mailbox provisioning failure',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/admin/mailboxes
 * Lists all virtual mailboxes across domains
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const domainId = url.searchParams.get('domain_id');

    let query = db
      .select({
        id: mailboxes.id,
        domain_id: mailboxes.domain_id,
        domain_name: domains.domain_name,
        email_address: mailboxes.email_address,
        is_active: mailboxes.is_active,
        created_at: mailboxes.created_at,
      })
      .from(mailboxes)
      .leftJoin(domains, eq(mailboxes.domain_id, domains.id))
      .orderBy(desc(mailboxes.created_at));

    const rows = domainId ? await query.where(eq(mailboxes.domain_id, domainId)) : await query;

    return Response.json({
      success: true,
      count: rows.length,
      mailboxes: rows.map((m) => ({
        ...m,
        created_at: m.created_at ? m.created_at.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error('List mailboxes error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list mailboxes',
      },
      { status: 500 }
    );
  }
}
