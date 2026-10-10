// Public demonstration data only. Never use these values for a payable booking.
import { quote, type RequestInput, type Space, type Service } from './domain';
const space:Space={id:'preview-space',name:'224 Live House · sample space',capacity:40,version:1,config:{
  baseSatang:120000,otSatang:150000,maxHours:8,slotMinutes:30,setupMinutes:30,cleanupMinutes:30,
  leadMinutes:0,horizonDays:365,holdMinutes:15,policyVersion:'preview-only',
  rules:'Illustrative settings only. No venue rules or cancellation terms are agreed, no availability is guaranteed, and no reservation or payment is created.',
  schedule:{weekly:Object.fromEntries(Array.from({length:7},(_,day)=>[String(day),[{start:600,end:1560}]]))}
}};
const service=(id:string,name:string,priceSatang:number,priceType:'hour'|'fixed',description:string):Service=>({
  id,name,version:1,pool_id:null,config:{priceType,priceSatang,min:1,max:1,setupMinutes:0,cleanupMinutes:0,
    leadMinutes:0,allowedSpaces:[space.id],description}
});
export const previewCatalog={spaces:[space],services:[
  service('preview-concierge','Dedicated concierge',50000,'hour','Sample event assistant option; actual staffing and tasks to be configured.'),
  service('preview-decoration','Event decoration',200000,'fixed','Illustrative setup option; inclusions and price are not confirmed.'),
  service('preview-av','AV assistance',100000,'fixed','Illustrative equipment assistance option; equipment is not promised.')
]};
export function previewQuote(input:RequestInput,now=new Date()) {
  if(input.spaceId!==space.id)throw new Error('Unknown preview space');
  return quote(space,previewCatalog.services,input,now);
}
export function previewStartTimes(input:Omit<RequestInput,'startLocal'>,date:string,now=new Date()) {
  if(!date)return [];
  return Array.from({length:48},(_,slot)=>`${String(Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`)
    .filter(time=>{try{previewQuote({...input,startLocal:date+'T'+time},now);return true;}catch{return false;}});
}
