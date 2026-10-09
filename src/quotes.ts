import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from './domain';
const MAX_TTL=30*60*1000;
function secretValid(secret:string){if(secret.length<32)throw new Error('QUOTE_SIGNING_SECRET must contain at least 32 characters');}
export function issueQuote(digest:string,secret:string,now:Date,minutes=15){
  secretValid(secret);
  if(!Number.isInteger(minutes)||minutes<1||minutes>30)throw new Error('QUOTE_TTL_MINUTES must be between 1 and 30');
  const expiresAt=new Date(now.getTime()+minutes*60000).toISOString();
  const payload=Buffer.from(JSON.stringify({version:1,digest,issuedAt:now.getTime(),expiresAt:Date.parse(expiresAt)})).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');
  return {quoteToken:payload+'.'+signature,quoteExpiresAt:expiresAt};
}
export function verifyQuote(token:string,digest:string,secret:string,now:Date){
  secretValid(secret);
  if(typeof token!=='string'||token.length>1000)throw new DomainError('invalid_quote',400);
  const parts=token.split('.');
  if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[A-Za-z0-9_-]{43}$/.test(parts[1]))throw new DomainError('invalid_quote',400);
  const expected=createHmac('sha256',secret).update(parts[0]).digest();
  const supplied=Buffer.from(parts[1],'base64url');
  if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))throw new DomainError('invalid_quote',400);
  let claims:any;
  try{claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw new DomainError('invalid_quote',400);}
  if(claims?.version!==1||!Number.isSafeInteger(claims.issuedAt)||!Number.isSafeInteger(claims.expiresAt)
    ||claims.issuedAt>now.getTime()||claims.expiresAt<=claims.issuedAt||claims.expiresAt-claims.issuedAt>MAX_TTL)
    throw new DomainError('invalid_quote',400);
  if(claims.expiresAt<=now.getTime())throw new DomainError('quote_expired');
  if(claims.digest!==digest)throw new DomainError('quote_changed');
}
