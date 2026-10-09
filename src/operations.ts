import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './database';
import { DomainError, validateSchedule, scheduleContains, type Schedule } from './domain';
import { requireRole, type Identity } from './auth';
async function audit(db:PoolClient,who:Identity,action:string,target:string,details:unknown={}){await db.query('INSERT INTO audit_logs(id,actor,action,target,details) VALUES($1,$2,$3,$4,$5)',[randomUUID(),who.email,action,target,details]);}
function uuid(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw new DomainError('invalid_id',400);}
function text(v:unknown,max=1000){if(typeof v!=='string'||v.length>max)throw new DomainError('invalid_text',400);return v.trim();}
export class Operations {
 constructor(private pool:Pool){}
 async notifications(who:Identity){requireRole(who,['owner','manager']);return (await this.pool.query(`SELECT o.id,b.code,o.kind,o.status,o.attempts,o.next_attempt_at,o.provider_message_id,o.delivery_status,o.delivery_event_at,o.last_error,o.created_at FROM outbox o JOIN bookings b ON b.id=o.booking_id ORDER BY o.created_at DESC LIMIT 300`)).rows;}
 async catalog(who:Identity){requireRole(who,['owner','manager']);return (await this.pool.query('SELECT * FROM services ORDER BY name')).rows;}
 async staff(who:Identity){requireRole(who,['owner','manager']);return (await this.pool.query(`SELECT u.*,p.name,p.kind FROM resource_units u JOIN resource_pools p ON p.id=u.pool_id WHERE p.kind!='space' ORDER BY p.name,u.id`)).rows;}
 async assignments(who:Identity){return (await this.pool.query(`SELECT a.id,a.unit_id,a.service_id,a.start_at,a.end_at,b.code,b.guests,b.customer->>'eventType' AS event_type,b.customer->>'notes' AS event_notes,
  s.name AS service_name,COALESCE(f.status,'assigned') AS fulfillment_status,COALESCE(f.notes,'') AS notes
  FROM allocations a JOIN bookings b ON b.id=a.booking_id JOIN resource_units u ON u.id=a.unit_id
  JOIN resource_pools p ON p.id=u.pool_id LEFT JOIN services s ON s.id=a.service_id LEFT JOIN fulfillment f ON f.allocation_id=a.id
  WHERE a.released_at IS NULL AND p.kind='concierge' AND ($1::text IS NULL OR a.unit_id=$1) ORDER BY a.start_at LIMIT 300`,[who.role==='staff'?who.unitId:null])).rows;}
 async updateUnit(input:{id:string;active:boolean;shifts?:Schedule},who:Identity){
  requireRole(who,['owner','manager']);if(typeof input.active!=='boolean')throw new DomainError('invalid_unit',400);if(input.shifts)validateSchedule(input.shifts);
  return transaction(this.pool,async db=>{
   const u=(await db.query(`SELECT u.*,p.kind FROM resource_units u JOIN resource_pools p ON p.id=u.pool_id WHERE u.id=$1 AND p.kind!='space'`,[input.id])).rows[0];if(!u)throw new DomainError('unit_not_found',404);
   if(u.kind==='concierge'&&!input.shifts)throw new DomainError('shift_required',400);
   await db.query('SELECT id FROM resource_pools WHERE id=$1 FOR UPDATE',[u.pool_id]);
   const occupied=(await db.query(`SELECT a.id,a.start_at,a.end_at,b.code FROM allocations a LEFT JOIN bookings b ON b.id=a.booking_id WHERE a.unit_id=$1 AND a.released_at IS NULL`,[u.id])).rows;
   const impacted=occupied.filter(a=>!input.active||(input.shifts&&!scheduleContains(input.shifts,new Date(a.start_at),new Date(a.end_at))));
   await db.query('UPDATE resource_units SET active=$1,shifts=$2 WHERE id=$3',[input.active,input.shifts??null,u.id]);
   await audit(db,who,'unit_updated',u.id,{active:input.active,shifts:input.shifts,reviewAllocationIds:impacted.map(a=>a.id)});
   return {reviewAssignments:impacted};
  });
 }
 async assign(input:{id:string;unitId:string},who:Identity){
  requireRole(who,['owner','manager']);uuid(input.id);return transaction(this.pool,async db=>{
   const initial=(await db.query('SELECT booking_id FROM allocations WHERE id=$1',[input.id])).rows[0];if(!initial?.booking_id)throw new DomainError('assignment_not_found',404);
   await db.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[initial.booking_id]);
   const a=(await db.query(`SELECT a.*,u.pool_id,p.kind FROM allocations a JOIN resource_units u ON u.id=a.unit_id JOIN resource_pools p ON p.id=u.pool_id WHERE a.id=$1 AND a.released_at IS NULL`,[input.id])).rows[0];
   if(!a||a.kind!=='concierge')throw new DomainError('assignment_not_found',404);
   await db.query('SELECT id FROM resource_pools WHERE id=$1 FOR UPDATE',[a.pool_id]);
   const target=(await db.query('SELECT * FROM resource_units WHERE id=$1 AND pool_id=$2 AND active=true',[input.unitId,a.pool_id])).rows[0];
   if(!target||!target.shifts||!scheduleContains(target.shifts,new Date(a.start_at),new Date(a.end_at)))throw new DomainError('staff_unavailable');
   if((await db.query(`SELECT id FROM allocations WHERE unit_id=$1 AND id!=$2 AND released_at IS NULL AND start_at<$4 AND end_at>$3`,[target.id,a.id,a.start_at,a.end_at])).rows.length)throw new DomainError('capacity_conflict');
   // Pending extensions retain an original-allocation snapshot; changing its staff would corrupt expiry rollback.
   if((await db.query("SELECT id FROM extensions WHERE booking_id=$1 AND status IN ('holding','manual_review')",[a.booking_id])).rows.length)throw new DomainError('extension_pending');
   await db.query('UPDATE allocations SET unit_id=$1 WHERE id=$2',[target.id,a.id]);
   await audit(db,who,'concierge_reassigned',a.id,{from:a.unit_id,to:target.id});return {id:a.id};
  });
 }
 async task(input:{id:string;status:string;notes:string},who:Identity){
  uuid(input.id);if(!['assigned','started','completed','needs_help'].includes(input.status))throw new DomainError('invalid_task_status',400);
  const notes=text(input.notes);return transaction(this.pool,async db=>{
   const a=(await db.query(`SELECT a.id,a.unit_id FROM allocations a JOIN resource_units u ON u.id=a.unit_id JOIN resource_pools p ON p.id=u.pool_id WHERE a.id=$1 AND a.released_at IS NULL AND p.kind='concierge' FOR UPDATE OF a`,[input.id])).rows[0];
   if(!a||(who.role==='staff'&&a.unit_id!==who.unitId))throw new DomainError('assignment_not_found',404);
   await db.query(`INSERT INTO fulfillment(allocation_id,status,notes) VALUES($1,$2,$3) ON CONFLICT(allocation_id) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes,updated_at=now()`,[a.id,input.status,notes]);
   await audit(db,who,'fulfillment_updated',a.id,{status:input.status});return {id:a.id};
  });
 }
 async payments(who:Identity){requireRole(who,['owner','manager']);return (await this.pool.query(`SELECT p.id,p.booking_id,p.extension_id,p.amount_satang,p.currency,p.status,p.provider,p.session_id,p.expires_at,b.code,r.status AS review_status,r.notes AS review_notes FROM payments p JOIN bookings b ON b.id=p.booking_id LEFT JOIN payment_reviews r ON r.payment_id=p.id ORDER BY p.expires_at DESC LIMIT 300`)).rows;}
 async paymentReview(input:{id:string;status:string;notes:string},who:Identity){requireRole(who,['owner','manager']);uuid(input.id);if(!['open','investigating','resolved'].includes(input.status))throw new DomainError('invalid_review_status',400);const notes=text(input.notes);if(!notes)throw new DomainError('review_notes_required',400);
  return transaction(this.pool,async db=>{if(!(await db.query('SELECT id FROM payments WHERE id=$1 FOR UPDATE',[input.id])).rows.length)throw new DomainError('payment_not_found',404);
   await db.query(`INSERT INTO payment_reviews(payment_id,status,notes,actor) VALUES($1,$2,$3,$4) ON CONFLICT(payment_id) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes,actor=EXCLUDED.actor,updated_at=now()`,[input.id,input.status,notes,who.email]);
   await audit(db,who,'payment_review_updated',input.id,{status:input.status});return {id:input.id};});
 }
 async accounts(who:Identity){requireRole(who,['owner']);return (await this.pool.query('SELECT email,role,unit_id,active,valid_after FROM admin_accounts ORDER BY email')).rows;}
 async account(input:{email:string;role:string;unitId:string|null;active:boolean},who:Identity){requireRole(who,['owner']);const email=text(input.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['owner','manager','staff'].includes(input.role)||typeof input.active!=='boolean')throw new DomainError('invalid_account',400);
  return transaction(this.pool,async db=>{
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended('224:accounts',0))");
   const old=(await db.query('SELECT * FROM admin_accounts WHERE email=$1 FOR UPDATE',[email])).rows[0];
   if(old?.role==='owner'&&old.active&&(!input.active||input.role!=='owner')&&(await db.query("SELECT email FROM admin_accounts WHERE role='owner' AND active=true")).rows.length<2)throw new DomainError('last_owner_required');
   if(input.role==='staff'&&!(await db.query(`SELECT u.id FROM resource_units u JOIN resource_pools p ON p.id=u.pool_id WHERE u.id=$1 AND p.kind='concierge'`,[input.unitId])).rows.length)throw new DomainError('staff_unit_required',400);
   await db.query(`INSERT INTO admin_accounts(email,role,unit_id,active,valid_after) VALUES($1,$2,$3,$4,0)
    ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,unit_id=EXCLUDED.unit_id,active=EXCLUDED.active,valid_after=EXTRACT(EPOCH FROM now())::bigint`,[email,input.role,input.role==='staff'?input.unitId:null,input.active]);
   await audit(db,who,'account_updated',email,{role:input.role,active:input.active});return {email};
  });
 }
 async audit(who:Identity){requireRole(who,['owner']);return (await this.pool.query('SELECT id,actor,action,target,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 300')).rows;}
}
