'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { bookingMessage } from '../../../src/booking-status';
const money=(n:number)=>new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB'}).format(n/100);
const time=(value:string)=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'});
export default function BookingStatus(){
  const {id}=useParams<{id:string}>();
  const [booking,setBooking]=useState<any>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[stopped,setStopped]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;const deadline=Date.now()+120000;
    setStopped(false);
    async function load(){
      try{
        const response=await fetch('/api/bookings/'+id+'/status',{signal:abort.signal,cache:'no-store'});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error==='booking_not_found'||result.error==='invalid_access_token'
          ?'This browser does not have access to this booking. Open it in the browser used for checkout.':'Status unavailable. Refresh to try again.');
        if(abort.signal.aborted)return;
        setBooking(result);setError('');
        const pending=bookingMessage(result.status).poll||result.extensions.some((x:any)=>x.status==='pending');
        if(pending&&Date.now()<deadline)timer=setTimeout(load,5000);else if(pending)setStopped(true);
      }catch(error){if(!abort.signal.aborted)setError((error as Error).message);}
    }
    void load();return()=>{abort.abort();clearTimeout(timer);};
  },[id,refresh]);
  const message=bookingMessage(booking?.status??'');
  return <><header><a href="/">224<span>LIVE HOUSE</span></a><a href="/#manage">My booking</a></header><main>
    <section className="panel"><h1>{message.title}</h1><p role="status">{message.detail}</p>
      {error&&<p role="alert" className="error">{error}</p>}
      {stopped&&<p>Automatic checks paused. Refresh for the latest verified status.</p>}
      <button onClick={()=>setRefresh(n=>n+1)}>Refresh status</button>
      {booking&&<><h2>{booking.code}</h2><p>{time(booking.start)} → {time(booking.end)} · Bangkok time</p>
        {booking.quote.items.map((item:any,i:number)=><div className="line" key={i}><span>{item.description}</span><strong>{money(item.totalSatang)}</strong></div>)}
        <div className="line total"><span>Booking total</span><strong>{money(booking.quote.totalSatang)}</strong></div>
        <p>{booking.quote.rules}</p><h2>Payment records</h2>
        {booking.payments.map((payment:any)=><div className="panel" key={payment.id}><p>{payment.extension_id?'Extension payment':'Space and services'} · {payment.status} · {money(Number(payment.amount_satang))}</p>
          {['holding','pending_payment','confirmed'].includes(booking.status)&&payment.status==='pending'&&Date.parse(payment.expires_at)>Date.now()
            &&<a href={payment.checkout_url}>Resume existing payment</a>}</div>)}
        {booking.extensions.length>0&&<><h2>Extensions</h2>{booking.extensions.map((extension:any)=><p key={extension.id}>{extension.status} · Proposed end: {time(extension.proposed_end)}. {extension.status==='pending'?'The original event end time applies until payment is verified.':''}</p>)}</>}
      </>}
    </section></main></>;
}
