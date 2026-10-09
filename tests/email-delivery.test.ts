import test from 'node:test';
import assert from 'node:assert/strict';
import { Webhook } from 'svix';
import { verifyDelivery, emailWebhook } from '../src/email-delivery';
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
function signed(raw:string,at=new Date()){
 const id='msg_isolated_test';
 return new Headers({'svix-id':id,'svix-timestamp':String(Math.floor(at.getTime()/1000)),'svix-signature':new Webhook(secret).sign(id,at,raw)});
}
test('Resend verification checks exact raw payload, signing key and replay timestamp',()=>{
 const raw=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'provider-1',to:['ignored@example.com']}});
 assert.equal(verifyDelivery(raw,signed(raw),secret)?.status,'delivered');
 assert.throws(()=>verifyDelivery(raw+' ',signed(raw),secret),/invalid_email_signature/);
 assert.throws(()=>verifyDelivery(raw,signed(raw), 'whsec_'+Buffer.alloc(32,8).toString('base64')),/invalid_email_signature/);
 assert.throws(()=>verifyDelivery(raw,signed(raw,new Date(Date.now()-600000)),secret),/invalid_email_signature/);
 assert.throws(()=>verifyDelivery(raw,new Headers(),secret),/invalid_email_signature/);
 const ignored=JSON.stringify({type:'email.opened'});assert.equal(verifyDelivery(ignored,signed(ignored),secret),null);
 assert.throws(()=>verifyDelivery('x'.repeat(20001),new Headers(),secret),/request_too_large/);
});
test('email webhook fails closed before connecting a database when disabled',async()=>{
 const previous=process.env.EMAIL_WEBHOOK_ENABLED;
 process.env.EMAIL_WEBHOOK_ENABLED='false';
 try{await assert.rejects(()=>emailWebhook(new Request('https://venue.example/api/notifications/webhook/resend',{method:'POST'})),/email_webhook_not_configured/);}
 finally{if(previous===undefined)delete process.env.EMAIL_WEBHOOK_ENABLED;else process.env.EMAIL_WEBHOOK_ENABLED=previous;}
});
