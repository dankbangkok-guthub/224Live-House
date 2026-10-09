import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, integer } from './domain';
export type SandboxEvent = {id:string;paymentId:string;sessionId:string;currency:string;amountSatang:number;quoteDigest:string;status:'paid'|'failed'};
export function signSandboxEvent(raw:string,secret:string) {
  if(secret.length<32) throw new Error('Sandbox webhook secret must contain at least 32 characters');
  return createHmac('sha256',secret).update(raw).digest('hex');
}
export function verifySandboxEvent(raw:string,signature:string,secret:string):SandboxEvent {
  if(raw.length>10000 || !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signSandboxEvent(raw,secret)),Buffer.from(signature)))
    throw new DomainError('invalid_signature',401);
  let e:SandboxEvent;
  try {e=JSON.parse(raw);}catch {throw new DomainError('invalid_event',400);}
  if(!e || typeof e.id!=='string' || e.id.length>200 || !e.id ||
    !/^[a-f0-9-]{36}$/.test(e.paymentId) || typeof e.sessionId!=='string' ||
    !['paid','failed'].includes(e.status) || typeof e.currency!=='string' ||
    typeof e.quoteDigest!=='string') throw new DomainError('invalid_event',400);
  integer(e.amountSatang,1);
  return e;
}
