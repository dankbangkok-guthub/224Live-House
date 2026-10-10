import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCatalog,previewQuote,previewStartTimes } from '../src/booking-preview';
const now=new Date('2026-10-10T00:00:00Z');
const input={spaceId:previewCatalog.spaces[0].id,startLocal:'2026-10-11T23:30',hours:2,guests:5,services:[]};
test('preview handles midnight and buffers at the sample closing boundary',()=>{
  const q=previewQuote(input,now);
  assert.equal(q.end,'2026-10-11T18:30:00.000Z');
  assert.equal(q.occupiedEnd,'2026-10-11T19:00:00.000Z');
  assert.throws(()=>previewQuote({...input,startLocal:'2026-10-11T23:30',hours:3},now));
  const starts=previewStartTimes(input,'2026-10-11',now);
  assert.ok(starts.includes('23:30'));assert.ok(!starts.includes('10:00'));
});
test('sample prices use two-hour minimum, OT and hourly concierge',()=>{
  assert.throws(()=>previewQuote({...input,hours:1},now));
  const q=previewQuote({...input,startLocal:'2026-10-11T18:00',hours:3,services:[{id:'preview-concierge',quantity:1}]},now);
  assert.equal(q.totalSatang,540000);assert.equal(q.policyVersion,'preview-only');
  assert.match(q.rules,/no reservation or payment is created/);
  assert.throws(()=>previewQuote({...input,guests:41},now));
});
