import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { database } from '../src/database';
import { VenueEngine } from '../src/engine';
import type { SpaceConfig } from '../src/domain';
import { startTestDatabase } from './postgres';

let stop:()=>Promise<void>,e:VenueEngine;
let now=new Date('2030-01-01T00:00Z');
const schedule={weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),[{start:0,end:1440}]]))};
const config:SpaceConfig={baseSatang:120000,otSatang:150000,maxHours:12,slotMinutes:30,
  setupMinutes:30,cleanupMinutes:30,leadMinutes:0,horizonDays:90,holdMinutes:10,policyVersion:'test-1',rules:'test only',schedule};
const input={spaceId:'studio',startLocal:'2030-01-04T18:00',hours:2,guests:5,services:[] as {id:string;quantity:number}[]};
before(async()=>{
  const db=await startTestDatabase();stop=db.stop;
  const pool=db.pool??database(db.url!).pool;e=new VenueEngine(pool,()=>now);
  await pool.query(await readFile(new URL('../db/001_engine.sql',import.meta.url),'utf8'));
});
after(async()=>{if(e)await e.pool.end();if(stop)await stop();});
beforeEach(async()=>{
  now=new Date('2030-01-01T00:00Z');
  await e.pool.query('TRUNCATE audit_logs,outbox,idempotency,payment_events,payments,allocations,extensions,bookings,services,resource_units,resource_pools,spaces CASCADE');
  for(const id of ['studio','lounge'])await e.configureSpace({id,name:id,capacity:20,config,published:true},'test');
});
function token(){return randomBytes(32).toString('hex');}
async function prepare(selection=input,t=token(),key=randomUUID()){
  const preview=await e.preview(selection);
  const request={...selection,customer:{name:'Test customer',email:'test@example.com',phone:'+66123456789',eventType:'test'},
    acceptedPolicyVersion:'test-1',quoteDigest:preview.quoteDigest,accessToken:t};
  return {request,t,key};
}
async function hold(selection=input){const p=await prepare(selection);return {...p,b:await e.hold(p.request,p.key)};}
async function checkout(b:any,t:string,ext:string|null=null){
  const c=await e.checkout(b.id,t,ext,randomUUID(),'http://localhost:5173');
  const payment=(await e.pool.query('SELECT * FROM payments WHERE id=$1',[c.paymentId])).rows[0];
  return {c,payment};
}
async function paid(b:any,t:string,ext:string|null=null){
  const {c,payment}=await checkout(b,t,ext);
  const event={id:randomUUID(),paymentId:c.paymentId,sessionId:payment.session_id,currency:'THB',
    amountSatang:Number(payment.amount_satang),quoteDigest:payment.quote_digest,status:'paid' as const};
  await e.verifiedPayment(event);return event;
}
async function concierge(){
  await e.provisionPool({id:'staff',name:'staff',kind:'concierge',units:[{id:'person-one',shifts:schedule}]},'test');
  await e.configureService({id:'assistant',name:'Assistant',poolId:'staff',published:true,
    config:{priceType:'hour',priceSatang:50000,min:1,max:1,setupMinutes:0,cleanupMinutes:0,leadMinutes:0,allowedSpaces:['studio','lounge']}},'test');
}
test('two independent concurrent checkouts cannot hold the same space',async()=>{
  const a=await prepare(),b=await prepare();
  const results=await Promise.allSettled([e.hold(a.request,a.key),e.hold(b.request,b.key)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await e.pool.query('SELECT count(*) FROM bookings')).rows[0].count,'1');
});
test('setup/cleanup overlap blocked and adjacent occupied ranges allowed',async()=>{
  await hold();
  await assert.rejects(()=>hold({...input,startLocal:'2030-01-04T20:00'}),/capacity_conflict/);
  await hold({...input,startLocal:'2030-01-04T21:00'});
});
test('database exclusion constraint protects direct writes too',async()=>{
  await e.blackout('studio','2030-01-04T10:00Z','2030-01-04T12:00Z','maintenance','test');
  await assert.rejects(()=>e.pool.query('INSERT INTO allocations(id,unit_id,start_at,end_at,reason) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(),'space:studio','2030-01-04T11:00Z','2030-01-04T13:00Z','bypass']),{code:'23P01'});
});
test('blackout racing a hold cannot produce both occupied allocations',async()=>{
  const p=await prepare();
  const results=await Promise.allSettled([
    e.hold(p.request,p.key),e.blackout('studio','2030-01-04T10:00Z','2030-01-04T14:00Z','maintenance','test')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('idempotent hold and checkout are reused and changed inputs rejected',async()=>{
  const {request,key,t,b}=await hold();
  assert.equal((await e.hold(request,key)).id,b.id);
  await assert.rejects(()=>e.hold({...request,guests:6},key),/idempotency_input_changed/);
  const k=randomUUID(),a=await e.checkout(b.id,t,null,k,'http://localhost:5173');
  assert.deepEqual(await e.checkout(b.id,t,null,k,'http://localhost:5173'),a);
  assert.equal((await e.checkout(b.id,t,null,randomUUID(),'http://localhost:5173')).paymentId,a.paymentId);
});
test('shared concierge across spaces has one winner; failed hold rolls back all resources',async()=>{
  await concierge();
  const a=await prepare({...input,services:[{id:'assistant',quantity:1}]}),
    b=await prepare({...input,spaceId:'lounge',services:[{id:'assistant',quantity:1}]});
  const results=await Promise.allSettled([e.hold(a.request,a.key),e.hold(b.request,b.key)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await e.pool.query('SELECT count(*) FROM bookings')).rows[0].count,'1');
  assert.equal((await e.pool.query('SELECT count(*) FROM allocations')).rows[0].count,'2');
});
test('inventory is allocated by unit and cannot oversell',async()=>{
  await e.provisionPool({id:'equipment',name:'equipment',kind:'inventory',units:[{id:'mic-one'},{id:'mic-two'}]},'test');
  await e.configureService({id:'mic',name:'Mic',poolId:'equipment',published:true,
    config:{priceType:'unit',priceSatang:30000,min:1,max:2,setupMinutes:0,cleanupMinutes:0,leadMinutes:0,allowedSpaces:['studio','lounge']}},'test');
  await hold({...input,services:[{id:'mic',quantity:2}]});
  await assert.rejects(()=>hold({...input,spaceId:'lounge',services:[{id:'mic',quantity:1}]}),/capacity_conflict/);
});
test('staff shifts must cover the entire reservation',async()=>{
  await e.provisionPool({id:'staff',name:'staff',kind:'concierge',units:[{id:'person',shifts:{weekly:{'5':[{start:1080,end:1140}]}}}]},'test');
  await e.configureService({id:'assistant',name:'Assistant',poolId:'staff',published:true,
    config:{priceType:'hour',priceSatang:50000,min:1,max:1,setupMinutes:0,cleanupMinutes:0,leadMinutes:0,allowedSpaces:['studio']}},'test');
  await assert.rejects(()=>hold({...input,services:[{id:'assistant',quantity:1}]}),/capacity_conflict/);
});
test('price changes invalidate previous quote and no new hold is created',async()=>{
  const p=await prepare();
  await e.configureSpace({id:'studio',name:'studio',capacity:20,published:true,config:{...config,otSatang:160000}},'test');
  await assert.rejects(()=>e.hold(p.request,p.key),/quote_changed/);
});
test('verified paid event confirms once; duplicate/out-of-order failure cannot undo it',async()=>{
  const {b,t}=await hold(),event=await paid(b,t);
  assert.equal((await e.status(b.id,t)).status,'confirmed');
  assert.equal((await e.verifiedPayment(event)).outcome,'confirmed');
  await e.verifiedPayment({...event,id:randomUUID(),status:'failed'});
  assert.equal((await e.status(b.id,t)).status,'confirmed');
  assert.equal((await e.pool.query('SELECT count(*) FROM outbox')).rows[0].count,'1');
  await assert.rejects(()=>e.verifiedPayment({...event,amountSatang:1}),/event_payload_mismatch/);
});
test('mismatched amount enters manual review and retains allocated capacity',async()=>{
  const {b,t}=await hold(),{c,payment}=await checkout(b,t);
  await e.verifiedPayment({id:randomUUID(),paymentId:c.paymentId,sessionId:payment.session_id,currency:'THB',
    amountSatang:1,quoteDigest:payment.quote_digest,status:'paid'});
  assert.equal((await e.status(b.id,t)).status,'manual_review');
  now=new Date('2030-01-01T01:00Z');await e.expireSandboxHolds();
  assert.equal((await e.pool.query('SELECT count(*) FROM allocations WHERE released_at IS NULL')).rows[0].count,'1');
});
test('expiry releases pending holds; late paid events cannot overbook',async()=>{
  const {b,t}=await hold(),{c,payment}=await checkout(b,t);
  now=new Date('2030-01-01T01:00Z');await e.expireSandboxHolds();
  await hold();
  const result=await e.verifiedPayment({id:randomUUID(),paymentId:c.paymentId,sessionId:payment.session_id,
    currency:'THB',amountSatang:Number(payment.amount_satang),quoteDigest:payment.quote_digest,status:'paid'});
  assert.equal(result.outcome,'manual_review');
  assert.equal((await e.pool.query('SELECT count(*) FROM allocations WHERE released_at IS NULL')).rows[0].count,'1');
});
test('paid webhook racing expiry either confirms or enters review, never releases a confirmed allocation',async()=>{
  const {b,t}=await hold(),{c,payment}=await checkout(b,t);
  now=new Date('2030-01-01T01:00Z');
  await Promise.all([e.expireSandboxHolds(),e.verifiedPayment({id:randomUUID(),paymentId:c.paymentId,
    sessionId:payment.session_id,currency:'THB',amountSatang:Number(payment.amount_satang),quoteDigest:payment.quote_digest,status:'paid'})]);
  const status=await e.status(b.id,t);
  if(status.status==='confirmed')assert.equal((await e.pool.query('SELECT count(*) FROM allocations WHERE booking_id=$1 AND released_at IS NULL',[b.id])).rows[0].count,'1');
  else assert.equal(status.status,'manual_review');
});
test('secure booking access requires a matching token',async()=>{
  const {b}=await hold();
  await assert.rejects(()=>e.status(b.id,token()),/booking_not_found/);
  await assert.rejects(()=>e.checkout(b.id,token(),null,randomUUID(),'http://localhost:5173'),/booking_not_found/);
});
test('extension is separate invoice, reserves capacity, and confirms exactly once',async()=>{
  await concierge();
  const {b,t}=await hold({...input,services:[{id:'assistant',quantity:1}]});await paid(b,t);
  const ext=await e.requestExtension(b.id,t,1,randomUUID(),'test-1');
  assert.equal(ext.quote.totalSatang,200000);
  assert.equal(new Date((await e.status(b.id,t)).end).toISOString(),b.quote.end);
  await assert.rejects(()=>hold({...input,startLocal:'2030-01-04T21:00'}),/capacity_conflict/);
  await assert.rejects(()=>e.requestExtension(b.id,t,1,randomUUID(),'test-1'),/extension_already_pending/);
  const event=await paid(b,t,ext.id);await e.verifiedPayment(event);
  const status=await e.status(b.id,t);
  assert.equal(new Date(status.end).toISOString(),'2030-01-04T14:00:00.000Z');
  assert.equal(status.quote.totalSatang,540000);
  assert.equal(status.quote.hours,3);
});
test('expired extension restores old cleanup interval and original paid booking',async()=>{
  const {b,t}=await hold();await paid(b,t);
  const ext=await e.requestExtension(b.id,t,1,randomUUID(),'test-1');
  await checkout(b,t,ext.id);
  now=new Date('2030-01-01T01:00Z');await e.expireSandboxHolds();
  const status=await e.status(b.id,t);
  assert.equal(status.status,'confirmed');
  assert.equal(new Date(status.end).toISOString(),b.quote.end);
  assert.equal(status.extensions[0].status,'expired');
  await hold({...input,startLocal:'2030-01-04T21:00'});
});
test('extension overlapping next booking rolls back original allocations',async()=>{
  const {b,t}=await hold();await paid(b,t);
  await hold({...input,startLocal:'2030-01-04T21:00'});
  await assert.rejects(()=>e.requestExtension(b.id,t,1,randomUUID(),'test-1'),/capacity_conflict/);
  assert.equal((await e.pool.query('SELECT count(*) FROM extensions')).rows[0].count,'0');
  assert.equal(new Date((await e.pool.query('SELECT end_at FROM allocations WHERE booking_id=$1',[b.id])).rows[0].end_at).toISOString(),b.quote.occupiedEnd);
});
test('extension validates policy, maximum duration and closing hours',async()=>{
  const {b,t}=await hold();await paid(b,t);
  await assert.rejects(()=>e.requestExtension(b.id,t,1,randomUUID(),'wrong'),/policy_not_accepted/);
  await assert.rejects(()=>e.requestExtension(b.id,t,24,randomUUID(),'test-1'),/maximum_duration/);
  await e.configureSpace({id:'studio',name:'studio',capacity:20,published:true,
    config:{...config,schedule:{weekly:{'5':[{start:1020,end:1230}]}}}},'test');
  await assert.rejects(()=>e.requestExtension(b.id,t,1,randomUUID(),'test-1'),/closed_period/);
});
