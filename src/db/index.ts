import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
const { Pool } = pg;
import * as schema from './schema.ts';

declare global {
  // eslint-disable-next-line no-var
  var _postgresPool: pg.Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const rawUrl =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING;

    if (rawUrl) {
      let cleanUrl = rawUrl;
      try {
        const parsed = new URL(rawUrl);
        parsed.searchParams.delete('channel_binding');
        cleanUrl = parsed.toString();
      } catch {
        cleanUrl = rawUrl.replace(/[?&]channel_binding=[^&]*/g, '');
      }

      const isRemote =
        cleanUrl.includes('neon.tech') ||
        cleanUrl.includes('sslmode=require') ||
        cleanUrl.includes('supabase.co') ||
        process.env.NODE_ENV === 'production' ||
        !!process.env.VERCEL;

      global._postgresPool = new Pool({
        connectionString: cleanUrl,
        ssl: isRemote ? { rejectUnauthorized: false } : false,
        max: process.env.VERCEL ? 3 : 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
      });
    } else if (process.env.POSTGRES_HOST || process.env.PGHOST) {
      const host = process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost';
      const user = process.env.POSTGRES_USER || process.env.PGUSER || 'postgres';
      const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || '';
      const database = process.env.POSTGRES_DATABASE || process.env.PGDATABASE || 'postgres';
      const isRemote = host !== 'localhost' && host !== '127.0.0.1';

      global._postgresPool = new Pool({
        host,
        user,
        password,
        database,
        port: Number(process.env.PGPORT) || 5432,
        ssl: isRemote ? { rejectUnauthorized: false } : false,
        max: process.env.VERCEL ? 3 : 10,
        connectionTimeoutMillis: 10000,
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST || 'localhost',
        user: process.env.SQL_USER || 'postgres',
        password: process.env.SQL_PASSWORD || '',
        database: process.env.SQL_DB_NAME || 'postgres',
        port: Number(process.env.SQL_PORT) || 5432,
        max: 10,
        connectionTimeoutMillis: 15000,
        ssl: false,
      });
    }

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
