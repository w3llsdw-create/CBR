/* Caseboard TV — passive, responsive, alive */

const API = '/tv/cases';
const POLL_MS = 60_000;
const SCROLL_SPEED = 0.35;
const PAUSE_AT_END_MS = 3000;

const clockEl = () => document.getElementById('clock');
const dateEl = () => document.getElementById('date');
const rowsEl  = () => document.getElementById('rows');
const scrollerEl = () => document.getElementById('caseScroller');

// paging for very long lists
let pageIndex = 0;
const PAGE_GROUP_COUNT = 3; // legacy: groups per page (unused for display)
const PAGE_ROWS_COUNT = 10;  // number of case rows per page
let pageTimer = null;
const priorityEl = () => document.getElementById('priorityList');
const miniUpcomingEl = () => document.getElementById('miniUpcoming');
const metricEl = id => document.getElementById(id);
const totalLabelEl = () => document.getElementById('metricTotalLabel');
const totalHintEl = () => document.getElementById('metricTotalHint');

let data = { cases: [] };
let rafId = null;
let autoscrollState = { dir: 1, pauseUntil: 0 };

const TEXT_FIXES = [
  [/â€”/g, '—'], [/â€“/g, '–'], [/â€™/g, '’'], [/â€œ/g, '“'], [/â€\u009d/g, '”'], [/â€\u009c/g, '“'], [/â€¦/g, '…']
];
const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

// === CFB ticker config ===
const CFB_API = '/tv/cfb';
const CFB_CYCLE_MS = 20_000;
const CFB_POLL_MS = 60_000;
let cfbData = null;
let cfbMode = 'prev';
let cfbCycleTimer = null;
let cfbPollTimer = null;

