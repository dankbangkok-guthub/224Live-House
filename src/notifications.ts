import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from './database';
import { EmailFailure, renderEmail, type EmailProvider } from './email';
export class Notifications {
 constructor(private pool:Pool,private provider:EmailProvider,private config:{from:string;origin:string;reminderHours:number},private clock=()=>new Date()){
  if(!Number.isInteger(config.reminderHours)||config.reminderHours<1||config.reminderHours>168)throw Error('REMINDER_HOURS must be between 1 and 168');
 }
 async reminders(){
  const now=this.clock();
  // Capture a schedule-specific reminder key; retries and repeated cron runs cannot enqueue duplicates.
  return this.pool.query(`INSERT INTO outbox(id,logical_key,kind,booking_id,payload)
    SELECT gen_random_uuid(),'reminder:'||id::text||':'||start_at::text,'event_reminder',id,
    jsonb_build_object('expectedStart',start_at,'snapshot',jsonb_build_object('start',start_at,'end',end_at,'quote',quote))
    FROM bookings WHERE status='confirmed' AND start_at>$1 AND start_at<=$2
    ON CONFLICT(logical_key) DO NOTHING`,[now,new Date(now.getTime()+this.config.reminderHours*3600000)]);
 }
 private async claim(){
  return transaction(this.pool,async db=>{
   const now=this.clock();
   const job=(await db.query(`SELECT * FROM outbox WHERE delivered_at IS NULL AND
    ((status='pending' AND next_attempt_at<=$1) OR (status='sending' AND lease_until<=$1))
    ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,[now])).rows[0];
   if(!job)return null;
   // Provider idempotency lasts 24h; stop ambiguous resends before that window closes.
   if(job.attempts>=8||(job.first_attempt_at&&now.getTime()-new Date(job.first_attempt_at).getTime()>=20*3600000)){
    await db.query("UPDATE outbox SET status='manual_review',last_error='retry_window_exhausted',lease_until=NULL WHERE id=$1",[job.id]);return {skipped:true};
   }
   const b=(await db.query('SELECT * FROM bookings WHERE id=$1 FOR SHARE',[job.booking_id])).rows[0];
   const staleReminder=job.kind==='event_reminder'&&(new Date(job.payload.expectedStart).getTime()!==new Date(b.start_at).getTime()||new Date(b.start_at).getTime()<=now.getTime());
   if(!['confirmed','in_progress','completed'].includes(b.status)||staleReminder){
    await db.query("UPDATE outbox SET status='skipped',last_error='booking_no_longer_eligible',lease_until=NULL WHERE id=$1",[job.id]);return {skipped:true};
   }
   let message=job.message;
   try{message??=renderEmail(job.kind,b,job.payload,this.config.from,this.config.origin);}
   catch(error){await db.query("UPDATE outbox SET status='manual_review',last_error=$2 WHERE id=$1",[job.id,error instanceof EmailFailure?error.code:'email_configuration_invalid']);return {skipped:true};}
   const lease=randomUUID();
   await db.query(`UPDATE outbox SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,$2),lease_token=$3,lease_until=$4,message=$5 WHERE id=$1`,
    [job.id,now,lease,new Date(now.getTime()+120000),message]);
   return {job:{...job,attempts:job.attempts+1},message,lease};
  });
 }
 async drain(limit=10){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid notification batch size');
  let accepted=0,reviewOrSkipped=0;
  for(let i=0;i<limit;i++){
   const claim=await this.claim();if(!claim)break;if('skipped' in claim){reviewOrSkipped++;continue;}
   const {job,message,lease}=claim;
   try{
    const providerId=await this.provider.send(message,'224-email-'+job.id);
    await this.pool.query("UPDATE outbox SET status='accepted',delivered_at=$3,provider_message_id=$4,last_error=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='sending'",[job.id,lease,this.clock(),providerId]);accepted++;
   }catch(error){
    const failure=error instanceof EmailFailure?error:new EmailFailure('delivery_result_unknown',true);
    const retry=failure.retryable&&job.attempts<8;
    await this.pool.query('UPDATE outbox SET status=$3,next_attempt_at=$4,last_error=$5,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status=\'sending\'',
     [job.id,lease,retry?'pending':'manual_review',new Date(this.clock().getTime()+Math.min(60,2**job.attempts)*60000),failure.code]);
   }
  }
  return {accepted,reviewOrSkipped};
 }
}
