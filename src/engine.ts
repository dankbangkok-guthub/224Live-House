import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from './database';
import { DomainError, integer, localText, MINUTE, quote, scheduleContains, validateService, validateSpace,
  type Quote, type RequestInput, type Schedule, type Service, type ServiceConfig, type Space, type SpaceConfig } from './domain';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function tokenDigest(token: string) {
  if (typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) throw new DomainError('invalid_access_token',401);
  return digest(token);
}
function authorize(booking: any, token: string) {
  const candidate=tokenDigest(token);
  if (!booking || !timingSafeEqual(Buffer.from(booking.access_digest),Buffer.from(candidate)))
    throw new DomainError('booking_not_found',404);
}
function keyValid(key: string) {
  if (typeof key!=='string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new DomainError('invalid_idempotency_key',400);
}
async function idem<T>(db: PoolClient, scope: string, key: string, input: unknown, work: ()=>Promise<T>) {
  keyValid(key);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[scope+':'+key]);
  const hash=digest(input);
  const old=(await db.query('SELECT * FROM idempotency WHERE scope=$1 AND key=$2',[scope,key])).rows[0];
  if (old) {
    if (old.digest!==hash) throw new DomainError('idempotency_input_changed');
    return old.result as T;
  }
  const result=await work();
  await db.query('INSERT INTO idempotency(scope,key,digest,result) VALUES($1,$2,$3,$4)',[scope,key,hash,result]);
  return result;
}
type Customer = { name: string; email: string; phone: string; eventType: string; notes?: string };
type HoldInput = RequestInput & {customer: Customer; acceptedPolicyVersion: string; quoteDigest: string; accessToken: string};
function validateCustomer(c: Customer) {
  if (!c || typeof c.name!=='string' || c.name.trim().length<2 || c.name.length>120
    || typeof c.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) || c.email.length>254
    || typeof c.phone!=='string' || !/^[+0-9 ()-]{7,30}$/.test(c.phone)
    || typeof c.eventType!=='string' || !c.eventType.trim() || c.eventType.length>100
    || (c.notes!==undefined && (typeof c.notes!=='string' || c.notes.length>3000)))
    throw new DomainError('invalid_customer',400);
}
async function audit(db: PoolClient, actor: string, action: string, target: string, details: unknown={}) {
  await db.query('INSERT INTO audit_logs(id,actor,action,target,details) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(),actor,action,target,details]);
}
async function notify(db: PoolClient, bookingId: string, key: string, kind: string, payload: unknown) {
  await db.query('INSERT INTO outbox(id,logical_key,kind,booking_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(logical_key) DO NOTHING',
    [randomUUID(),key,kind,bookingId,payload]);
}

export class VenueEngine {
  constructor(public pool: Pool, private clock=()=>new Date()) {}
  private async catalog(db: PoolClient, input: RequestInput, locked=false): Promise<{space:Space;services:Service[]}> {
    const space=(await db.query('SELECT * FROM spaces WHERE id=$1 AND published=true'+(locked?' FOR SHARE':''),[input.spaceId])).rows[0];
    if (!space) throw new DomainError('space_unavailable',404);
    const services=(await db.query('SELECT * FROM services WHERE published=true ORDER BY id'+(locked?' FOR SHARE':''))).rows;
    return {space,services};
  }
  async catalogPublic() {
    const [spaces, services]=await Promise.all([
      this.pool.query('SELECT id,name,capacity,config,version FROM spaces WHERE published=true ORDER BY name'),
      this.pool.query('SELECT id,name,config,version FROM services WHERE published=true ORDER BY name')
    ]);
    return {spaces:spaces.rows,services:services.rows};
  }
  async preview(input: RequestInput) {
    const db=await this.pool.connect();
    try {
      const {space,services}=await this.catalog(db,input);
      const q=quote(space,services,input,this.clock());
      await this.checkResources(db,q);
      return {quote:q,quoteDigest:digest(q)};
    } finally {db.release();}
  }
  private requirements(q: Quote) {
    return [{poolId:'space:'+q.spaceId,quantity:1,start:q.occupiedStart,end:q.occupiedEnd,serviceId:null as string|null},
      ...q.services.filter(s=>s.poolId).map(s=>({poolId:s.poolId!,quantity:s.quantity,start:s.start,end:s.end,serviceId:s.id}))];
  }
  private async lockPools(db: PoolClient, ids: string[]) {
    const unique=[...new Set(ids)].sort();
    for (const id of unique) {
      const result=await db.query('SELECT id FROM resource_pools WHERE id=$1 FOR UPDATE',[id]);
      if (!result.rows.length) throw new DomainError('resource_unavailable');
    }
  }
  private async candidates(db: PoolClient, poolId: string, start: string, end: string) {
    const units=(await db.query(
      `SELECT u.* FROM resource_units u WHERE pool_id=$1 AND active=true AND NOT EXISTS
       (SELECT 1 FROM allocations a WHERE a.unit_id=u.id AND a.released_at IS NULL
        AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)'))
       ORDER BY u.id`,[poolId,start,end])).rows;
    return units.filter(u=>!u.shifts || scheduleContains(u.shifts,new Date(start),new Date(end)));
  }
  private async checkResources(db: PoolClient, q: Quote) {
    // Aggregate equal-pool requests conservatively across their union for preview.
    // Actual reservations below allocate sequentially and database constraints remain authoritative.
    const counts=new Map<string,number>();
    for (const r of this.requirements(q)) {
      const units=await this.candidates(db,r.poolId,r.start,r.end);
      const count=(counts.get(r.poolId)??0)+r.quantity;
      counts.set(r.poolId,count);
      if (units.length<count) throw new DomainError('capacity_conflict');
    }
  }
  private async reserve(db: PoolClient, bookingId: string, q: Quote) {
    const required=this.requirements(q);
    await this.lockPools(db,required.map(r=>r.poolId));
    for (const r of required) {
      const units=await this.candidates(db,r.poolId,r.start,r.end);
      if (units.length<r.quantity) throw new DomainError('capacity_conflict');
      for (const unit of units.slice(0,r.quantity))
        await db.query('INSERT INTO allocations(id,unit_id,booking_id,service_id,start_at,end_at) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(),unit.id,bookingId,r.serviceId,r.start,r.end]);
    }
  }
  async hold(input: HoldInput, key: string) {
    validateCustomer(input.customer);
    const access=tokenDigest(input.accessToken);
    return transaction(this.pool,db=>idem(db,'hold:'+access,key,{...input,accessToken:access},async()=>{
      const {space,services}=await this.catalog(db,input,true);
      const q=quote(space,services,input,this.clock());
      if (digest(q)!==input.quoteDigest) throw new DomainError('quote_changed');
      if (q.policyVersion!==input.acceptedPolicyVersion) throw new DomainError('policy_not_accepted',400);
      const id=randomUUID(), code='224-'+id.slice(0,8).toUpperCase();
      const expires=new Date(this.clock().getTime()+space.config.holdMinutes*MINUTE).toISOString();
      await db.query(`INSERT INTO bookings(id,code,space_id,start_at,end_at,guests,status,hold_expires_at,access_digest,quote,customer)
        VALUES($1,$2,$3,$4,$5,$6,'holding',$7,$8,$9,$10)`,
        [id,code,space.id,q.start,q.end,q.guests,expires,access,q,
          {...input.customer,acceptedPolicyVersion:q.policyVersion,acceptedAt:this.clock().toISOString()}]);
      await this.reserve(db,id,q);
      await audit(db,'customer','hold_created',id,{quoteDigest:digest(q)});
      return {id,code,expiresAt:expires,quote:q};
    }));
  }
  async status(id: string, token: string) {
    const b=(await this.pool.query('SELECT * FROM bookings WHERE id=$1',[id])).rows[0];
    authorize(b,token);
    const payments=(await this.pool.query('SELECT id,extension_id,amount_satang,currency,status,checkout_url,expires_at FROM payments WHERE booking_id=$1',[id])).rows;
    const extensions=(await this.pool.query('SELECT id,original_end,proposed_end,status,quote,hold_expires_at FROM extensions WHERE booking_id=$1',[id])).rows;
    return {id:b.id,code:b.code,status:b.status,start:b.start_at,end:b.end_at,quote:b.quote,expiresAt:b.hold_expires_at,payments,extensions};
  }
  async checkout(id: string, token: string, extensionId: string|null, key: string, origin: string) {
    return transaction(this.pool,db=>idem(db,'checkout:'+id+':'+tokenDigest(token),key,{extensionId},async()=>{
      const b=(await db.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[id])).rows[0]; authorize(b,token);
      const ext=extensionId?(await db.query('SELECT * FROM extensions WHERE id=$1 AND booking_id=$2 FOR UPDATE',[extensionId,id])).rows[0]:null;
      if (extensionId && !ext) throw new DomainError('extension_not_found',404);
      const target=ext??b;
      if (target.status!=='holding' || (ext && b.status!=='confirmed')) throw new DomainError('not_payable');
      if (new Date(target.hold_expires_at)<=this.clock()) throw new DomainError('hold_expired');
      const old=(await db.query('SELECT * FROM payments WHERE booking_id=$1 AND extension_id IS NOT DISTINCT FROM $2::uuid',[id,extensionId])).rows[0];
      if (old) {
        if (!['pending','processing'].includes(old.status)) throw new DomainError('checkout_not_retryable');
        return {paymentId:old.id,checkoutUrl:old.checkout_url,amountSatang:Number(old.amount_satang),currency:old.currency};
      }
      // Only a development sandbox adapter is implemented. No external HTTP call in this transaction.
      const paymentId=randomUUID(), session='sandbox_'+randomUUID();
      const checkoutUrl=new URL('/sandbox/'+paymentId,origin).toString();
      await db.query(`INSERT INTO payments(id,booking_id,extension_id,amount_satang,currency,status,provider,session_id,checkout_url,quote_digest,expires_at)
        VALUES($1,$2,$3,$4,'THB','pending','sandbox',$5,$6,$7,$8)`,
        [paymentId,id,extensionId,target.quote.totalSatang,session,checkoutUrl,digest(target.quote),target.hold_expires_at]);
      await audit(db,'customer','sandbox_checkout_created',paymentId);
      return {paymentId,checkoutUrl,amountSatang:target.quote.totalSatang,currency:'THB'};
    }));
  }
  async requestExtension(id: string, token: string, hours: number, key: string, acceptedPolicyVersion:string) {
    integer(hours,1,24);
    return transaction(this.pool,db=>idem(db,'extension:'+id+':'+tokenDigest(token),key,{hours},async()=>{
      const b=(await db.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[id])).rows[0]; authorize(b,token);
      if (b.status!=='confirmed' || new Date(b.end_at)<=this.clock()) throw new DomainError('booking_not_extendable');
      if ((await db.query("SELECT id FROM extensions WHERE booking_id=$1 AND status IN ('holding','manual_review')",[id])).rows.length)
        throw new DomainError('extension_already_pending');
      const space=(await db.query('SELECT * FROM spaces WHERE id=$1 FOR SHARE',[b.space_id])).rows[0] as Space;
      validateSpace(space.config);
      if(acceptedPolicyVersion!==space.config.policyVersion) throw new DomainError('policy_not_accepted',400);
      const oldQuote=b.quote as Quote;
      const originalHours=(new Date(b.end_at).getTime()-new Date(b.start_at).getTime())/(60*MINUTE);
      if (originalHours+hours>space.config.maxHours) throw new DomainError('maximum_duration');
      const proposed=new Date(new Date(b.end_at).getTime()+hours*60*MINUTE);
      const allocations=(await db.query(`SELECT a.*,u.pool_id,u.shifts FROM allocations a JOIN resource_units u ON u.id=a.unit_id
        WHERE a.booking_id=$1 AND a.released_at IS NULL ORDER BY a.id`,[id])).rows;
      await this.lockPools(db,allocations.map(a=>a.pool_id));
      const items:Quote['items']=[{kind:'ot',description:'Extension — extra hours',quantity:hours,unitSatang:space.config.otSatang,totalSatang:integer(hours*space.config.otSatang,1)}];
      // Services are full-event coverage in this first implementation: all reserved services extend together.
      for (const selected of oldQuote.services) {
        const service=(await db.query('SELECT * FROM services WHERE id=$1 FOR SHARE',[selected.id])).rows[0] as Service;
        if (!service) throw new DomainError('service_unavailable');
        validateService(service.config);
        if (service.config.priceType==='hour') {
          const quantity=hours*selected.quantity;
          items.push({kind:'service',description:service.name+' — extension',quantity,unitSatang:service.config.priceSatang,
            totalSatang:integer(quantity*service.config.priceSatang,0)});
        }
        if (service.config.priceType==='request_quote') throw new DomainError('service_requires_approval');
        const extendedEnd=new Date(new Date(selected.end).getTime()+hours*60*MINUTE);
        if (service.config.schedule && !scheduleContains(service.config.schedule,new Date(selected.start),extendedEnd))
          throw new DomainError('service_closed');
      }
      const newOccupiedEnd=new Date(new Date(oldQuote.occupiedEnd).getTime()+hours*60*MINUTE);
      if (!scheduleContains(space.config.schedule,new Date(oldQuote.occupiedStart),newOccupiedEnd)) throw new DomainError('closed_period');
      for (const a of allocations) {
        const newEnd=new Date(new Date(a.end_at).getTime()+hours*60*MINUTE);
        if (a.shifts && !scheduleContains(a.shifts,new Date(a.start_at),newEnd)) throw new DomainError('concierge_unavailable');
      }
      const extensionId=randomUUID(), expires=new Date(this.clock().getTime()+space.config.holdMinutes*MINUTE).toISOString();
      const q={hours,currency:'THB',items,totalSatang:integer(items.reduce((n,i)=>n+i.totalSatang,0),1),
        policyVersion:space.config.policyVersion,rules:space.config.rules,acceptedAt:this.clock().toISOString(),
        originalEnd:new Date(b.end_at).toISOString(),proposedEnd:proposed.toISOString()};
      await db.query(`INSERT INTO extensions(id,booking_id,original_end,proposed_end,status,hold_expires_at,quote,original_allocations)
        VALUES($1,$2,$3,$4,'holding',$5,$6,$7)`,
        [extensionId,id,b.end_at,proposed,expires,q,JSON.stringify(allocations.map(a=>({id:a.id,end:new Date(a.end_at).toISOString()})))]);
      for (const a of allocations) {
        await db.query('UPDATE allocations SET end_at=$1,extension_id=$2 WHERE id=$3',
          [new Date(new Date(a.end_at).getTime()+hours*60*MINUTE),extensionId,a.id]);
      }
      await audit(db,'customer','extension_requested',extensionId,{hours});
      return {id:extensionId,expiresAt:expires,quote:q};
    }));
  }
  // Only call after verifying the provider signature, account, environment and event shape.
  async verifiedPayment(event: {id:string;paymentId:string;sessionId:string;currency:string;amountSatang:number;quoteDigest:string;status:'paid'|'failed'}) {
    return transaction(this.pool,async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['event:sandbox:'+event.id]);
      const old=(await db.query("SELECT * FROM payment_events WHERE provider='sandbox' AND event_id=$1",[event.id])).rows[0];
      if (old) {
        if (old.digest!==digest(event)) throw new DomainError('event_payload_mismatch');
        return {outcome:old.outcome};
      }
      // Read booking ID, then lock booking before payment to match expiry/checkout lock order.
      const reference=(await db.query('SELECT booking_id FROM payments WHERE id=$1',[event.paymentId])).rows[0];
      if (!reference) throw new DomainError('payment_not_found',404);
      const b=(await db.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[reference.booking_id])).rows[0];
      const p=(await db.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE',[event.paymentId])).rows[0];
      const ext=p.extension_id?(await db.query('SELECT * FROM extensions WHERE id=$1 FOR UPDATE',[p.extension_id])).rows[0]:null;
      let outcome='ignored';
      const matched=event.currency==='THB' && event.amountSatang===Number(p.amount_satang)
        && event.sessionId===p.session_id && event.quoteDigest===p.quote_digest;
      if (!matched) {
        // Do not downgrade an already verified payment or confirmed booking.
        if (p.status!=='paid') {
          await db.query("UPDATE payments SET status='manual_review' WHERE id=$1",[p.id]);
          if (ext) await db.query("UPDATE extensions SET status='manual_review' WHERE id=$1",[ext.id]);
          else if (b.status!=='confirmed') await db.query("UPDATE bookings SET status='manual_review' WHERE id=$1",[b.id]);
        }
        outcome='manual_review';
      } else if (p.status==='paid') outcome='already_paid';
      else if (event.status==='paid') {
        const target=ext??b;
        const active=(await db.query('SELECT id FROM allocations WHERE booking_id=$1 AND released_at IS NULL',[b.id])).rows.length;
        if (target.status!=='holding' || !active || (ext && b.status!=='confirmed')) {
          await db.query("UPDATE payments SET status='manual_review' WHERE id=$1",[p.id]);
          if(ext) await db.query("UPDATE extensions SET status='manual_review' WHERE id=$1",[ext.id]);
          else await db.query("UPDATE bookings SET status='manual_review' WHERE id=$1",[b.id]);
          outcome='manual_review';
        } else {
          await db.query("UPDATE payments SET status='paid' WHERE id=$1",[p.id]);
          if (ext) {
            const next={...b.quote,end:new Date(ext.proposed_end).toISOString(),
              occupiedEnd:new Date(new Date(b.quote.occupiedEnd).getTime()+ext.quote.hours*60*MINUTE).toISOString(),
              hours:b.quote.hours+ext.quote.hours,items:[...b.quote.items,...ext.quote.items],
              totalSatang:integer(b.quote.totalSatang+ext.quote.totalSatang,1),
              services:b.quote.services.map((s:any)=>({...s,end:new Date(new Date(s.end).getTime()+ext.quote.hours*60*MINUTE).toISOString()}))};
            await db.query('UPDATE bookings SET end_at=$1,quote=$2 WHERE id=$3',[ext.proposed_end,next,b.id]);
            await db.query("UPDATE extensions SET status='confirmed' WHERE id=$1",[ext.id]);
            await db.query('UPDATE allocations SET extension_id=NULL WHERE booking_id=$1 AND released_at IS NULL',[b.id]);
          } else await db.query("UPDATE bookings SET status='confirmed' WHERE id=$1",[b.id]);
          await notify(db,b.id,'paid:'+p.id,ext?'extension_confirmed':'booking_confirmed',{paymentId:p.id});
          outcome='confirmed';
        }
      } else if (['pending','processing'].includes(p.status)) {
        await db.query("UPDATE payments SET status='failed' WHERE id=$1",[p.id]);
        await this.release(db,b,ext);
        outcome='failed';
      }
      await db.query("INSERT INTO payment_events(provider,event_id,digest,outcome) VALUES('sandbox',$1,$2,$3)",[event.id,digest(event),outcome]);
      await audit(db,'sandbox_webhook','payment_'+outcome,p.id);
      return {outcome};
    });
  }
  private async release(db:PoolClient,b:any,ext:any) {
    if (ext) {
      // Own original booking survives. Expanded allocation intervals revert atomically.
      for(const a of ext.original_allocations) await db.query('UPDATE allocations SET end_at=$1,extension_id=NULL WHERE id=$2',[a.end,a.id]);
      await db.query("UPDATE extensions SET status='expired' WHERE id=$1",[ext.id]);
    } else {
      await db.query('UPDATE allocations SET released_at=$1 WHERE booking_id=$2 AND released_at IS NULL',[this.clock(),b.id]);
      await db.query("UPDATE bookings SET status='expired' WHERE id=$1",[b.id]);
    }
  }
  async expireSandboxHolds() {
    // Sandbox has no external processing: pending links expire atomically with reservations.
    // Live providers MUST replace this with cancellation/reconciliation before freeing capacity.
    const due=(await this.pool.query(`SELECT DISTINCT id FROM bookings WHERE status='holding' AND hold_expires_at <= $1
      UNION SELECT booking_id AS id FROM extensions WHERE status='holding' AND hold_expires_at <= $1`,[this.clock()])).rows;
    for(const row of due) await transaction(this.pool,async db=>{
      const b=(await db.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      const ext=(await db.query("SELECT * FROM extensions WHERE booking_id=$1 AND status='holding' AND hold_expires_at <= $2 FOR UPDATE",[b.id,this.clock()])).rows[0];
      const target=ext??b;
      if(target.status!=='holding' || new Date(target.hold_expires_at)>this.clock()) return;
      const p=(await db.query('SELECT * FROM payments WHERE booking_id=$1 AND extension_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE',[b.id,ext?.id??null])).rows[0];
      if(p && !['pending','failed','expired'].includes(p.status)) return; // uncertain/paid: keep capacity
      if(p) await db.query("UPDATE payments SET status='expired' WHERE id=$1",[p.id]);
      await this.release(db,b,ext);
      await audit(db,'expiry_job','sandbox_hold_expired',ext?.id??b.id);
    });
    return {checked:due.length};
  }
  async configureSpace(space: {id:string;name:string;capacity:number;config:SpaceConfig;published:boolean},actor: string) {
    validateSpace(space.config); integer(space.capacity,1,10000);
    if(!/^[a-z0-9-]{1,60}$/.test(space.id) || !space.name) throw new DomainError('invalid_space',400);
    return transaction(this.pool,async db=>{
      await db.query(`INSERT INTO spaces(id,name,capacity,config,published) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,capacity=EXCLUDED.capacity,config=EXCLUDED.config,
        published=EXCLUDED.published,version=spaces.version+1`,[space.id,space.name,space.capacity,space.config,space.published]);
      await db.query("INSERT INTO resource_pools(id,kind,name) VALUES($1,'space',$2) ON CONFLICT(id) DO NOTHING",['space:'+space.id,space.name]);
      await db.query('INSERT INTO resource_units(id,pool_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',['space:'+space.id,'space:'+space.id]);
      const affected=(await db.query("SELECT id,guests,start_at,end_at FROM bookings WHERE space_id=$1 AND status IN ('holding','confirmed','manual_review')",[space.id])).rows;
      await audit(db,actor,'space_configured',space.id,{impactedBookingIds:affected.map(b=>b.id)});
      return {id:space.id,reviewBookings:affected};
    });
  }
  async configureService(service: {id:string;name:string;config:ServiceConfig;published:boolean;poolId:string|null},actor:string) {
    validateService(service.config);
    if(!/^[a-z0-9-]{1,60}$/.test(service.id) || !service.name) throw new DomainError('invalid_service',400);
    return transaction(this.pool,async db=>{
      await db.query(`INSERT INTO services(id,name,pool_id,config,published) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,pool_id=EXCLUDED.pool_id,config=EXCLUDED.config,
        published=EXCLUDED.published,version=services.version+1`,[service.id,service.name,service.poolId,service.config,service.published]);
      await audit(db,actor,'service_configured',service.id);
      return {id:service.id};
    });
  }
  async provisionPool(pool: {id:string;name:string;kind:'inventory'|'concierge';units:{id:string;shifts?:Schedule}[]},actor:string) {
    if(!/^[a-z0-9-]{1,60}$/.test(pool.id) || !['inventory','concierge'].includes(pool.kind)
      || !Array.isArray(pool.units) || pool.units.length<1 || pool.units.length>100) throw new DomainError('invalid_pool',400);
    for(const u of pool.units) {
      if(!/^[a-z0-9-]{1,60}$/.test(u.id)) throw new DomainError('invalid_unit',400);
      if(pool.kind==='concierge' && !u.shifts) throw new DomainError('shift_required',400);
      if(u.shifts) scheduleContains(u.shifts,new Date(),new Date(Date.now()+1));
    }
    return transaction(this.pool,async db=>{
      // Add-only provisioning. Do not mutate existing staff shifts or stock silently.
      await db.query('INSERT INTO resource_pools(id,kind,name) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[pool.id,pool.kind,pool.name]);
      await this.lockPools(db,[pool.id]);
      for(const u of pool.units) await db.query('INSERT INTO resource_units(id,pool_id,shifts) VALUES($1,$2,$3)',[u.id,pool.id,u.shifts??null]);
      await audit(db,actor,'pool_units_added',pool.id,{units:pool.units.map(u=>u.id)});
      return {id:pool.id};
    });
  }
  async blackout(spaceId:string,start:string,end:string,reason:string,actor:string) {
    const a=new Date(start),b=new Date(end);
    if(!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || b<=a || !reason || reason.length>500) throw new DomainError('invalid_blackout',400);
    return transaction(this.pool,async db=>{
      await this.lockPools(db,['space:'+spaceId]);
      const id=randomUUID();
      await db.query('INSERT INTO allocations(id,unit_id,start_at,end_at,reason) VALUES($1,$2,$3,$4,$5)',[id,'space:'+spaceId,a,b,reason]);
      await audit(db,actor,'blackout_created',id);
      return {id};
    });
  }
  async availability(spaceId:string,date:string,hours:number,guests:number) {
    // Preview deliberately limits workload to 48 candidates for a 30-minute launch picker.
    const catalog=await this.catalogPublic(), s=catalog.spaces.find(s=>s.id===spaceId);
    if(!s) throw new DomainError('space_unavailable',404);
    const slots=[];
    for(let minute=0;minute<1440;minute+=Math.max(30,s.config.slotMinutes)) {
      const startLocal=date+'T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
      try {await this.preview({spaceId,startLocal,hours,guests,services:[]});slots.push({startLocal,available:true});}
      catch(e) {if(!(e instanceof DomainError))throw e; slots.push({startLocal,available:false,reason:e.code});}
    }
    return {date,slots};
  }
}
