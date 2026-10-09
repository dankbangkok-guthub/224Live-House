import { database } from '../src/database';
import { VenueEngine } from '../src/engine';
if(process.env.NODE_ENV==='production' || process.env.PAYMENT_MODE!=='sandbox')
  throw new Error('This expiry job is sandbox-only; live payments require provider reconciliation.');
const {pool}=database(process.env.DATABASE_URL??'');
try{console.log(await new VenueEngine(pool).expireSandboxHolds());}finally{await pool.end();}
