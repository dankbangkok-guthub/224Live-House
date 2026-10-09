import { notificationJob } from '../src/jobs';
console.log(await notificationJob(process.env));
