import test from 'node:test';
import assert from 'node:assert/strict';
import { issueQuote, verifyQuote } from '../src/quotes';
const secret='isolated-quote-signing-test-secret-only';
const now=new Date('2030-01-01T00:00Z');
test('quote expiration is enforced at its exact boundary',()=>{
  const q=issueQuote('price-snapshot',secret,now);
  verifyQuote(q.quoteToken,'price-snapshot',secret,new Date(now.getTime()+899999));
  assert.throws(()=>verifyQuote(q.quoteToken,'price-snapshot',secret,new Date(q.quoteExpiresAt)),/quote_expired/);
});
test('quote rejects altered signature, wrong snapshot, future issuance and malformed tokens',()=>{
  const q=issueQuote('snapshot',secret,now);
  const [payload,signature]=q.quoteToken.split('.');
  assert.throws(()=>verifyQuote(payload+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1),'snapshot',secret,now),/invalid_quote/);
  assert.throws(()=>verifyQuote(q.quoteToken,'different',secret,now),/quote_changed/);
  assert.throws(()=>verifyQuote(q.quoteToken,'snapshot',secret,new Date(now.getTime()-1)),/invalid_quote/);
  for(const token of ['','..','bad.token','a'.repeat(1001)])assert.throws(()=>verifyQuote(token,'snapshot',secret,now),/invalid_quote/);
});
test('quote issuer fails closed without a signing secret or bounded expiration',()=>{
  assert.throws(()=>issueQuote('snapshot','',now),/QUOTE_SIGNING_SECRET/);
  for(const minutes of [0,31,1.5,NaN])assert.throws(()=>issueQuote('snapshot',secret,now,minutes),/QUOTE_TTL_MINUTES/);
});
