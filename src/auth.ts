import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { DomainError } from './domain';
export type Identity={email:string;role:'owner'|'manager'|'staff';unitId:string|null};
export function adminConfigured(){return !!process.env.DATABASE_URL && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(process.env.CF_ACCESS_ISSUER??'') && !!process.env.CF_ACCESS_AUD && process.env.ADMIN_ENABLED==='true' && process.env.CF_ACCESS_MFA_REQUIRED==='true';}
const keysets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export async function verifyIdentity(token:string,issuer:string,audience:string,key?:JWTVerifyGetKey){
 try{
  if(!token || token.length>12000)throw Error();
  if(!key){if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))throw Error();key=keysets.get(issuer);if(!key){key=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:5000});keysets.set(issuer,key as ReturnType<typeof createRemoteJWKSet>);}}
  const {payload}=await jwtVerify(token,key,{issuer,audience,algorithms:['RS256'],requiredClaims:['sub','email','exp','iat']});
  if(typeof payload.email!=='string'||typeof payload.sub!=='string'||!payload.sub||!Number.isSafeInteger(payload.iat)||payload.iat!>Date.now()/1000+30||payload.type!=='app'||payload.service_token_id)throw Error();
  // MFA is enforced by the Access application/policy, not inferred from an unsigned email header.
  return {email:payload.email.toLowerCase(),subject:payload.sub,issuedAt:payload.iat!};
 }catch{throw new DomainError('unauthorized',401);}
}
export async function adminIdentity(request:Request,pool:Pool):Promise<Identity>{
 if(process.env.NODE_ENV!=='production'&&process.env.PAYMENT_MODE==='sandbox'){
  const configured=process.env.ADMIN_API_TOKEN??'', candidate=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  const a=Buffer.from(configured),b=Buffer.from(candidate);
  if(configured.length>=32&&a.length===b.length&&timingSafeEqual(a,b))return {email:'development-admin',role:'owner',unitId:null};
 }
 if(!adminConfigured())throw new DomainError('admin_not_configured',503);
 const who=await verifyIdentity(request.headers.get('cf-access-jwt-assertion')??'',process.env.CF_ACCESS_ISSUER!,process.env.CF_ACCESS_AUD!);
 return accountIdentity(pool,who);
}
export async function accountIdentity(pool:Pool,who:{email:string;subject:string;issuedAt:number}):Promise<Identity>{
 const result=await pool.query(`UPDATE admin_accounts SET subject=COALESCE(subject,$2)
  WHERE email=$1 AND active=true AND (subject IS NULL OR subject=$2) AND valid_after<$3 RETURNING email,role,unit_id`,[who.email,who.subject,who.issuedAt]);
 const a=result.rows[0];if(!a)throw new DomainError('account_disabled_or_not_invited',403);
 return {email:a.email,role:a.role,unitId:a.unit_id};
}
export function requireRole(who:Identity,roles:Identity['role'][]){if(!roles.includes(who.role))throw new DomainError('forbidden',403);}
