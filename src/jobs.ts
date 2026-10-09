import { database } from './database';
import { ResendEmail } from './email';
import { Notifications } from './notifications';
export async function notificationJob(env:Record<string,string|undefined>){
 if(env.EMAIL_ENABLED!=='true')return {enabled:false};
 if(!env.DATABASE_URL||!env.RESEND_API_KEY||!env.EMAIL_FROM||!env.APP_ORIGIN)throw Error('Notification runtime configuration is incomplete');
 const db=database(env.DATABASE_URL,env.DATABASE_DRIVER??'pg');
 try{
  const queue=new Notifications(db.pool,new ResendEmail(env.RESEND_API_KEY),{from:env.EMAIL_FROM,origin:env.APP_ORIGIN,reminderHours:Number(env.REMINDER_HOURS??24)});
  await queue.reminders();return {enabled:true,...await queue.drain()};
 }finally{await db.pool.end();}
}
