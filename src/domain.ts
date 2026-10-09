export class DomainError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export type Window = { start: number; end: number }; // local minutes; end may exceed 1440
export type Schedule = {
  weekly: Record<string, Window[]>;
  overrides?: Record<string, Window[]>;
};
export type SpaceConfig = {
  baseSatang: number; otSatang: number; maxHours: number;
  slotMinutes: number; setupMinutes: number; cleanupMinutes: number;
  leadMinutes: number; horizonDays: number; holdMinutes: number;
  policyVersion: string; rules: string; schedule: Schedule;
};
export type ServiceConfig = {
  priceType: 'fixed' | 'unit' | 'hour' | 'request_quote';
  priceSatang: number; min: number; max: number;
  setupMinutes: number; cleanupMinutes: number; leadMinutes: number;
  allowedSpaces: string[]; schedule?: Schedule;
  image?: string; video?: string; poster?: string; description?: string;
};
export type Space = { id: string; name: string; capacity: number; version: number; config: SpaceConfig };
export type Service = { id: string; name: string; version: number; pool_id: string | null; config: ServiceConfig };
export type Selection = { id: string; quantity: number };
export type RequestInput = { spaceId: string; startLocal: string; hours: number; guests: number; services: Selection[] };
export type Quote = {
  spaceId: string; start: string; end: string; occupiedStart: string; occupiedEnd: string;
  hours: number; guests: number; currency: 'THB'; totalSatang: number;
  policyVersion: string; rules: string; spaceVersion: number;
  items: { kind: string; description: string; quantity: number; unitSatang: number; totalSatang: number }[];
  services: { id: string; quantity: number; version: number; poolId: string | null; start: string; end: string }[];
};
export const MINUTE = 60000;
export function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw new DomainError('invalid_number', 400);
  return value;
}
export function localInstant(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new DomainError('invalid_local_time', 400);
  const result = new Date(value + ':00+07:00');
  if (!Number.isFinite(result.getTime()) || localText(result) !== value)
    throw new DomainError('invalid_local_time', 400);
  return result;
}
export function localText(date: Date) { return new Date(date.getTime() + 420 * MINUTE).toISOString().slice(0,16); }
function datePart(date: Date) { return localText(date).slice(0,10); }
function windows(schedule: Schedule, day: string): Window[] {
  const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
  return schedule.overrides?.[day] ?? schedule.weekly[String(weekday)] ?? [];
}
export function validateSchedule(schedule: Schedule) {
  if (!schedule || typeof schedule.weekly !== 'object' || !schedule.weekly) throw new DomainError('invalid_schedule',400);
  for (const [key, ws] of Object.entries(schedule.weekly)) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(ws)) throw new DomainError('invalid_schedule',400);
  }
  for (const [key, ws] of Object.entries(schedule.overrides ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(ws)) throw new DomainError('invalid_schedule',400);
    localInstant(key+'T00:00');
  }
  for (const ws of [...Object.values(schedule.weekly), ...Object.values(schedule.overrides ?? {})])
    for (const w of ws) {
      integer(w.start,0,1439); integer(w.end,w.start+1,2880);
    }
}
// A special-date override replaces all opening segments on that civil date,
// including an overnight segment inherited from the previous day.
export function scheduleContains(schedule: Schedule, start: Date, end: Date): boolean {
  validateSchedule(schedule);
  if (end <= start) return false;
  const firstDay = datePart(new Date(start.getTime() - 1440*MINUTE));
  const lastDay = datePart(end);
  const segments: [number,number][] = [];
  for (let day = firstDay; day <= lastDay; day = new Date(new Date(day+'T00:00Z').getTime()+1440*MINUTE).toISOString().slice(0,10)) {
    const base = localInstant(day+'T00:00').getTime();
    const own = windows(schedule,day);
    const prevDay = new Date(new Date(day+'T00:00Z').getTime()-1440*MINUTE).toISOString().slice(0,10);
    const hasOverride = Object.prototype.hasOwnProperty.call(schedule.overrides ?? {},day);
    const incoming = hasOverride ? [] : windows(schedule,prevDay).filter(w=>w.end>1440)
      .map(w=>({start:0,end:w.end-1440}));
    for (const w of [...own,...incoming]) {
      // Split overnight windows; the next civil date applies its override independently.
      segments.push([base+w.start*MINUTE, base+Math.min(w.end,1440)*MINUTE]);
    }
  }
  segments.sort((a,b)=>a[0]-b[0]);
  let cursor = start.getTime();
  for (const [a,b] of segments) {
    if (a > cursor) break;
    if (b > cursor) cursor = b;
    if (cursor >= end.getTime()) return true;
  }
  return false;
}
export function validateSpace(config: SpaceConfig) {
  integer(config.baseSatang,1); integer(config.otSatang,1);
  integer(config.maxHours,2,24); integer(config.slotMinutes,1,60);
  if (60 % config.slotMinutes) throw new DomainError('invalid_slot_interval',400);
  integer(config.setupMinutes,0,1440); integer(config.cleanupMinutes,0,1440);
  integer(config.leadMinutes,0); integer(config.horizonDays,1,730);
  integer(config.holdMinutes,1,60); validateSchedule(config.schedule);
  if (!config.policyVersion || !config.rules) throw new DomainError('policy_required',400);
}
export function validateService(config: ServiceConfig) {
  if (!['fixed','unit','hour','request_quote'].includes(config.priceType)) throw new DomainError('invalid_price_type',400);
  integer(config.priceSatang,0); integer(config.min,1,100); integer(config.max,config.min,100);
  integer(config.setupMinutes,0,1440); integer(config.cleanupMinutes,0,1440); integer(config.leadMinutes,0);
  if (!Array.isArray(config.allowedSpaces)) throw new DomainError('invalid_service_spaces',400);
  if(config.description!==undefined&&(typeof config.description!=='string'||config.description.length>3000))throw new DomainError('invalid_description',400);
  for(const value of [config.image,config.video,config.poster])if(value!==undefined&&value!==''){
    if(typeof value!=='string'||value.length>2000||(!/^https:\/\//.test(value)&&!/^\/(?!\/)/.test(value)))throw new DomainError('invalid_media_url',400);
  }
  if (config.schedule) validateSchedule(config.schedule);
}
export function quote(space: Space, services: Service[], input: RequestInput, now = new Date()): Quote {
  validateSpace(space.config);
  const c = space.config;
  integer(input.hours,2,c.maxHours); integer(input.guests,1,space.capacity);
  if (!Array.isArray(input.services) || input.services.length>30) throw new DomainError('invalid_services',400);
  const start = localInstant(input.startLocal);
  if (start.getTime() < now.getTime()+c.leadMinutes*MINUTE || start.getTime()>now.getTime()+c.horizonDays*1440*MINUTE)
    throw new DomainError('outside_booking_horizon',400);
  if (+input.startLocal.slice(14,16) % c.slotMinutes) throw new DomainError('invalid_start_increment',400);
  const end = new Date(start.getTime()+input.hours*60*MINUTE);
  const items: Quote['items'] = [];
  const add = (kind: string, description: string, quantity: number, unitSatang: number) => {
    const totalSatang = integer(quantity*unitSatang,0);
    items.push({kind,description,quantity,unitSatang,totalSatang});
  };
  add('rental',space.name+' — first 2 hours',2,c.baseSatang);
  for (let i=2;i<input.hours;i++) add('ot','Extra hour '+(i-1),1,c.otSatang);
  let setup = c.setupMinutes, cleanup = c.cleanupMinutes;
  const requirements: Quote['services'] = [];
  const seen = new Set<string>();
  for (const chosen of input.services) {
    if (seen.has(chosen.id)) throw new DomainError('duplicate_service',400);
    seen.add(chosen.id);
    const service = services.find(s=>s.id===chosen.id);
    if (!service) throw new DomainError('service_unavailable',400);
    const sc = service.config; validateService(sc);
    integer(chosen.quantity,sc.min,sc.max);
    if (sc.priceType==='request_quote') throw new DomainError('service_requires_approval');
    if (!sc.allowedSpaces.includes(space.id)) throw new DomainError('service_wrong_space',400);
    if (start.getTime()<now.getTime()+sc.leadMinutes*MINUTE) throw new DomainError('service_lead_time');
    const a = new Date(start.getTime()-sc.setupMinutes*MINUTE);
    const b = new Date(end.getTime()+sc.cleanupMinutes*MINUTE);
    if (sc.schedule && !scheduleContains(sc.schedule,a,b)) throw new DomainError('service_closed');
    if (sc.priceType==='fixed' && chosen.quantity!==1) throw new DomainError('fixed_service_quantity',400);
    add('service',service.name,chosen.quantity*(sc.priceType==='hour'?input.hours:1),sc.priceSatang);
    // Conservative sequential preparation/cleanup until owner explicitly defines parallel work.
    setup += sc.setupMinutes; cleanup += sc.cleanupMinutes;
    requirements.push({id:service.id,quantity:chosen.quantity,version:service.version,poolId:service.pool_id,start:a.toISOString(),end:b.toISOString()});
  }
  const occupiedStart = new Date(start.getTime()-setup*MINUTE);
  const occupiedEnd = new Date(end.getTime()+cleanup*MINUTE);
  if (!scheduleContains(c.schedule,occupiedStart,occupiedEnd)) throw new DomainError('closed_period');
  const totalSatang = integer(items.reduce((sum,item)=>integer(sum+item.totalSatang,0),0),1);
  return {spaceId:space.id,start:start.toISOString(),end:end.toISOString(),occupiedStart:occupiedStart.toISOString(),
    occupiedEnd:occupiedEnd.toISOString(),hours:input.hours,guests:input.guests,currency:'THB',totalSatang,
    policyVersion:c.policyVersion,rules:c.rules,spaceVersion:space.version,items,services:requirements};
}
