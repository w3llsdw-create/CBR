const $ = s=>document.querySelector(s);
let LATEST=[], lastOK=0, fails=0;

const SCROLL_BASE = 14;  // baseline px per second
const DWELL = 1500;
let raf=0,last=0,dir=1,dwell=0;

function esc(s){ return (s??'').toString().replace(/[&<>"]/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function fmtDate(d){ if(!d) return "—"; const x=new Date(d); return x.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function badge(s){ return `<span class="badge ${s}">${(s||'open').toUpperCase()}</span>`; }
function fvDot(c){
  const on = !!(c.external && c.external.filevine && c.external.filevine.id);
  const title = on? `Filevine linked` : `Not linked`;
  return `<span class="fv ${on?'on':'off'}" title="${title}"></span>`;
}
function tone(c){
  if(!c.next_due) return c.attention==="needs_attention"?"needs":"";
  const days = Math.round((new Date(c.next_due+"T00:00:00") - new Date())/86400000);
  if(days<0) return "overdue";
  if(days===0) return "today";
  if(days<=3) return "soon";
  return c.attention==="needs_attention"?"needs":"";
}
function row(c){
  const klass = tone(c);
  return `<div class="trow ${klass}">
    <div class="cell col-case">${esc(c.case_number||"—")}${fvDot(c)}</div>
    <div class="cell col-name">${esc(c.case_name||"—")}</div>
    <div class="cell col-type">${esc(c.case_type||"—")}</div>
    <div class="cell col-stage">${esc(c.stage||"—")}</div>
    <div class="cell col-status">${badge(c.status||"open")}</div>
    <div class="cell col-para">${esc(c.paralegal||"—")}</div>
    <div class="cell col-focus"><span title="${esc(c.current_focus||"—")}">${esc((c.current_focus||"").slice(0,42))}</span></div>
    <div class="cell col-due">${fmtDate(c.next_due)}</div>
  </div>`;
}
function render(list){ $('#rows').innerHTML = list.map(row).join(''); ensureDensity(); }

async function refresh(){
  if(window._inflight) return; window._inflight=true;
  try{
    const el = $('#scroll');
    const ratio = el ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) : 0;
    const r = await fetch('/tv/cases',{cache:'no-store'});
    const data = await r.json(); LATEST = data.cases||[]; lastOK = Date.now(); fails=0;
    render(LATEST);
    if(el){ const max = el.scrollHeight - el.clientHeight; el.scrollTop = Math.round(ratio*max); }
  } catch{ fails++; } finally { window._inflight=false; }
}
function updateDot(){
  const age = Date.now()-lastOK; const dot = document.getElementById('dot');
  dot.style.background = age<90_000? '#22c55e' : age<180_000? '#f59e0b' : '#fb7185';
}
setInterval(updateDot, 1000);

function scrollSpeed(){
  const el = document.getElementById('scroll'); if(!el) return SCROLL_BASE;
  const distance = el.scrollHeight - el.clientHeight;
  const vh = Math.max(720, window.innerHeight);
  return Math.min(36, Math.max(10, SCROLL_BASE * (distance / (vh*1.2))));
}
function loop(ts){
  const el = $('#scroll'); if(!el){ raf=requestAnimationFrame(loop); return; }
  if(!last) last=ts; const dt=(ts-last)/1000; last=ts;
  const max = el.scrollHeight - el.clientHeight; const now=performance.now();
  if(now<dwell || max<=0){ raf=requestAnimationFrame(loop); return; }
  el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + dir*scrollSpeed()*dt));
  if(el.scrollTop>=max-1){ dir=-1; dwell=now+DWELL; }
  if(el.scrollTop<=0){ dir=1; dwell=now+DWELL; }
  raf=requestAnimationFrame(loop);
}
window.addEventListener('resize', ()=>{ last=0; });

function ensureDensity(){
  const rows = document.querySelectorAll('#rows .trow').length;
  const el = document.getElementById('scroll'); if(!el) return;
  const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'));
  const fit = Math.floor(el.clientHeight / rowH);
  document.body.classList.toggle('dense', rows > fit*1.5);
}

// init
refresh(); setInterval(refresh, 60_000);
requestAnimationFrame(loop);
