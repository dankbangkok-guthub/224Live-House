import { randomUUID, timingSafeEqual } from 'node:crypto';
import { database } from './database';
import { VenueEngine } from './engine';
import { DomainError, localInstant } from './domain';
import { verifySandboxEvent } from './payments';

let singleton: ReturnType<typeof database>|undefined;
function engine() {
  singleton??=database(process.env.DATABASE_URL??'');
  return new VenueEngine(singleton.pool);
}
function admin(request:Request) {
  const configured=process.env.ADMIN_API_TOKEN??'';
  const candidate=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  if(configured.length<32 || candidate.length!==configured.length ||
    !timingSafeEqual(Buffer.from(configured),Buffer.from(candidate))) throw new DomainError('unauthorized',401);
}
function access(request:Request,id:string) {
  const h=request.headers.get('x-booking-token');
  if(h) return h;
  const cookie=request.headers.get('cookie')??'';
  return cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('booking_'+id+'='))?.split('=')[1]??'';
}
function cookie(id:string,token:string,origin:string) {
  return 'booking_'+id+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800'+
    (new URL(origin).protocol==='https:'?'; Secure':'');
}
function sandboxEnabled() {
  // A production bundle can be built; production runtime is fail-closed until a real provider and staff auth are integrated.
  return process.env.NODE_ENV!=='production' && process.env.PAYMENT_MODE==='sandbox';
}
export async function api(request:Request):Promise<Response> {
  const url=new URL(request.url), path=url.pathname.replace(/\/$/,'');
  const send=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
  try {
    if(path==='/api/health') return send({service:'224-live-house',mode:sandboxEnabled()?'development-sandbox':'configuration-required'});
    if(!sandboxEnabled()) throw new DomainError('production_not_configured',503);
    const origin=process.env.APP_ORIGIN??url.origin;
    if(request.method!=='GET' && path!=='/api/payments/webhook/sandbox') {
      if(request.headers.get('origin')!==origin) throw new DomainError('invalid_origin',403);
      if(!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('json_required',415);
    }
    const e=engine();
    const body=async()=> {
      const text=await request.text();
      if(text.length>16000) throw new DomainError('request_too_large',413);
      try{return JSON.parse(text);}catch{throw new DomainError('invalid_json',400);}
    };
    const key=()=>request.headers.get('idempotency-key')??'';
    if(request.method==='GET' && path==='/api/catalog')return send(await e.catalogPublic());
    if(request.method==='GET' && path==='/api/availability') {
      const date=url.searchParams.get('date')??'';localInstant(date+'T00:00');
      return send(await e.availability(url.searchParams.get('spaceId')??'',date,Number(url.searchParams.get('hours')??2),Number(url.searchParams.get('guests')??1)));
    }
    if(request.method==='POST' && path==='/api/quotes')return send(await e.preview(await body()));
    if(request.method==='POST' && path==='/api/bookings/holds') {
      const input=await body(),result=await e.hold(input,key());
      return send(result,201,{'Set-Cookie':cookie(result.id,input.accessToken,origin)});
    }
    let match=path.match(/^\/api\/bookings\/([a-f0-9-]{36})(?:\/(status|checkout|extensions))$/);
    if(match) {
      const id=match[1],token=access(request,id);
      if(request.method==='GET' && match[2]==='status')return send(await e.status(id,token));
      if(request.method==='POST' && match[2]==='checkout') {
        const input=await body();
        return send(await e.checkout(id,token,input.extensionId??null,key(),origin));
      }
      if(request.method==='POST' && match[2]==='extensions') {
        const input=await body();
        return send(await e.requestExtension(id,token,input.hours,key(),input.acceptedPolicyVersion));
      }
    }
    match=path.match(/^\/api\/sandbox\/([a-f0-9-]{36})\/(summary|settle)$/);
    if(match) {
      const p=(await e.pool.query('SELECT * FROM payments WHERE id=$1',[match[1]])).rows[0];
      if(!p)throw new DomainError('payment_not_found',404);
      await e.status(p.booking_id,access(request,p.booking_id));
      if(request.method==='GET' && match[2]==='summary')return send({paymentId:p.id,bookingId:p.booking_id,amountSatang:Number(p.amount_satang),currency:p.currency,status:p.status});
      if(request.method==='POST' && match[2]==='settle') {
        const input=await body();
        if(!['paid','failed'].includes(input.status))throw new DomainError('invalid_payment_status',400);
        const result=await e.verifiedPayment({id:'sandbox-'+p.id+'-'+input.status,paymentId:p.id,sessionId:p.session_id,
          currency:p.currency,amountSatang:Number(p.amount_satang),quoteDigest:p.quote_digest,status:input.status});
        return send({...result,bookingId:p.booking_id});
      }
    }
    if(request.method==='POST' && path==='/api/payments/webhook/sandbox') {
      const raw=await request.text();
      const event=verifySandboxEvent(raw,request.headers.get('x-sandbox-signature')??'',process.env.SANDBOX_WEBHOOK_SECRET??'');
      return send(await e.verifiedPayment(event));
    }
    if(path.startsWith('/api/admin/')) {
      admin(request);
      if(request.method==='GET' && path==='/api/admin/bookings') {
        return send((await e.pool.query('SELECT id,code,space_id,start_at,end_at,status,quote FROM bookings ORDER BY start_at LIMIT 200')).rows);
      }
      if(request.method==='POST') {
        const input=await body();
        if(path==='/api/admin/spaces')return send(await e.configureSpace(input,'admin'));
        if(path==='/api/admin/services')return send(await e.configureService(input,'admin'));
        if(path==='/api/admin/resources')return send(await e.provisionPool(input,'admin'));
        if(path==='/api/admin/blackouts')return send(await e.blackout(input.spaceId,input.start,input.end,input.reason,'admin'));
        if(path==='/api/admin/expire')return send(await e.expireSandboxHolds());
      }
    }
    return send({error:'not_found'},404);
  }catch(error) {
    if(error instanceof DomainError)return send({error:error.code},error.status);
    // No customer data, tokens or payment payloads logged.
    console.error('224 API error', {correlationId:randomUUID(),code:(error as {code?:string}).code??'internal'});
    return send({error:'internal_error'},500);
  }
}
