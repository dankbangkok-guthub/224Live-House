import handler from 'vinext/server/fetch-handler';
import { notificationJob } from './jobs';
export * from 'vinext/server/fetch-handler';
export default {...handler,async scheduled(_event:unknown,env:Record<string,string|undefined>){
 try{await notificationJob(env);}catch{console.error('224 notification job failed; inspect runtime configuration and queue status');}
}};
