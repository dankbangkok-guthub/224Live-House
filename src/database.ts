import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DomainError } from './domain';
export function database(url: string) {
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = new Pool({connectionString:url,max:8});
  return {pool,orm:drizzle(pool)};
}
export async function transaction<T>(pool: Pool, work: (db: PoolClient)=>Promise<T>): Promise<T> {
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const result=await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    const code=(error as {code?: string}).code;
    if (code==='23P01') throw new DomainError('capacity_conflict');
    if (code==='40001' || code==='40P01') throw new DomainError('retry_transaction',503);
    throw error;
  } finally { db.release(); }
}
