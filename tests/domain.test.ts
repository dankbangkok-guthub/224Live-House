import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localInstant, localText, quote, scheduleContains, type Space } from '../src/domain';
import { signSandboxEvent, verifySandboxEvent } from '../src/payments';
const now=new Date('2030-01-01T00:00Z');
const space:Space={id:'studio',name:'Studio',capacity:20,version:1,config:{
  baseSatang:120000,otSatang:150000,maxHours:12,slotMinutes:30,setupMinutes:30,cleanupMinutes:30,
  leadMinutes:0,horizonDays:90,holdMinutes:10,policyVersion:'test-1',rules:'Test only',
  schedule:{weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),[{start:0,end:1440}]]))}
}};
const input={spaceId:'studio',startLocal:'2030-01-04T18:00',hours:3,guests:5,services:[]};
test('two-hour base and exact one-hour OT, integer satang',()=>{
  const q=quote(space,[],input,now);
  assert.equal(q.totalSatang,390000);
  assert.equal(q.end,'2030-01-04T14:00:00.000Z');
  assert.equal(q.occupiedStart,'2030-01-04T10:30:00.000Z');
  assert.equal(q.items.length,2);
});
test('minimum, fractions, guests, max duration, past date and slot validation',()=>{
  for(const bad of [{hours:1},{hours:2.5},{hours:13},{guests:21},{guests:0},{startLocal:'2030-01-04T18:17'},{startLocal:'2029-01-01T18:00'}])
    assert.throws(()=>quote(space,[],{...input,...bad},now));
});
test('invalid civil dates do not silently normalize',()=>{
  for(const date of ['2030-02-30T18:00','2030-13-01T18:00','2030-01-01T24:00','2030-01-01T18:99'])assert.throws(()=>localInstant(date));
});
test('Friday overnight hours and next-day closing override',()=>{
  const schedule={weekly:{'5':[{start:1080,end:1560}]}};
  const start=localInstant('2030-01-04T23:00'), end=localInstant('2030-01-05T01:00');
  assert.equal(scheduleContains(schedule,start,end),true);
  assert.equal(scheduleContains({...schedule,overrides:{'2030-01-05':[]}},start,end),false);
  assert.equal(scheduleContains(schedule,start,localInstant('2030-01-05T03:00')),false);
  assert.equal(localText(end),'2030-01-05T01:00');
});
test('cleanup must fit opening hours and adjacent opening segments combine',()=>{
  const short={...space,config:{...space.config,schedule:{weekly:{'5':[{start:1080,end:1260}]}}}};
  assert.throws(()=>quote(short,[],{...input,hours:3},now),/closed_period/);
  const split={weekly:{'5':[{start:1080,end:1200},{start:1200,end:1320}]}};
  assert.equal(scheduleContains(split,localInstant('2030-01-04T18:00'),localInstant('2030-01-04T22:00')),true);
});
test('hourly concierge amount, service buffers and request-only rejection',()=>{
  const service={id:'concierge',name:'Assistant',version:1,pool_id:'staff',config:{
    priceType:'hour' as const,priceSatang:50000,min:1,max:2,setupMinutes:15,cleanupMinutes:15,leadMinutes:0,allowedSpaces:['studio']}};
  const q=quote(space,[service],{...input,services:[{id:'concierge',quantity:1}]},now);
  assert.equal(q.totalSatang,540000);
  assert.equal(q.occupiedEnd,'2030-01-04T14:45:00.000Z');
  assert.throws(()=>quote(space,[{...service,config:{...service.config,priceType:'request_quote'}}],{...input,services:[{id:'concierge',quantity:1}]},now));
  assert.throws(()=>quote(space,[service],{...input,services:[{id:'concierge',quantity:1},{id:'concierge',quantity:1}]},now));
});
test('unsafe money overflow is rejected',()=>assert.throws(()=>quote({...space,config:{...space.config,baseSatang:Number.MAX_SAFE_INTEGER}},[],input,now)));
test('sandbox signatures verify raw bytes and reject tampering',()=>{
  const secret='test-secret-'.repeat(4);
  const event={id:'e1',paymentId:'12345678-1234-1234-1234-123456789abc',sessionId:'s1',currency:'THB',amountSatang:100,quoteDigest:'x',status:'paid'};
  const raw=JSON.stringify(event),signature=signSandboxEvent(raw,secret);
  assert.deepEqual(verifySandboxEvent(raw,signature,secret),event);
  assert.throws(()=>verifySandboxEvent(raw+' ',signature,secret),/invalid_signature/);
  assert.throws(()=>verifySandboxEvent(raw,'00',secret),/invalid_signature/);
});
