import { createHash } from 'node:crypto';
import { Webhook } from 'svix';
import type { Pool, PoolClient } from 'pg';
import { database, transaction } from './database';
import { DomainError } from './domain';

const statuses:Record<string,string>={'email.sent':'accepted','email.delivery_delayed':'delayed','email.failed':'failed','email.delivered':'delivered','email.suppressed':'suppressed','email.bounced':'bounced','email.complained':'complained'};
const rank:Record<string,number>={accepted:1,delayed:2,failed:3,delivered:4,suppressed:5,bounced:6,complained:7};
export const recipientDigest=(email:string)=>createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
export type DeliveryEvent={id:string;digest:string;messageId:string;status:string;at:Date};
export function verifyDelivery(raw:string,headers:Headers,secret:string):DeliveryEvent|null{
 if(Buffer.byteLength(raw)>20000)throw new DomainError('request_too_large',413);
 let payload:any;
 try{new Webhook(secret).verify(raw,{'svix-id':headers.get('svix-id')??'','svix-timestamp':headers.get('svix-timestamp')??'','svix-signature':headers.get('svix-signature')??''});}
 catch{throw new DomainError('invalid_email_signature',401);}
 try{payload=JSON.parse(raw);}catch{throw new DomainError('invalid_email_event',400);}
 const status=statuses[payload?.type];if(!status)return null;
 const id=headers.get('svix-id')??'',messageId=payload.data?.email_id,at=new Date(payload.created_at);
 if(!id||id.length>200||typeof messageId!=='string'||!messageId||messageId.length>200||!Number.isFinite(at.getTime()))throw new DomainError('invalid_email_event',400);
 return {id,digest:createHash('sha256').update(raw).digest('hex'),messageId,status,at};
}
export class EmailDelivery {
 constructor(private pool:Pool){}
 private async lock(db:PoolClient,id:string){await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['224:email:'+id]);}
 private async apply(db:PoolClient,id:string){
  const job=(await db.query('SELECT id,message FROM outbox WHERE provider_message_id=$1 FOR UPDATE',[id])).rows[0];
  if(!job)return;
  const events=(await db.query('SELECT status,event_at FROM email_delivery_events WHERE provider_message_id=$1',[id])).rows;
  // Delivery evidence cannot regress to sent/delayed; complaint/bounce suppression is never cleared by reordered events.
  events.sort((a,b)=>rank[b.status]-rank[a.status]||new Date(b.event_at).getTime()-new Date(a.event_at).getTime());
  const latest=events[0];if(!latest)return;
  await db.query('UPDATE outbox SET delivery_status=$2,delivery_event_at=$3 WHERE id=$1',[job.id,latest.status,latest.event_at]);
  if(['suppressed','bounced','complained'].includes(latest.status)){
   for(const email of job.message?.to??[])await db.query('INSERT INTO email_suppressions(recipient_digest,reason) VALUES($1,$2) ON CONFLICT(recipient_digest) DO UPDATE SET reason=EXCLUDED.reason',[recipientDigest(email),latest.status]);
  }
 }
 async record(event:DeliveryEvent){
  return transaction(this.pool,async db=>{
   await this.lock(db,event.messageId);
   const result=await db.query('INSERT INTO email_delivery_events(event_id,digest,provider_message_id,status,event_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING RETURNING event_id',[event.id,event.digest,event.messageId,event.status,event.at]);
   if(!result.rows.length){
    const existing=(await db.query('SELECT digest FROM email_delivery_events WHERE event_id=$1',[event.id])).rows[0];
    if(existing.digest!==event.digest)throw new DomainError('email_event_conflict',409);
   }
   await this.apply(db,event.messageId);return {received:true,duplicate:!result.rows.length};
  });
 }
 async accepted(id:string,lease:string,at:Date,providerId:string){
  await transaction(this.pool,async db=>{
   await this.lock(db,providerId);
   await db.query("UPDATE outbox SET status='accepted',delivered_at=$3,delivery_status='accepted',provider_message_id=$4,last_error=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='sending'",[id,lease,at,providerId]);
   // A callback may arrive before the send response is saved. Apply its persisted evidence atomically now.
   await this.apply(db,providerId);
  });
 }
}
export async function emailWebhook(request:Request){
 if(process.env.EMAIL_WEBHOOK_ENABLED!=='true'||!process.env.RESEND_WEBHOOK_SECRET||!process.env.DATABASE_URL)throw new DomainError('email_webhook_not_configured',503);
 if(request.method!=='POST')throw new DomainError('method_not_allowed',405);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('json_required',415);
 const reader=request.body?.getReader();if(!reader)throw new DomainError('invalid_email_event',400);
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>20000){await reader.cancel();throw new DomainError('request_too_large',413);}chunks.push(value);}
 const event=verifyDelivery(Buffer.concat(chunks).toString('utf8'),request.headers,process.env.RESEND_WEBHOOK_SECRET);
 if(!event)return {received:true,ignored:true};
 const db=database(process.env.DATABASE_URL);
 try{return await new EmailDelivery(db.pool).record(event);}finally{await db.pool.end();}
}
