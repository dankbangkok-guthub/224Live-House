import test from 'node:test';
import assert from 'node:assert/strict';
import { ResendEmail, renderEmail } from '../src/email';
import { notificationJob } from '../src/jobs';
test('email escapes customer text and uses Bangkok time without access tokens',()=>{
 const b={id:'example',code:'224-TEST',start_at:'2030-01-01T11:00Z',end_at:'2030-01-01T13:00Z',customer:{name:'<script>unsafe</script>',email:'test@example.com'},quote:{items:[],totalSatang:240000,rules:'No <b>HTML</b>'}};
 const message=renderEmail('booking_confirmed',b,{amountPaidSatang:240000},'venue@example.com','https://venue.example');
 assert.ok(!message.html.includes('<script>'));assert.match(message.html,/&lt;script&gt;/);
 assert.match(message.text,/18:00/);assert.match(message.text,/Verified payment/);
 assert.match(message.text,/https:\/\/venue.example\/booking\/example/);assert.ok(!message.text.includes('token='));
});
test('email adapter keeps provider key stable and classifies uncertain failures',async()=>{
 const message={from:'venue@example.com',to:['test@example.com'],subject:'test',html:'test',text:'test'};
 const requests:any[]=[];
 const provider=new ResendEmail('isolated-test-key',async(_url,options)=>{requests.push(options);return Response.json({id:'email-1'});});
 assert.equal(await provider.send(message,'stable-key'),'email-1');await provider.send(message,'stable-key');
 assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
 for(const status of [429,500,401]){
  const p=new ResendEmail('test',async()=>new Response('',{status}));
  await assert.rejects(()=>p.send(message,'key'),(e:any)=>e.retryable===(status!==401));
 }
 const p=new ResendEmail('test',async()=>{throw Error('secret must not be logged');});
 await assert.rejects(()=>p.send(message,'key'),(e:any)=>e.code==='provider_unreachable'&&e.retryable);
});
test('disabled email job makes no database connection and sends nothing',async()=>{
 assert.deepEqual(await notificationJob({EMAIL_ENABLED:'false',DATABASE_URL:'invalid'}),{enabled:false});
 await assert.rejects(()=>notificationJob({EMAIL_ENABLED:'true'}),/configuration is incomplete/);
});
