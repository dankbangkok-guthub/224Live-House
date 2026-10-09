'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
export default function Sandbox(){
  const {id}=useParams<{id:string}>(),[payment,setPayment]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{fetch('/api/sandbox/'+id+'/summary').then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);setPayment(b);}).catch(e=>setError(e.message));},[id]);
  async function settle(status:string){
    setBusy(true);
    try{const r=await fetch('/api/sandbox/'+id+'/settle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      const b=await r.json();if(!r.ok)throw new Error(b.error);
      window.location.assign('/?booking='+b.bookingId);
    }catch(e){setError((e as Error).message);setBusy(false);}
  }
  return <main className="payment"><div className="eyebrow">DEVELOPMENT ONLY</div><h1>Sandbox checkout</h1><p>No money is collected. This simulates a verified provider result for testing.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {payment&&<div className="panel"><h2>{new Intl.NumberFormat('en-TH',{style:'currency',currency:'THB'}).format(payment.amountSatang/100)}</h2><p>Status: {payment.status}</p>
      <button className="primary" disabled={busy||payment.status!=='pending'} onClick={()=>settle('paid')}>Simulate successful payment</button>
      <button disabled={busy||payment.status!=='pending'} onClick={()=>settle('failed')}>Simulate failed payment</button>
      <p><a href={'/?booking='+payment.bookingId}>Return to booking status</a></p></div>}</main>;
}
