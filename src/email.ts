export type EmailMessage={from:string;to:string[];subject:string;html:string;text:string};
export interface EmailProvider {send(message:EmailMessage,key:string):Promise<string>}
export class EmailFailure extends Error {constructor(public code:string,public retryable:boolean){super(code);}}
export class ResendEmail implements EmailProvider {
 constructor(private apiKey:string,private request:typeof fetch=fetch){if(!apiKey)throw Error('RESEND_API_KEY is required');}
 async send(message:EmailMessage,key:string){
  let response:Response;
  try{response=await this.request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)});}
  catch{throw new EmailFailure('provider_unreachable',true);}
  if(!response.ok)throw new EmailFailure('provider_http_'+response.status,response.status===429||response.status>=500);
  let result:any;try{result=await response.json();}catch{throw new EmailFailure('provider_response_invalid',true);}
  if(typeof result.id!=='string'||!result.id)throw new EmailFailure('provider_response_invalid',true);
  return result.id;
 }
}
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(s:string)=>new Date(s).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'});
const money=(n:number)=>new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB'}).format(n/100);
export function renderEmail(kind:string,b:any,payload:any,from:string,origin:string):EmailMessage{
 const site=new URL(origin);
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)||site.protocol!=='https:'||site.username||site.password||site.pathname!=='/'||site.search||site.hash)throw Error('Verified EMAIL_FROM and HTTPS APP_ORIGIN are required');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(b.customer.email))throw new EmailFailure('invalid_recipient',false);
 const title=kind==='booking_confirmed'?'Booking confirmed':kind==='extension_confirmed'?'Extension confirmed':kind==='event_reminder'?'Your event reminder':null;
 if(!title)throw new EmailFailure('unsupported_notification',false);
 const snapshot=payload.snapshot??{start:b.start_at,end:b.end_at,quote:b.quote};
 const lines=[title+' — '+b.code,'Hello '+b.customer.name+',',time(snapshot.start)+' → '+time(snapshot.end)+' (Bangkok time)',
  ...snapshot.quote.items.map((i:any)=>i.description+': '+money(Number(i.totalSatang))),
  'Booking total: '+money(Number(snapshot.quote.totalSatang)),
  ...(payload.amountPaidSatang!==undefined?['Verified payment for this transaction: '+money(payload.amountPaidSatang)]:[]),
  snapshot.quote.rules,'Booking details: '+new URL('/booking/'+b.id,origin).toString(),
  'Open booking details in the browser used for checkout. This email is not a tax invoice.'];
 return {from,to:[b.customer.email],subject:title+' — '+b.code,text:lines.join('\n\n'),html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title></head><body style="background:#ffffff;color:#272323"><main style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;max-width:640px;margin:auto;padding:20px"><h1>224 Live House</h1>'+lines.map(l=>'<p>'+escape(l)+'</p>').join('')+'</main></body></html>'};
}