const GROUPS = [
  { key: 'overdue', label: 'Overdue', order: 0 },
  { key: 'today',   label: 'Due Today', order: 1 },
  { key: 'week',    label: 'Due This Week', order: 2 },
  { key: 'next',    label: 'Next 7 Days', order: 3 },
  { key: 'later',   label: 'Later', order: 4 },
  { key: 'nodue',   label: 'No Due Date', order: 5 },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeText(v){ if(v==null) return ''; let s=String(v); for(const [re,r] of TEXT_FIXES) s=s.replace(re,r); return s.trim(); }
function display(v,f='—'){ const s=normalizeText(v); return s? s : f; }
function escapeHtml(v){ return display(v,'').replace(/[&<>'"]/g,ch=>HTML_ESC[ch]); }
function escapeAttr(v){ return escapeHtml(v).replace(/`/g,'&#96;'); }
function fmtDate(dt){ if(!dt) return '—'; const d=new Date(dt); if(Number.isNaN(d)) return '—'; return d.toLocaleDateString(undefined,{month:'short',day:'2-digit',year:'numeric'}); }

async function loadCFB(){
  const wrap = document.getElementById('cfbTicker');
  try{
    const res = await fetch(CFB_API, { cache: 'no-store' });
    if(!res.ok) throw new Error(`cfb ${res.status}`);
    const payload = await res.json();
    if(payload){
      cfbData = payload;
      cfbMode = 'prev';
      renderCFBTicker(true);
    }
  }catch(err){
    if(!cfbData && wrap){
      wrap.setAttribute('hidden','');
      const track = document.getElementById('cfbTrack');
      if(track) track.textContent = '';
    }
  }
}

function ensureCFBTimers(){
  if(!cfbCycleTimer){
    cfbCycleTimer = setInterval(()=>{
      cfbMode = cfbMode === 'prev' ? 'next' : 'prev';
      renderCFBTicker(true);
    }, CFB_CYCLE_MS);
  }
  if(!cfbPollTimer){
    cfbPollTimer = setInterval(loadCFB, CFB_POLL_MS);
  }
}

function renderCFBTicker(resetAnim=false){
  const wrap = document.getElementById('cfbTicker');
  const track = document.getElementById('cfbTrack');
  if(!wrap || !track || !cfbData) return;

  const prevLane = Array.isArray(cfbData.prev) ? cfbData.prev : [];
  const nextLane = Array.isArray(cfbData.next) ? cfbData.next : [];
  let lane = cfbMode === 'next' ? nextLane : prevLane;

  if(!lane.length){
    if(cfbMode === 'prev' && nextLane.length){
      cfbMode = 'next';
      lane = nextLane;
    }else if(cfbMode === 'next' && prevLane.length){
      cfbMode = 'prev';
      lane = prevLane;
    }else{
      wrap.setAttribute('hidden','');
      track.textContent = '';
      return;
    }
  }

  wrap.removeAttribute('hidden');
  const labels = cfbData.labels || {};
  const labelText = cfbMode === 'next' ? (labels.next || 'Kickoffs') : (labels.prev || 'Finals');
  const labelSafe = escapeHtml(labelText);
  const tagClass = cfbMode === 'next' ? 'kick' : 'final';

  const chips = lane.map(game=>{
    if(cfbMode === 'prev'){
      const awayScore = game.away_score ?? '—';
      const homeScore = game.home_score ?? '—';
      return `<span class="cfb-chip">
        <span class="tag ${tagClass}">${labelSafe}</span>
        <span>${escapeHtml(game.away)} ${escapeHtml(String(awayScore))} <span class="cfb-sep">＠</span> ${escapeHtml(game.home)} ${escapeHtml(String(homeScore))}</span>
      </span>`;
    }

    let kickoff = 'TBD';
    if(game.start){
      const dt = new Date(game.start);
      if(!Number.isNaN(dt)){
        kickoff = dt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      }
    }
    const infoParts = [kickoff];
    if(game.network){ infoParts.push(game.network); }
    if(game.odds){
      const odds = game.odds;
      if(odds.fav){
        let favText = odds.fav;
        if(odds.spread !== null && odds.spread !== undefined){
          const spreadVal = Number(odds.spread);
          if(Number.isFinite(spreadVal)){
            const sign = spreadVal > 0 ? '+' : '';
            favText = `${favText} ${sign}${spreadVal}`;
          }else{
            favText = `${favText} ${odds.spread}`;
          }
        }
        infoParts.push(favText.trim());
      }
      if(odds.ml !== null && odds.ml !== undefined){
        const mlVal = Number(odds.ml);
        if(Number.isFinite(mlVal)){
          const sign = mlVal > 0 ? '+' : '';
          infoParts.push(`ML ${sign}${mlVal}`);
        }else{
          infoParts.push(`ML ${odds.ml}`);
        }
      }
      if(odds.ou !== null && odds.ou !== undefined){
        const ouVal = Number(odds.ou);
        infoParts.push(Number.isFinite(ouVal) ? `O/U ${ouVal}` : `O/U ${odds.ou}`);
      }
    }
    const meta = infoParts.length ? `<span class="meta">• ${infoParts.map(part=>escapeHtml(part)).join(' • ')}</span>` : '';
    return `<span class="cfb-chip">
      <span class="tag ${tagClass}">${labelSafe}</span>
      <span>${escapeHtml(game.away)} <span class="cfb-sep">＠</span> ${escapeHtml(game.home)}</span>
      ${meta}
    </span>`;
  }).join('');

  track.innerHTML = chips + chips;

  if(resetAnim){
    track.style.animation = 'none';
    void track.offsetHeight;
    track.style.animation = '';
  }
}

function badge(status){
  const normalized = normalizeText(status);
  if(!normalized) return '<span class="badge none">No status</span>';
  const s = normalized.toLowerCase();
  const cls =
    s.includes('active') ? 'active' :
    s.includes('pre') ? 'pre-filing' :
    s.includes('file') ? 'filed' :
    s.includes('close') ? 'closed' :
    s.includes('settle') ? 'settlement' :
    s.includes('appeal') ? 'appeal' : 'open';
  return `<span class="badge ${cls}">${escapeHtml(normalized)}</span>`;
}

function needsAttention(c){
  const note = normalizeText(c?.attention || '');
  return note && note.toLowerCase().includes('need');
}
function attentionClass(c){
  const a = (c?.attention || '').toLowerCase();
  if(a === 'needs_attention') return 'att-needs';
  if(a === 'waiting') return 'att-wait';
  return '';
}
function parseDueDate(c){ if(!c||!c.next_due) return null; const d=new Date(c.next_due); return Number.isNaN(d)? null : d; }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }

function categorizeCase(c){
  const dueDate = parseDueDate(c);
  if(!dueDate) return { group:'nodue', accent:'nodue', pillLabel:'No deadline set', dueDate:null, diffDays:null, sortValue: Number.POSITIVE_INFINITY };
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  const diffDays = Math.round((due - today)/MS_PER_DAY);
  if(diffDays < 0) return { group:'overdue', accent:'overdue', pillLabel: Math.abs(diffDays)===1?'1 day overdue':`${Math.abs(diffDays)} days overdue`, dueDate:due, diffDays, sortValue: due.getTime() };
  if(diffDays === 0) return { group:'today', accent:'today', pillLabel:'Due today', dueDate:due, diffDays, sortValue: due.getTime() };
  if(diffDays === 1) return { group:'week', accent:'week', pillLabel:'Due tomorrow', dueDate:due, diffDays, sortValue: due.getTime() };
  if(diffDays <= 3) return { group:'week', accent:'week', pillLabel:`Due in ${diffDays} days`, dueDate:due, diffDays, sortValue: due.getTime() };
  if(diffDays <= 7) return { group:'next', accent:'next', pillLabel:`Due in ${diffDays} days`, dueDate:due, diffDays, sortValue: due.getTime() };
  return { group:'later', accent:'later', pillLabel:`Due in ${diffDays} days`, dueDate:due, diffDays, sortValue: due.getTime() };
}

function priorityIcon(info){ return ''; }
function priorityFlag(info){ return ''; }
function duePill(info){
  if(!info || !info.dueDate) return '<span class="due-pill nodue"><strong>No deadline</strong><span>Set date</span></span>';
  return `<span class="due-pill ${info.accent}"><strong>${escapeHtml(info.pillLabel)}</strong><span>${fmtDate(info.dueDate)}</span></span>`;
}
function focusText(value){
  const text = display(value);
  if(!text || text==='—') return '<span class="muted focus-text">No focus logged</span>';
  return `<span class="focus-text">${escapeHtml(text)}</span>`;
}

function initials(name){ const parts=String(name||'').trim().split(/[\s,]+/).filter(Boolean); const first=parts[0]?.[0]||''; const last=parts[parts.length-1]?.[0]||''; return (first+last).toUpperCase(); }
function hashColor(name){ let h=0; const s=60, l=62; const str=String(name||''); for(let i=0;i<str.length;i++){ h=(h*31 + str.charCodeAt(i))>>>0; } return `${h%360}, ${s}%, ${l}%`; }

function row(c, info){
    const classes = ['trow','row','tv-row',info.accent];
  const att = attentionClass(c);
  if(att) classes.push(att);
  const client = display(c.client_name);
      const rawCaseNumber = (c.case_number ?? '').toString().trim();
    const caseName = display(c.case_name);
  const caseType = display(c.case_type);
  const paralegal = display(c.paralegal);
  const focus = c.current_focus ?? c.current_task;
  const caseNumberLabel = rawCaseNumber ? `${rawCaseNumber}` : '';
  return `
  <div class="${classes.join(' ')}" data-group="${info.group}">
        <div class="cell col-client" title="${escapeAttr(client)}">
      <div class="client-line">
        <span class="client-name">${escapeHtml(client)}</span>
      </div>
    </div>
    <div class="cell col-case-name" title="${escapeAttr(caseName)}">
      <span class="case-name">${escapeHtml(caseName)}</span>
      ${rawCaseNumber ? `<span class="case-num" title="${escapeAttr(rawCaseNumber)}">${escapeHtml(rawCaseNumber)}</span>` : ''}
    </div>
        <div class="cell col-type" title="${escapeAttr(caseType)}">${escapeHtml(caseType)}</div>
    <div class="cell col-status">${badge(c.status)}</div>
    <div class="cell col-focus" title="${escapeAttr(display(focus))}">${focusText(focus)}</div>
    <div class="cell col-para" title="${escapeAttr(paralegal)}">${escapeHtml(paralegal)}</div>
  </div>`;
}

function groupRow(group,count){ return `<div class="group-row ${group.key}"><span class="group-name">${group.label}</span><span class="group-count">${count}</span></div>`; }

function groupCases(list){
  const buckets = new Map(GROUPS.map(g=>[g.key,{...g,cases:[]}]));
  for(const c of list){
    const info = categorizeCase(c);
    const bucket = buckets.get(info.group) || buckets.get('nodue');
    bucket.cases.push({case:c, info});
  }
  const grouped = Array.from(buckets.values()).sort((a,b)=>a.order-b.order);
  for(const g of grouped){
    g.cases.sort((a,b)=> a.info.sortValue - b.info.sortValue || a.info.diffDays - b.info.diffDays || 0);
  }
  return grouped.filter(g=>g.cases.length>0);
}

function pluralizeCase(n){ return n===1?'1 case':`${n} cases`; }

function drawSpark(id, series, glow=false){
  const el = document.getElementById(id);
  if(!el) return;
  const w=100, h=24, pad=2;
  const vals = (series && series.length) ? series.slice(-20) : [0];
  const min = Math.min(...vals); const max = Math.max(...vals);
  const range = (max - min) || 1;
  const pts = vals.map((v,i)=>{
    const x = pad + (i*(w-2*pad)/(vals.length-1||1));
    const y = h - pad - ((v-min)* (h-2*pad) / range);
    return `${x},${y}`;
  }).join(' ');
  el.innerHTML = `<polyline points="${pts}" fill="none" stroke="rgba(200,220,255,.85)" stroke-width="2" stroke-linecap="round" />`;
  const card = el.closest('.kpi');
  if(card) card.classList.toggle('glow', !!glow);
}

function updateMetrics(grouped){
  const counts = { overdue:0, today:0, week:0, next:0, later:0, nodue:0 };
  let total = 0;
  for(const g of grouped){ const c=g.cases.length; counts[g.key]=c; total+=c; }
  const weekTotal = (counts.week||0) + (counts.next||0);
  const metrics = { metricOverdue: counts.overdue||0, metricToday: counts.today||0, metricWeek: weekTotal, metricTotal: total };
  for(const [id,val] of Object.entries(metrics)){ const el=metricEl(id); if(el) el.textContent = val; }
  // naive sparkline demo using counts history kept on window
  window.__kpi = window.__kpi || { overdue:[], today:[], week:[], total:[] };
  window.__kpi.overdue.push(counts.overdue);
  window.__kpi.today.push(counts.today);
  window.__kpi.week.push(weekTotal);
  window.__kpi.total.push(total);
  drawSpark('sparkOverdue', window.__kpi.overdue, counts.overdue > 5);
  drawSpark('sparkToday', window.__kpi.today, counts.today > 5);
  drawSpark('sparkWeek', window.__kpi.week, weekTotal > 10);
  drawSpark('sparkTotal', window.__kpi.total, false);
  const tl = totalLabelEl(); if(tl) tl.textContent = pluralizeCase(total);
  const hint = totalHintEl();
  if(hint){
    const stamp = data?.generated_at ? new Date(data.generated_at) : null;
    hint.textContent = (stamp && !Number.isNaN(stamp)) ? `Updated ${stamp.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}` : 'Tracking on this board';
  }
}

function renderPriority(grouped){
  const el = priorityEl(); if(!el) return; el.innerHTML = '';
}
function renderMiniUpcoming(grouped){
  const el = miniUpcomingEl(); if(!el) return;
  const soon = grouped.filter(g=>['overdue','today','week','next'].includes(g.key))
                      .flatMap(g=>g.cases.map(x=>({...x, group:g.key})))
                      .sort((a,b)=> a.info.sortValue - b.info.sortValue)
                      .slice(0,5);
  if(!soon.length){ el.innerHTML = '<li class="muted">No upcoming deadlines</li>'; return; }
  el.innerHTML = soon.map(({case:c, info})=>{
    const name = escapeHtml(display(c.case_name));
    const due = info.dueDate ? fmtDate(info.dueDate) : '—';
    return `<li><span class="mini-name" title="${escapeAttr(name)}">${name}</span><span class="mini-due">${escapeHtml(due)}</span></li>`;
  }).join('');
}

function sizeBoard(){
  const scroller = scrollerEl(); if(!scroller) return;
  const headerH = document.querySelector('.header')?.offsetHeight || 0;
  const metricsH = document.querySelector('.tv-insights')?.offsetHeight || 0;
  const padding = 140;
  const max = Math.max(window.innerHeight - headerH - metricsH - padding, 360);
  scroller.style.maxHeight = `${max}px`;
}

function render(){
  const list = Array.isArray(data?.cases) ? data.cases : [];
  const grouped = groupCases(list);
  if(!grouped.length){
    rowsEl().innerHTML = '<div class="empty-state tv-empty">No active cases on the board.</div>';
    updateMetrics(grouped); renderPriority(grouped); renderMiniUpcoming(grouped); sizeBoard(); return;
  }
  // Flatten grouped cases for a single minimalist list (no section headers)
  const items = [];
  for(const g of grouped){ for(const item of g.cases){ items.push(item); } }
  // Build paged rows by fixed row count
  const pages = [];
  for(let i=0;i<items.length;i+=PAGE_ROWS_COUNT){ pages.push(items.slice(i,i+PAGE_ROWS_COUNT)); }
  if(pageIndex >= pages.length) pageIndex = 0;
  const out = pages.length ? pages[pageIndex].map(({case:c,info})=>row(c,info)).join('') : '';
  const container = rowsEl();
  container.classList.add('fade-in');
  container.innerHTML = out;
  setTimeout(()=>container.classList.remove('fade-in'), 180);
  updateMetrics(grouped); renderPriority(grouped); renderMiniUpcoming(grouped); sizeBoard();

  // set up page auto-advance if content exceeds viewport or if scrolling stutters
  if(pageTimer) clearTimeout(pageTimer);
  pageTimer = setTimeout(()=>{ pageIndex = (pageIndex + 1) % Math.max(pages.length,1); render(); resetScroll(); }, 15000);
}

async function load(){
  const res = await fetch(API, { cache: 'no-store' });
  const json = await res.json();
  data = json || { cases: [] };
  render();
  resetScroll();
}

function formatHeaderDate(d){ return d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}); }
function tickClock(){
  const now = new Date();
  const c = clockEl(); if(c) c.textContent = now.toLocaleTimeString([], { hour:'numeric', minute:'2-digit', second:'2-digit' });
  const d = dateEl(); if(d) d.textContent = formatHeaderDate(now);
}

function resetScroll(){ const el=scrollerEl(); if(!el) return; el.scrollTop=0; autoscrollState={dir:1, pauseUntil:0}; }
function autoScroll(ts){
  const el = scrollerEl(); if(!el){ rafId=requestAnimationFrame(autoScroll); return; }
  const max = el.scrollHeight - el.clientHeight;
  if(max<=0){ rafId=requestAnimationFrame(autoScroll); return; }
  if(ts < autoscrollState.pauseUntil){ rafId=requestAnimationFrame(autoScroll); return; }
  el.scrollTop += SCROLL_SPEED * autoscrollState.dir;
  if(el.scrollTop <= 0){ autoscrollState.dir=1; autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS; }
  else if(el.scrollTop >= max - 1){ autoscrollState.dir=-1; autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS; }
  rafId = requestAnimationFrame(autoScroll);
}

function onResize(){ sizeBoard(); }
function setThemeByTime(){
  const hour = new Date().getHours();
  const body = document.body;
  const mode = hour < 10 ? 'morning' : hour < 17 ? 'day' : hour < 21 ? 'evening' : 'night';
  body.setAttribute('data-theme', mode);
}

function init(){
  setThemeByTime(); setInterval(setThemeByTime, 10*60*1000);
  tickClock(); setInterval(tickClock,1000);
  load(); setInterval(()=>{ load(); }, POLL_MS);
  // Disable CFB ticker until API keys configured and results verified
  // ensureCFBTimers();
  // loadCFB();
    window.addEventListener('resize', onResize);
  // Switch to page view (no continuous autoscroll)
  // rafId = requestAnimationFrame(autoScroll);
  try{ if(document.documentElement.requestFullscreen){ document.documentElement.requestFullscreen().catch(()=>{}); } }catch(e){}
}


document.addEventListener('DOMContentLoaded', init);
