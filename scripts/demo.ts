import { database } from '../src/database';
import { VenueEngine } from '../src/engine';
if(process.env.NODE_ENV==='production' || process.env.ALLOW_DEMO_SEED!=='yes')
  throw new Error('Set ALLOW_DEMO_SEED=yes only for an isolated development database.');
const {pool}=database(process.env.DATABASE_URL??''), e=new VenueEngine(pool);
const schedule={weekly:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i),[{start:540,end:1560}]]))};
try{
  await e.configureSpace({id:'studio',name:'224 Live House — DEMO space',capacity:30,published:true,
    config:{baseSatang:120000,otSatang:150000,maxHours:12,slotMinutes:30,setupMinutes:30,cleanupMinutes:30,
      leadMinutes:60,horizonDays:90,holdMinutes:10,policyVersion:'DEMO-1',
      rules:'DEMO terms only. No real booking or payment. Actual venue rules, cancellation and privacy terms must be supplied before launch.',schedule}},'demo_seed');
  await e.provisionPool({id:'concierge',name:'DEMO concierge team',kind:'concierge',
    units:[{id:'assistant-one',shifts:schedule},{id:'assistant-two',shifts:schedule}]},'demo_seed');
  await e.provisionPool({id:'microphones',name:'DEMO microphones',kind:'inventory',units:[{id:'mic-one'},{id:'mic-two'}]},'demo_seed');
  for(const service of [
    {id:'concierge',name:'Dedicated concierge',poolId:'concierge',priceType:'hour' as const,priceSatang:50000,
      description:'Full-event coverage. Guest welcome, setup support and approved venue tasks.'},
    {id:'microphone',name:'Microphone & AV',poolId:'microphones',priceType:'unit' as const,priceSatang:30000,
      description:'A reserved microphone unit for your event.'},
    {id:'decoration',name:'Event decoration',poolId:null,priceType:'request_quote' as const,priceSatang:0,
      description:'Requires a separate approved quotation; unavailable for instant purchase.'}
  ]) await e.configureService({id:service.id,name:service.name,poolId:service.poolId,published:true,
    config:{priceType:service.priceType,priceSatang:service.priceSatang,min:1,max:2,setupMinutes:0,cleanupMinutes:0,
      leadMinutes:60,allowedSpaces:['studio'],description:service.description}},'demo_seed');
  console.log('DEMO fixtures created. Rates are illustrative, not approved venue prices.');
}finally{await pool.end();}
