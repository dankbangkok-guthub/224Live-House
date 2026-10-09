import { randomUUID } from 'node:crypto';
import { database } from './database';
import { VenueEngine } from './engine';
import { DomainError, localInstant } from './domain';
import { verifySandboxEvent } from './payments';

import { adminConfigured, adminIdentity, requireRole } from './auth';
import { Operations } from './operations';

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
  let db:ReturnType<typeof database>|undefined;
  try {
    if(path==='/api/health') return send({service:'224-live-house',mode:sandboxEnabled()?'development-sandbox':'configuration-required',adminMode:adminConfigured()?'access':'configuration-required'});
    if(!sandboxEnabled() && !(path.startsWith('/api/admin/')&&adminConfigured())) throw new DomainError('production_not_configured',503);
    const origin=process.env.APP_ORIGIN??url.origin;
    if(request.method!=='GET' && path!=='/api/payments/webhook/sandbox') {
      if(request.headers.get('origin')!==origin) throw new DomainError('invalid_origin',403);
      if(!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('json_required',415);
    }
    db=database(process.env.DATABASE_URL??'');
    const e=new VenueEngine(db.pool);
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
      const who=await adminIdentity(request,e.pool),ops=new Operations(e.pool);
      if(request.method==='GET'&&path==='/api/admin/me')return send(who);
      if(request.method==='GET'&&path==='/api/admin/assignments')return send(await ops.assignments(who));
      if(request.method==='POST'&&path==='/api/admin/tasks')return send(await ops.task(await body(),who));
      requireRole(who,['owner','manager']);
      if(request.method==='GET'&&path==='/api/admin/catalog')return send(await ops.catalog(who));
      if(request.method==='GET'&&path==='/api/admin/staff')return send(await ops.staff(who));
      if(request.method==='GET'&&path==='/api/admin/payments')return send(await ops.payments(who));
      if(request.method==='GET'&&path==='/api/admin/accounts')return send(await ops.accounts(who));
      if(request.method==='GET'&&path==='/api/admin/audit')return send(await ops.audit(who));
      if(request.method==='GET' && path==='/api/admin/schedule')return send(await e.scheduleOverview(url.searchParams.get('spaceId')??'',url.searchParams.get('date')??''));
      if(request.method==='GET' && path==='/api/admin/spaces')return send((await e.pool.query('SELECT id,name,capacity,config,version,published FROM spaces ORDER BY name')).rows);
      if(request.method==='GET' && path==='/api/admin/bookings') {
        return send((await e.pool.query('SELECT id,code,space_id,start_at,end_at,status,quote,customer FROM bookings ORDER BY start_at LIMIT 200')).rows);
      }
      if(request.method==='POST') {
        const input=await body();
        if(path==='/api/admin/staff')return send(await ops.updateUnit(input,who));
        if(path==='/api/admin/assignments')return send(await ops.assign(input,who));
        if(path==='/api/admin/payment-reviews')return send(await ops.paymentReview(input,who));
        if(path==='/api/admin/accounts')return send(await ops.account(input,who));
        if(path==='/api/admin/spaces')requireRole(who,['owner']);
        if(path==='/api/admin/expire'&&!sandboxEnabled())throw new DomainError('sandbox_only',403);
        if(path==='/api/admin/schedule')return send(await e.updateSchedule(input.spaceId,input.schedule,input.expectedVersion,who.email));
        if(path==='/api/admin/blackouts/release')return send(await e.releaseBlackout(input.spaceId,input.id,who.email));
        if(path==='/api/admin/spaces')return send(await e.configureSpace(input,who.email));
        if(path==='/api/admin/services')return send(await e.configureService(input,who.email));
        if(path==='/api/admin/resources')return send(await e.provisionPool(input,who.email));
        if(path==='/api/admin/blackouts')return send(await e.blackout(input.spaceId,input.start,input.end,input.reason,who.email));
        if(path==='/api/admin/expire')return send(await e.expireSandboxHolds());
      }
    }
    return send({error:'not_found'},404);
  }catch(error) {
    if(error instanceof DomainError)return send({error:error.code},error.status);
    // No customer data, tokens or payment payloads logged.
    console.error('224 API error', {correlationId:randomUUID(),code:(error as {code?:string}).code??'internal'});
    return send({error:'internal_error'},500);
  }finally{await db?.pool.end();}
}
