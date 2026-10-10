'use client';
import { useEffect, useRef, useState } from 'react';
const localDay=(date:Date)=>new Date(date.getTime()+420*60000).toISOString().slice(0,10);
function monthCells(month:string){
  const first=new Date(month+'-01T00:00:00Z'),offset=first.getUTCDay();
  return Array.from({length:42},(_,i)=>new Date(first.getTime()+(i-offset)*86400000).toISOString().slice(0,10));
}
export function BookingCalendar({value,onChange,maxDays,hasTimes,sample}:{value:string;onChange:(date:string)=>void;maxDays:number;hasTimes?:(date:string)=>boolean;sample:boolean}){
  const [open,setOpen]=useState(false),[month,setMonth]=useState(value.slice(0,7));
  const trigger=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDivElement>(null);
  const today=localDay(new Date()),last=localDay(new Date(Date.now()+maxDays*86400000));
  const label=(date:string)=>new Date(date+'T00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  useEffect(()=>{if(!open)return;dialog.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"],button[data-day]:not(:disabled)')?.focus();},[open]);
  function close(){setOpen(false);trigger.current?.focus();}
  function move(amount:number){const next=new Date(month+'-01T00:00Z');next.setUTCMonth(next.getUTCMonth()+amount);setMonth(next.toISOString().slice(0,7));}
  return <div className="date-picker"><span className="date-field-label">Date</span>
    <button type="button" ref={trigger} className="date-trigger" aria-label={'Choose date'+(value?', '+label(value):'')} aria-expanded={open} aria-haspopup="dialog" onClick={()=>{setMonth((value||today).slice(0,7));setOpen(!open);}}>{value?label(value):'Choose a date'}<span aria-hidden="true">▦</span></button>
    {open&&<><button type="button" className="calendar-backdrop" aria-label="Close calendar" onClick={close}/><div ref={dialog} role="dialog" aria-modal="true" aria-label="Booking date calendar" className="calendar-popover" onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);const first=buttons[0],lastButton=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();lastButton?.focus();}else if(!e.shiftKey&&document.activeElement===lastButton){e.preventDefault();first?.focus();}}
    }}>
      <div className="calendar-heading"><button type="button" aria-label="Previous month" disabled={month<=today.slice(0,7)} onClick={()=>move(-1)}>‹</button><strong aria-live="polite">{new Date(month+'-01T00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</strong><button type="button" aria-label="Next month" disabled={month>=last.slice(0,7)} onClick={()=>move(1)}>›</button></div>
      <table className="calendar-grid"><thead><tr>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({length:6},(_,row)=><tr key={row}>{monthCells(month).slice(row*7,row*7+7).map(day=>{
        const own=day.startsWith(month),valid=own&&day>=today&&day<=last&&(!hasTimes||hasTimes(day));
        return <td key={day}>{own&&<button type="button" data-day={day} aria-label={label(day)+(valid?'':' — unavailable')} disabled={!valid} aria-pressed={value===day} onClick={()=>{onChange(day);close();}}>{Number(day.slice(8))}</button>}</td>;
      })}</tr>)}</tbody></table>
      <p>{sample?'Sample schedule only; no live bookings are checked.':'Opening hours and availability are checked when you search.'}</p><button type="button" className="calendar-close" onClick={close}>Done</button>
    </div></>}
  </div>;
}
