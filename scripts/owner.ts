import { database, transaction } from '../src/database';
import { randomUUID } from 'node:crypto';
const email=(process.env.OWNER_EMAIL??'').toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Set OWNER_EMAIL to the owner’s Access login email.');
const {pool}=database(process.env.DATABASE_URL??'');
try{await transaction(pool,async db=>{
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('224:accounts',0))");
 if((await db.query("SELECT email FROM admin_accounts WHERE role='owner'")).rows.length)throw Error('An owner already exists; manage accounts through the authenticated dashboard.');
 await db.query("INSERT INTO admin_accounts(email,role) VALUES($1,'owner')",[email]);
 await db.query("INSERT INTO audit_logs(id,actor,action,target,details) VALUES($1,'bootstrap','owner_created',$2,'{}')",[randomUUID(),email]);
});console.log('Owner account provisioned.');}finally{await pool.end();}
