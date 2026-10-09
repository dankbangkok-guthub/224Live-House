import { readFile } from 'node:fs/promises';
import { database, transaction } from '../src/database';
const {pool}=database(process.env.DATABASE_URL??'');
try{
  await transaction(pool,async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('224:migrations',0))");
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const name='001_engine';
    if(!(await db.query('SELECT name FROM schema_migrations WHERE name=$1',[name])).rows.length){
      await db.query(await readFile(new URL('../db/001_engine.sql',import.meta.url),'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
    }
  });
  console.log('Database migrations applied.');
}finally{await pool.end();}
