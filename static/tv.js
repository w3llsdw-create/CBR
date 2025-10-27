/* Caseboard TV — passive, responsive, alive */

const API = '/tv/cases';
const POLL_MS = 60_000;
const SCROLL_SPEED = 0.3;
const PAUSE_AT_END_MS = 2200;

const clockEl = () => document.getElementById('clock');
const dateEl = () => document.getElementById('date');
const rowsEl  = () => document.getElementById('rows');
const scrollerEl = () => document.getElementById('caseScroller');
const priorityEl = () => document.getElementById('priorityList');
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

function priorityIcon(info){
  switch(info.group){ case 'overdue': return '⛔'; case 'today': return '⏰'; case 'week': return '⚠️'; case 'next': return '🗓️'; default: return '📌'; }
}
function priorityFlag(info){ return `<span class="priority-flag ${info.accent}" aria-hidden="true">${priorityIcon(info)}</span>`; }
function duePill(info){
  if(!info || !info.dueDate) return '<span class="due-pill nodue"><strong>No deadline</strong><span>Set date</span></span>';
  return `<span class="due-pill ${info.accent}"><strong>${escapeHtml(info.pillLabel)}</strong><span>${fmtDate(info.dueDate)}</span></span>`;
}
function focusText(value){
  const text = display(value);
  if(!text || text==='—') return '<span class="muted focus-text">No focus logged</span>';
  return `<span class="focus-text">${escapeHtml(text)}</span>`;
}

function row(c, info){
  const classes = ['trow','row','tv-row',info.accent];
  if(needsAttention(c)) classes.push('needs');
  const client = display(c.client_name);
  const caseNumber = display(c.case_number);
  const caseName = display(c.case_name);
  const caseType = display(c.case_type);
  const stage = display(c.stage);
  const paralegal = display(c.paralegal);
  const focus = c.current_focus ?? c.current_task;
  const caseNumberLabel = caseNumber==='—' ? 'No case #' : `Case ${caseNumber}`;

  return `
  <div class="${classes.join(' ')}" data-group="${info.group}">
    <div class="cell col-client" title="${escapeAttr(client)}">
      <div class="client-line">
        ${priorityFlag(info)}
        <span class="client-name">${escapeHtml(client)}</span>
      </div>
      <div class="client-meta">
        <span class="micro muted" title="${escapeAttr(caseNumberLabel)}">${escapeHtml(caseNumberLabel)}</span>
      </div>
    </div>
    <div class="cell col-case-name" title="${escapeAttr(caseName)}">${escapeHtml(caseName)}</div>
    <div class="cell col-type" title="${escapeAttr(caseType)}">${escapeHtml(caseType)}</div>
    <div class="cell col-stage" title="${escapeAttr(stage)}">${escapeHtml(stage)}</div>
    <div class="cell col-status">${badge(c.status)}</div>
    <div class="cell col-focus" title="${escapeAttr(display(focus))}">${focusText(focus)}</div>
    <div class="cell col-para" title="${escapeAttr(paralegal)}">${escapeHtml(paralegal)}</div>
    <div class="cell col-due">${duePill(info)}</div>
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

function updateMetrics(grouped){
  const counts = { overdue:0, today:0, week:0, next:0, later:0, nodue:0 };
  let total = 0;
  for(const g of grouped){ const c=g.cases.length; counts[g.key]=c; total+=c; }
  const weekTotal = (counts.week||0) + (counts.next||0);
  const metrics = { metricOverdue: counts.overdue||0, metricToday: counts.today||0, metricWeek: weekTotal, metricTotal: total };
  for(const [id,val] of Object.entries(metrics)){ const el=metricEl(id); if(el) el.textContent = val; }
  const tl = totalLabelEl(); if(tl) tl.textContent = pluralizeCase(total);
  const hint = totalHintEl();
  if(hint){
    const stamp = data?.generated_at ? new Date(data.generated_at) : null;
    hint.textContent = (stamp && !Number.isNaN(stamp)) ? `Updated ${stamp.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}` : 'Tracking on this board';
  }
}

function renderPriority(grouped){
  const el = priorityEl(); if(!el) return;
  const urgent = grouped.filter(g=>['overdue','today','week','next'].includes(g.key))
                        .flatMap(g=>g.cases.map(x=>({...x, group:g.key})));
  urgent.sort((a,b)=>a.info.sortValue - b.info.sortValue);
  const top = urgent.slice(0,4);
  if(!top.length){ el.innerHTML = '<div class="priority-empty">No urgent deadlines in the next week.</div>'; return; }
  el.innerHTML = top.map(({case:c, info})=>{
    const name = display(c.case_name);
    const dueText = info.dueDate ? `${info.pillLabel} · ${fmtDate(info.dueDate)}` : 'No deadline';
    const owner = display(c.paralegal);
    return `
      <div class="priority-item ${info.accent}" role="listitem">
        <div class="priority-top">
          ${priorityFlag(info)}
          <span class="priority-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        </div>
        <div class="priority-meta">
          <span class="priority-due">${escapeHtml(dueText)}</span>
          <span class="priority-owner" title="${escapeAttr(owner)}">${escapeHtml(owner)}</span>
        </div>
      </div>`;
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
    updateMetrics(grouped); renderPriority(grouped); sizeBoard(); return;
  }
  const out = [];
  for(const g of grouped){ out.push(groupRow(g,g.cases.length)); out.push(g.cases.map(({case:c,info})=>row(c,info)).join('')); }
  rowsEl().innerHTML = out.join('');
  updateMetrics(grouped); renderPriority(grouped); sizeBoard();
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
  const max = el.scrollHeight - el.clientHeight; if(max<=0){ rafId=requestAnimationFrame(autoScroll); return; }
  if(ts < autoscrollState.pauseUntil){ rafId=requestAnimationFrame(autoScroll); return; }
  el.scrollTop += SCROLL_SPEED * autoscrollState.dir;
  if(el.scrollTop <= 0){ autoscrollState.dir=1; autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS; }
  else if(el.scrollTop >= max - 1){ autoscrollState.dir=-1; autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS; }
  rafId = requestAnimationFrame(autoScroll);
}

function onResize(){ sizeBoard(); }
function init(){
  tickClock(); setInterval(tickClock,1000);
  load(); setInterval(load, POLL_MS);
  ensureCFBTimers();
  loadCFB();
  window.addEventListener('resize', onResize);
  rafId = requestAnimationFrame(autoScroll);
}
document.addEventListener('DOMContentLoaded', init);
