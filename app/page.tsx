'use client';
import { useEffect, useRef, useState } from 'react';
import { localText, type Quote } from '../src/domain';
import { BookingCalendar } from './components/booking-calendar';
import { previewCatalog, previewQuote, previewStartTimes } from '../src/booking-preview';
const money=(n:number)=>new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB'}).format(n/100);
async function call(path:string,data?:unknown,key?:string) {
  const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:data===undefined?{}:
    {'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:data===undefined?undefined:JSON.stringify(data)});
  const body=await r.json();
  if(!r.ok)throw new Error(body.error?.replaceAll('_',' ')??'Request failed');
  return body;
}
function newToken() {return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export default function Page() {
  const [step,setStep]=useState<1|2|3>(1),[showManage,setShowManage]=useState(false);
  const stepHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{stepHeading.current?.focus();window.scrollTo({top:0,behavior:'instant'});},[step,showManage]);
  const [demo,setDemo]=useState(false),[previewComplete,setPreviewComplete]=useState(false);
  const [catalog,setCatalog]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [spaceId,setSpace]=useState(''),[date,setDate]=useState(''),[time,setTime]=useState('18:00');
  const [hours,setHours]=useState(2),[guests,setGuests]=useState(1),[selected,setSelected]=useState<Record<string,number>>({});
  const [quoted,setQuote]=useState<{quote:Quote;quoteDigest:string;quoteToken:string;quoteExpiresAt:string}|null>(null),[accepted,setAccepted]=useState(false);
  const [clock,setClock]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const quoteExpired=!!quoted&&clock>=Date.parse(quoted.quoteExpiresAt);
  const [customer,setCustomer]=useState({name:'',email:'',phone:'',eventType:'Private event',notes:''});
  const [booking,setBooking]=useState<any>(null),[extensionHours,setExtensionHours]=useState(1),[manageId,setManageId]=useState('');
  const revision=useRef(0),holdAttempt=useRef<{key:string;token:string;input:any}|null>(null);
  useEffect(()=>{(async()=>{
    const health=await call('/api/health');
    if(health.mode==='configuration-required'){setDemo(true);setCatalog(previewCatalog);setSpace(previewCatalog.spaces[0].id);setDate(localText(new Date(Date.now()+86400000)).slice(0,10));return;}
    const c=await call('/api/catalog');setCatalog(c);if(c.spaces.length)setSpace(c.spaces[0].id);
  })().catch(e=>setError(e.message));},[]);
  const space=catalog?.spaces.find((s:any)=>s.id===spaceId);
  const selection={spaceId,hours,guests,services:Object.entries(selected).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity}))};
  const sampleTimes=demo?previewStartTimes(selection,date):[];
  let sampleQuote:Quote|null=null;
  if(demo&&date){try{sampleQuote=previewQuote({...selection,startLocal:date+'T'+time});}catch{}}
  function invalidate(){setPreviewComplete(false);revision.current++;setQuote(null);setAccepted(false);holdAttempt.current=null;}
  async function preview(){
    setAccepted(false);setPreviewComplete(false);
    const current=++revision.current;setBusy(true);setError('');
    try{if(demo){const q=previewQuote({...selection,startLocal:date+'T'+time});setQuote({quote:q,quoteDigest:'preview-only',quoteToken:'preview-only',quoteExpiresAt:new Date(Date.now()+15*60000).toISOString()});return true;}const q=await call('/api/quotes',{spaceId,startLocal:date+'T'+time,hours,guests,
      services:Object.entries(selected).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity}))});
      if(revision.current===current){setQuote(q);return true;}
    }catch(e){setError((e as Error).message.replaceAll('_',' '));return false;}finally{setBusy(false);}
  }
  async function pay(){
    if(!quoted || !accepted || (quoteExpired&&!holdAttempt.current))return;
    if(demo){setPreviewComplete(true);return;}
    setBusy(true);setError('');
    try{
      holdAttempt.current??={key:crypto.randomUUID(),token:newToken(),input:{spaceId,startLocal:date+'T'+time,hours,guests,
        services:Object.entries(selected).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity})),
        customer,acceptedPolicyVersion:quoted.quote.policyVersion,quoteDigest:quoted.quoteDigest,quoteToken:quoted.quoteToken}};
      const attempt=holdAttempt.current;
      const b=await call('/api/bookings/holds',{...attempt.input,accessToken:attempt.token},attempt.key);
      const p=await call('/api/bookings/'+b.id+'/checkout',{},'checkout-'+attempt.key);
      window.location.assign(p.checkoutUrl);
    }catch(e){const message=(e as Error).message;setError(message);if(['quote expired','quote changed','invalid quote'].includes(message))invalidate();}finally{setBusy(false);}
  }
  async function manage(id:string){
    setBusy(true);setError('');
    try{setBooking(await call('/api/bookings/'+id+'/status'));setManageId(id);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('booking');if(id){setShowManage(true);void manage(id);}},[]);
  async function extend(){
    setBusy(true);setError('');
    try{
      const ext=await call('/api/bookings/'+booking.id+'/extensions',
        {hours:extensionHours,acceptedPolicyVersion:space?.config.policyVersion},crypto.randomUUID());
      const p=await call('/api/bookings/'+booking.id+'/checkout',{extensionId:ext.id},'extension-checkout-'+ext.id);
      window.location.assign(p.checkoutUrl);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function search(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(await preview())setStep(2);
  }
  async function review(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(await preview())setStep(3);
  }
  const total=quoted?.quote.totalSatang??sampleQuote?.totalSatang;
  return <div className="booking-shell"><header><a href="/">224<span>LIVE HOUSE</span></a><button className="text-button" onClick={()=>{setShowManage(!showManage);setError('');}}>{showManage?'Book a space':'My booking'}</button></header>
    <main className={step===1&&!showManage?'search-page':'booking-page'}>
      {error&&<div role="alert" className="error">{error}</div>}
      {!showManage&&<>
      {step>1&&<nav aria-label="Booking progress" className="booking-progress"><ol>{['Search','Services & details','Review & payment'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined}><span>{index+1}</span>{label}</li>)}</ol></nav>}
      {!catalog?<section className="panel search-card"><h1 ref={stepHeading} tabIndex={-1}>Book your private space</h1><p role="status">{error?'Unable to load venue settings. Please refresh to try again.':'Loading search…'}</p></section>:!space?<section className="panel"><h1>Venue setup pending</h1><p>No bookable spaces are published yet.</p></section>:<>
      {step===1&&<form className="panel search-card" onSubmit={search}>
        <h1 ref={stepHeading} tabIndex={-1}>Book your private space</h1>
        <div className="search-fields">
          <BookingCalendar value={date} maxDays={space.config.horizonDays} sample={demo} hasTimes={demo?(day)=>previewStartTimes(selection,day).length>0:undefined} onChange={day=>{invalidate();setDate(day);if(demo){const valid=previewStartTimes(selection,day);if(!valid.includes(time))setTime(valid[0]??'');}}}/>
          <label>Start time{demo?<select required value={time} onChange={e=>{invalidate();setTime(e.target.value);}}><option value="" disabled>Select time</option>{!sampleTimes.includes(time)&&<option value={time} disabled>{time} — unavailable</option>}{sampleTimes.map(t=><option key={t} value={t}>{t}</option>)}</select>:<input required type="time" step={space.config.slotMinutes*60} value={time} onChange={e=>{invalidate();setTime(e.target.value);}}/>}</label>
          <label>Duration<select value={hours} onChange={e=>{invalidate();setHours(Number(e.target.value));}}>{Array.from({length:space.config.maxHours-1},(_,i)=>i+2).map(h=><option key={h} value={h}>{h} hours{h===2?' · minimum':''}</option>)}</select></label>
          <label>Guests<input required type="number" min="1" max={space.capacity} value={guests} onChange={e=>{invalidate();setGuests(Number(e.target.value));}}/></label>
          <button className="primary search-action" disabled={busy||!date||!time||(demo&&!sampleQuote)}>{busy?'Searching…':'Search availability'}<span aria-hidden="true"> →</span></button>
        </div>
        {demo&&!sampleQuote&&<p role="status">Choose a time and duration within the sample opening hours, 10:00–02:00, including 30-minute setup and cleanup buffers.</p>}
      </form>}
      {step===2&&<form id="event-details" onSubmit={review}>
        <div className="step-title"><h1 ref={stepHeading} tabIndex={-1}>Make it yours</h1><p>Choose optional services and tell us about your event.</p></div>
        <div className="trip-strip"><div><strong>224 Live House</strong><span>{date} · {time} · {hours} hours · {guests} guests</span></div><button type="button" onClick={()=>{invalidate();setStep(1);}}>Edit search</button></div>
        {demo&&<p className="preview-note">Preview only. Prices and availability are illustrative; details stay in this page and are not submitted.</p>}
        <section className="panel"><h2>Additional services</h2><div className="service-grid">
          {catalog.services.filter((s:any)=>s.config.allowedSpaces.includes(spaceId)).map((s:any)=><article className="service" key={s.id}>
            {s.config.video&&<video controls preload="none" poster={s.config.poster||s.config.image} aria-label={s.name+' video'} src={s.config.video}/>}
            {s.config.image?<img src={s.config.image} alt={s.name} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>:<div className="service-art" aria-hidden="true">{s.name.slice(0,1)}</div>}
            <h3>{s.name}</h3><p>{s.config.description??'Optional event service'}</p><strong>{s.config.priceType==='request_quote'?'Request approval':money(s.config.priceSatang)+(s.config.priceType==='hour'?' / hour':'')}</strong>
            {s.config.priceType!=='request_quote'&&<label>Quantity<input type="number" min="0" max={s.config.max} value={selected[s.id]??0} onChange={e=>{invalidate();setSelected({...selected,[s.id]:Number(e.target.value)});}}/></label>}
            <small>{demo?'Sample option; staffing and inventory are not checked.':'Availability checked before review.'}</small></article>)}
          {!catalog.services.length&&<p>No additional services are published yet.</p>}</div></section>
        <section className="panel"><h2>Event details</h2><div className="row">
          {(['name','email','phone','eventType'] as const).map(field=><label key={field}>{({name:'Full name',email:'Email',phone:'Phone',eventType:'Occasion'})[field]}<input required maxLength={field==='phone'?40:200} autoComplete={field==='name'?'name':field==='email'?'email':field==='phone'?'tel':'off'} type={field==='email'?'email':field==='phone'?'tel':'text'} value={customer[field]} placeholder={field==='name'?'Your name':field==='email'?'you@example.com':field==='phone'?'+66 …':'Private party, meeting…'} onChange={e=>{holdAttempt.current=null;setPreviewComplete(false);setCustomer({...customer,[field]:e.target.value});}}/></label>)}</div>
          <label>Special requests (optional)<textarea value={customer.notes} maxLength={3000} onChange={e=>{holdAttempt.current=null;setCustomer({...customer,notes:e.target.value});}}/></label>
        </section>
        <div className="booking-actions"><div className="actions-inner"><div><small>{demo?'Sample total':'Quoted total'}</small><strong>{total===undefined?'Review for price':money(total)}</strong></div><div className="action-buttons"><button type="button" disabled={busy} onClick={()=>setStep(1)}>← Back</button><button className="primary" disabled={busy}>{busy?'Checking…':'Continue to review →'}</button></div></div></div>
      </form>}
      {step===3&&quoted&&<>
        <div className="step-title"><h1 ref={stepHeading} tabIndex={-1}>Review your booking</h1><p>Check your details before continuing to payment.</p></div>
        <div className="columns"><div>
          <section className="panel"><div className="section-title"><h2>Your private event</h2><button onClick={()=>{invalidate();setStep(1);}}>Edit search</button></div><h3>{space.name}</h3><p>{new Date(quoted.quote.start).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}<br/>to {new Date(quoted.quote.end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p><p>{hours} hours · {guests} guests · Bangkok time</p></section>
          <section className="panel"><div className="section-title"><h2>Contact & event details</h2><button onClick={()=>{setAccepted(false);setStep(2);}}>Edit details</button></div><dl className="review-details"><dt>Name</dt><dd>{customer.name}</dd><dt>Email</dt><dd>{customer.email}</dd><dt>Phone</dt><dd>{customer.phone}</dd><dt>Occasion</dt><dd>{customer.eventType}</dd>{customer.notes&&<><dt>Requests</dt><dd>{customer.notes}</dd></>}</dl></section>
        </div><aside className="panel summary"><h2>Price summary</h2>
          {quoted.quote.items.map((item,i)=><div className="line" key={i}><span>{item.description}</span><strong>{money(item.totalSatang)}</strong></div>)}
          <div className="line total"><span>{demo?'Sample total':'Total'}</span><strong>{money(quoted.quote.totalSatang)}</strong></div>
          <p className="rules">{quoted.quote.rules}</p><label className="agree"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>{demo?'I understand this is a preview and does not reserve the venue.':'I accept the displayed rules and payment/cancellation terms ('+quoted.quote.policyVersion+').'}</label>
          <p role="status">{quoteExpired?'Quote expired. Refresh your quote to continue.':'Quote valid until '+new Date(quoted.quoteExpiresAt).toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok'})+' Bangkok time.'}</p>
          {quoteExpired&&<button disabled={busy} onClick={()=>void preview()}>Refresh quote</button>}
          <small>{demo?'Preview only. Real reservations and Payso payment open after setup.':'Your time is reserved only when checkout starts.'}</small>
          {previewComplete&&<div className="preview-result" role="status"><h3>Preview checkout ready</h3><p>Your sample total is {money(quoted.quote.totalSatang)}. No booking has been made and nothing has been charged.</p></div>}
        </aside></div>
        <div className="booking-actions"><div className="actions-inner"><div><small>{demo?'Sample total':'Total'}</small><strong>{money(quoted.quote.totalSatang)}</strong></div><div className="action-buttons"><button disabled={busy} onClick={()=>{setAccepted(false);setStep(2);}}>← Back</button><button className="primary" onClick={pay} disabled={busy||!accepted||(quoteExpired&&!holdAttempt.current)}>{busy?'Processing…':demo?'Preview checkout →':'Continue to secure payment →'}</button></div></div></div>
      </>}
      </>}
      </>}
      {showManage&&<section className="panel"><h1 ref={stepHeading} tabIndex={-1}>My booking</h1>{demo?<p>Real booking management opens when Neon and Payso are configured. The preview does not create booking IDs.</p>:<><p>Booking access is stored securely in this browser for seven days. Recovery by email is not configured yet.</p>
        <div className="row"><label>Booking ID<input value={manageId} onChange={e=>setManageId(e.target.value)}/></label><button disabled={busy||!manageId} onClick={()=>manage(manageId)}>View booking</button></div>
        {booking&&<><h3>{booking.code} · {booking.status}</h3><p>Confirmed end time: {new Date(booking.end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p>
          {booking.payments.filter((p:any)=>p.status==='pending').map((p:any)=><p key={p.id}><a href={p.checkout_url}>Resume pending payment</a></p>)}
          {booking.extensions.map((x:any)=><p key={x.id}>Extension: {x.status} — proposed end {new Date(x.proposed_end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p>)}
          {booking.status==='confirmed'&&<><p>An extension reserves extra capacity and requires a separate payment. Current venue terms apply.</p><label>Additional hours<input type="number" min="1" max="24" value={extensionHours} onChange={e=>setExtensionHours(Number(e.target.value))}/></label>
            <label className="agree"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>Accept current extension terms: {space?.config.rules}</label><button disabled={busy||!accepted} onClick={extend}>Request extension & payment link</button></>}</>}
      </>}</section>}
    </main></div>;
}
