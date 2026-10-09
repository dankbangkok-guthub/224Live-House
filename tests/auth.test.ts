import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { verifyIdentity, adminConfigured } from '../src/auth';
const issuer='https://venue-test.cloudflareaccess.com',aud='test-app';
test('Access login checks signature, audience, issuer, expiry and human identity',async()=>{
 const a=await generateKeyPair('RS256'),b=await generateKeyPair('RS256'),resolver=async()=>a.publicKey;
 const jwt=async(change:Record<string,unknown>={},key=a.privateKey)=>new SignJWT({type:'app',sub:'subject',email:'Owner@example.com',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,iss:issuer,aud,...change}).setProtectedHeader({alg:'RS256',kid:'one'}).sign(key);
 assert.equal((await verifyIdentity(await jwt(),issuer,aud,resolver)).email,'owner@example.com');
 for(const change of [{aud:'wrong'},{iss:'https://attacker.example'},{exp:1},{iat:9999999999},{sub:null},{type:'service'},{service_token_id:'machine'}])await assert.rejects(()=>jwt(change).then(t=>verifyIdentity(t,issuer,aud,resolver)),/unauthorized/);
 await assert.rejects(()=>jwt({},b.privateKey).then(t=>verifyIdentity(t,issuer,aud,resolver)),/unauthorized/);
 await assert.rejects(()=>verifyIdentity('malformed',issuer,aud,resolver),/unauthorized/);
});
test('live admin remains disabled without explicit database, Access and MFA setup',()=>{const old={...process.env};try{
 process.env.ADMIN_ENABLED='true';process.env.DATABASE_URL='postgres://configured';process.env.CF_ACCESS_ISSUER=issuer;process.env.CF_ACCESS_AUD=aud;delete process.env.CF_ACCESS_MFA_REQUIRED;assert.equal(adminConfigured(),false);
 process.env.CF_ACCESS_MFA_REQUIRED='true';assert.equal(adminConfigured(),true);
 process.env.CF_ACCESS_ISSUER='https://attacker.example';assert.equal(adminConfigured(),false);
 }finally{process.env=old;}});
test('production rejects legacy shared-token admin and all sandbox settlement routes',async()=>{
 const { api }=await import('../src/api');const old={...process.env};try{
  process.env.NODE_ENV='production';process.env.PAYMENT_MODE='sandbox';process.env.DATABASE_URL='postgres://localhost/unconnected';
  process.env.ADMIN_ENABLED='true';process.env.CF_ACCESS_MFA_REQUIRED='true';process.env.CF_ACCESS_ISSUER=issuer;process.env.CF_ACCESS_AUD=aud;process.env.ADMIN_API_TOKEN='x'.repeat(32);
  const headers={Authorization:'Bearer '+'x'.repeat(32)};
  assert.equal((await api(new Request('https://venue.example/api/admin/me',{headers}))).status,401);
  assert.equal((await api(new Request('https://venue.example/api/catalog'))).status,503);
  assert.equal((await api(new Request('https://venue.example/api/sandbox/123/settle',{method:'POST'}))).status,503);
  delete process.env.CF_ACCESS_MFA_REQUIRED;
  assert.equal((await api(new Request('https://venue.example/api/admin/me',{headers}))).status,503);
 }finally{process.env=old;}
});
