'use client';
import { useEffect, useRef, useState } from 'react';
import type { Quote } from '../src/domain';
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
  const [catalog,setCatalog]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [spaceId,setSpace]=useState(''),[date,setDate]=useState(''),[time,setTime]=useState('18:00');
  const [hours,setHours]=useState(2),[guests,setGuests]=useState(1),[selected,setSelected]=useState<Record<string,number>>({});
  const [quoted,setQuote]=useState<{quote:Quote;quoteDigest:string}|null>(null),[accepted,setAccepted]=useState(false);
  const [customer,setCustomer]=useState({name:'',email:'',phone:'',eventType:'Private event',notes:''});
  const [booking,setBooking]=useState<any>(null),[extensionHours,setExtensionHours]=useState(1),[manageId,setManageId]=useState('');
  const revision=useRef(0),holdAttempt=useRef<{key:string;token:string;input:any}|null>(null);
  useEffect(()=>{call('/api/catalog').then(c=>{setCatalog(c);if(c.spaces.length)setSpace(c.spaces[0].id);}).catch(e=>setError(e.message));},[]);
  const space=catalog?.spaces.find((s:any)=>s.id===spaceId);
  function invalidate(){revision.current++;setQuote(null);setAccepted(false);holdAttempt.current=null;}
  async function preview(){
    const current=++revision.current;setBusy(true);setError('');
    try{const q=await call('/api/quotes',{spaceId,startLocal:date+'T'+time,hours,guests,
      services:Object.entries(selected).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity}))});
      if(revision.current===current)setQuote(q);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function pay(){
    if(!quoted || !accepted)return;
    setBusy(true);setError('');
    try{
      holdAttempt.current??={key:crypto.randomUUID(),token:newToken(),input:{spaceId,startLocal:date+'T'+time,hours,guests,
        services:Object.entries(selected).filter(([,quantity])=>quantity>0).map(([id,quantity])=>({id,quantity})),
        customer,acceptedPolicyVersion:quoted.quote.policyVersion,quoteDigest:quoted.quoteDigest}};
      const attempt=holdAttempt.current;
      const b=await call('/api/bookings/holds',{...attempt.input,accessToken:attempt.token},attempt.key);
      const p=await call('/api/bookings/'+b.id+'/checkout',{},'checkout-'+attempt.key);
      window.location.assign(p.checkoutUrl);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function manage(id:string){
    setBusy(true);setError('');
    try{setBooking(await call('/api/bookings/'+id+'/status'));setManageId(id);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('booking');if(id)void manage(id);},[]);
  async function extend(){
    setBusy(true);setError('');
    try{
      const ext=await call('/api/bookings/'+booking.id+'/extensions',
        {hours:extensionHours,acceptedPolicyVersion:space?.config.policyVersion},crypto.randomUUID());
      const p=await call('/api/bookings/'+booking.id+'/checkout',{extensionId:ext.id},'extension-checkout-'+ext.id);
      window.location.assign(p.checkoutUrl);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><header><a href="/">224<span>LIVE HOUSE</span></a><a href="#manage">My booking</a></header>
    <div className="sandbox-banner">Development sandbox · Sample settings only · No real payment or reservation</div>
    <main><section className="hero"><div className="eyebrow">A SPACE FOR YOUR PEOPLE</div><h1>Make the night<br/><em>your own.</em></h1>
      <p>Your private gathering, creative session or celebration. Choose your time, then make it yours.</p>
      <div className="tags"><span>2 hours minimum</span><span>Private space</span><span>Optional concierge</span></div></section>
      {error&&<div role="alert" className="error">{error}</div>}
      {!catalog?(error?<div className="panel"><h2>Booking opens soon</h2><p>Venue settings and secure payments are being configured. Online reservations are currently unavailable.</p></div>:<p>Loading venue settings…</p>):!catalog.spaces.length?<div className="panel"><h2>Venue setup is pending</h2><p>The owner must configure rates, opening hours and policies before booking is available.</p></div>:
      <div className="columns"><div>
        <section className="panel"><h2><b>01</b> Your date & time</h2>
          {catalog.spaces.length>1&&<label>Space<select value={spaceId} onChange={e=>{invalidate();setSpace(e.target.value);}}>{catalog.spaces.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <div className="row"><label>Date<input type="date" value={date} onChange={e=>{invalidate();setDate(e.target.value);}}/></label>
          <label>Start time<input type="time" step={(space?.config.slotMinutes??30)*60} value={time} onChange={e=>{invalidate();setTime(e.target.value);}}/></label></div>
          <div className="duration"><button disabled={hours<=2||busy} onClick={()=>{invalidate();setHours(hours-1);}} aria-label="Remove one hour">−</button><strong>{hours} hours</strong><button disabled={hours>=space?.config.maxHours||busy} onClick={()=>{invalidate();setHours(hours+1);}}>+ 1 hour</button></div>
          <p>First 2 hours: {money(2*space.config.baseSatang)} · Additional hours: {money(space.config.otSatang)}/hour</p>
          <label>Guests<input type="number" min="1" max={space.capacity} value={guests} onChange={e=>{invalidate();setGuests(Number(e.target.value));}}/></label>
        </section>
        <section className="panel"><h2><b>02</b> Make it yours</h2><div className="service-grid">
          {catalog.services.filter((s:any)=>s.config.allowedSpaces.includes(spaceId)).map((s:any)=><article className="service" key={s.id}>
            {s.config.image?<img src={s.config.image} alt={s.name} loading="lazy" onError={e=>{e.currentTarget.style.display='none';}}/>:<div className="service-art" aria-hidden="true">{s.name.slice(0,1)}</div>}
            <h3>{s.name}</h3><p>{s.config.description??'Optional event service'}</p><p>{s.config.priceType==='request_quote'?'Request approval':money(s.config.priceSatang)+(s.config.priceType==='hour'?' / hour':'')}</p>
            {s.config.priceType!=='request_quote'&&<label>Quantity<input type="number" min="0" max={s.config.max} value={selected[s.id]??0} onChange={e=>{invalidate();setSelected({...selected,[s.id]:Number(e.target.value)});}}/></label>}
            <small>Availability verified with your selected time.</small></article>)}
          {!catalog.services.length&&<p>No additional services are published yet.</p>}</div></section>
        <section className="panel"><h2><b>03</b> Event details</h2><div className="row">
          {(['name','email','phone','eventType'] as const).map(field=><label key={field}>{({name:'Full name',email:'Email',phone:'Phone',eventType:'Occasion'})[field]}<input required type={field==='email'?'email':field==='phone'?'tel':'text'} value={customer[field]} onChange={e=>{holdAttempt.current=null;setCustomer({...customer,[field]:e.target.value});}}/></label>)}</div>
          <label>Requests<textarea value={customer.notes} maxLength={3000} onChange={e=>{holdAttempt.current=null;setCustomer({...customer,notes:e.target.value});}}/></label>
          <button className="primary" disabled={busy||!date} onClick={preview}>{busy?'Checking…':'Check availability & price'}</button>
        </section>
      </div><aside className="panel summary"><div className="eyebrow">YOUR PRIVATE EVENT</div><h2>Booking summary</h2>
        <p>{space.name} · {hours} hours · {guests} guests</p>
        {quoted?<><p>{new Date(quoted.quote.start).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}<br/>to {new Date(quoted.quote.end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p>
          {quoted.quote.items.map((item,i)=><div className="line" key={i}><span>{item.description}</span><strong>{money(item.totalSatang)}</strong></div>)}
          <div className="line total"><span>Total</span><strong>{money(quoted.quote.totalSatang)}</strong></div>
          <p className="rules">{quoted.quote.rules}</p><label className="agree"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I accept the displayed rules and payment/cancellation terms ({quoted.quote.policyVersion}).</label>
          <button className="primary" onClick={pay} disabled={busy||!accepted}>Continue to sandbox payment</button><small>Availability is reserved only when checkout starts.</small></>:
          <p>Choose your time and services, then check your itemized quote.</p>}</aside></div>}
      <section id="manage" className="panel"><h2>My booking</h2><p>Booking access is stored securely in this browser for seven days. Recovery by email is not configured yet.</p>
        <div className="row"><label>Booking ID<input value={manageId} onChange={e=>setManageId(e.target.value)}/></label><button disabled={busy||!manageId} onClick={()=>manage(manageId)}>View booking</button></div>
        {booking&&<><h3>{booking.code} · {booking.status}</h3><p>Confirmed end time: {new Date(booking.end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p>
          {booking.payments.filter((p:any)=>p.status==='pending').map((p:any)=><p key={p.id}><a href={p.checkout_url}>Resume pending payment</a></p>)}
          {booking.extensions.map((x:any)=><p key={x.id}>Extension: {x.status} — proposed end {new Date(x.proposed_end).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'})}</p>)}
          {booking.status==='confirmed'&&<><p>An extension reserves extra capacity and requires a separate payment. Current venue terms apply.</p><label>Additional hours<input type="number" min="1" max="24" value={extensionHours} onChange={e=>setExtensionHours(Number(e.target.value))}/></label>
            <label className="agree"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>Accept current extension terms: {space?.config.rules}</label><button disabled={busy||!accepted} onClick={extend}>Request extension & payment link</button></>}</>}
      </section>
    </main><footer>224 Live House · Bangkok time · THB</footer></>;
}
