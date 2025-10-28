/* Caseboard TV — passive, responsive, alive */

const API = '/tv/cases';
const POLL_MS = 60_000;
const SCROLL_SPEED = 0.35;
const PAUSE_AT_END_MS = 3000;
// Force display timezone for TV (Central Time by default)
const TIME_ZONE = 'America/Chicago';

const clockEl = () => document.getElementById('clock');
const dateEl = () => document.getElementById('date');
const rowsEl  = () => document.getElementById('rows');
const scrollerEl = () => document.getElementById('caseScroller');

// paging for very long lists
let pageIndex = 0;
const PAGE_GROUP_COUNT = 3; // legacy: groups per page (unused for display)
const PAGE_ROWS_COUNT = 10;  // number of case rows per page
let pageTimer = null;
let pagePause = false;
let progressRAF = null;
const priorityEl = () => null;
const miniUpcomingEl = () => null;

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
const CFB_CYCLE_MS = 45_000;
const CFB_POLL_MS = 60_000;
let cfbData = null;
let cfbMode = 'prev';
let cfbCycleTimer = null;
let cfbPollTimer = null;
let lastTickerHTML = '';
let tickerRAF = null;
let tickerOffset = 0; // px
let tickerLastTs = 0;
let lastTickerWidth = 0;
const TICKER_SPEED = 40; // px/sec



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
      renderCFBTicker();

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
  // Disable mode cycling to avoid snapping; only poll for new data.
  if(!cfbPollTimer){
    cfbPollTimer = setInterval(loadCFB, CFB_POLL_MS);
  }
}


function startTickerLoop(){
  const track = document.getElementById('cfbTrack');
  if(!track) return;
  cancelAnimationFrame(tickerRAF);
  tickerLastTs = 0;
  const step = (ts)=>{
    if (!tickerLastTs) tickerLastTs = ts;
    const dt = (ts - tickerLastTs) / 1000;
    tickerLastTs = ts;
    // advance offset
    tickerOffset -= TICKER_SPEED * dt;
        const total = track.scrollWidth / 2; // because content is duplicated
    if (total > 0){
      // wrap when we scrolled past one full set
      if (tickerOffset <= -total) {
        tickerOffset += total;
      } else if (tickerOffset > 0) {
        tickerOffset -= total;
      }
    }

    track.style.transform = `translateX(${tickerOffset}px)`;
    tickerRAF = requestAnimationFrame(step);
  };
  tickerRAF = requestAnimationFrame(step);
}

function renderCFBTicker(){
  const wrap = document.getElementById('cfbTicker');
  const track = document.getElementById('cfbTrack');
  if(!wrap || !track) return;
  if(!cfbData){
    wrap.removeAttribute('hidden');
    track.textContent = 'Loading scores…';
    return;
  }

  const prevLane = Array.isArray(cfbData.prev) ? cfbData.prev : [];
  const nextLane = Array.isArray(cfbData.next) ? cfbData.next : [];
  const labels = cfbData.labels || {};

  const prevChips = prevLane.map(game=>{
    const awayScore = game.away_score ?? '—';
    const homeScore = game.home_score ?? '—';
    return `<span class="cfb-chip"><span class="tag final">${escapeHtml(labels.prev || 'Finals')}</span><span>${escapeHtml(game.away)} ${escapeHtml(String(awayScore))} <span class="cfb-sep">＠</span> ${escapeHtml(game.home)} ${escapeHtml(String(homeScore))}</span></span>`;
  }).join('');

  const nextChips = nextLane.map(game=>{
    let kickoff = 'TBD';
    if (game.kick_label) kickoff = game.kick_label;
    else if (game.start){
      const dt = new Date(game.start);
      if(!Number.isNaN(dt)) kickoff = dt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE, timeZoneName: 'short' });
    }
    const parts = [kickoff];
    if(game.network) parts.push(game.network);
    if(game.odds){
      const o = game.odds;
      if(o.fav){
        let favText = o.fav;
        if(o.spread !== null && o.spread !== undefined){
          const v = Number(o.spread);
          favText = Number.isFinite(v) ? `${favText} ${v>0?'+':''}${v}` : `${favText} ${o.spread}`;
        }
        parts.push(favText.trim());
      }
      if(o.ml !== null && o.ml !== undefined){
        const v = Number(o.ml); parts.push(Number.isFinite(v)? `ML ${v>0?'+':''}${v}` : `ML ${o.ml}`);
      }
      if(o.ou !== null && o.ou !== undefined){
        const v = Number(o.ou); parts.push(Number.isFinite(v)? `O/U ${v}` : `O/U ${o.ou}`);
      }
    }
    const meta = parts.length ? `<span class="meta">• ${parts.map(p=>escapeHtml(p)).join(' • ')}</span>` : '';
    return `<span class="cfb-chip"><span class="tag kick">${escapeHtml(labels.next || 'Kickoffs')}</span><span>${escapeHtml(game.away)} <span class="cfb-sep">＠</span> ${escapeHtml(game.home)}</span>${meta}</span>`;
  }).join('');

  const combined = prevChips + nextChips;
  if(!combined){
    wrap.removeAttribute('hidden');
    track.textContent = 'No games available';
    return;
  }

  const html = combined + combined; // loopable content
  if (html !== lastTickerHTML) {
    // Preserve offset proportionally if width changes
    const oldTotal = lastTickerWidth / 2;
    track.innerHTML = html;
    lastTickerHTML = html;
    lastTickerWidth = track.scrollWidth;
    const newTotal = lastTickerWidth / 2;
    if (oldTotal > 0 && newTotal > 0){
      const ratio = newTotal / oldTotal;
      tickerOffset = tickerOffset * ratio;
      // clamp within new bounds
      if (Math.abs(tickerOffset) > newTotal) tickerOffset = tickerOffset % newTotal;
      track.style.transform = `translateX(${tickerOffset}px)`;
    }
    if (!tickerRAF) startTickerLoop();
  } else if (!tickerRAF){
    startTickerLoop();
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
  const county = display(c.county);

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
    <div class="cell col-county" title="${escapeAttr(county)}">${escapeHtml(county)}</div>
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

function renderPriority(grouped){}
function renderMiniUpcoming(grouped){}


function sizeBoard(){
  const scroller = scrollerEl(); if(!scroller) return;
  const headerH = document.querySelector('.header')?.offsetHeight || 0;
  const metricsH = document.querySelector('.tv-insights')?.offsetHeight || 0;
  const padding = 140;
  const max = Math.max(window.innerHeight - headerH - metricsH - padding, 360);
  scroller.style.maxHeight = `${max}px`;
}

function animateProgress(duration){
  cancelAnimationFrame(progressRAF);
  const bar = document.getElementById('pageProgress'); if(!bar) return;
  const start = performance.now();
  const step = (ts)=>{
    const t = Math.min(1, (ts - start)/duration);
    bar.style.width = `${t*100}%`;
    progressRAF = requestAnimationFrame(step);
  };
  bar.style.width = '0%';
  progressRAF = requestAnimationFrame(step);
}

function mountLayer(html){
  // Mount page layers into the scroller so absolute layers have a sized, positioned parent
  const container = scrollerEl();
  if(!container) return;
  const layer = document.createElement('div');
  layer.className = 'page-layer fade-in row-stagger';
  layer.innerHTML = html;
  // stagger children
  Array.from(layer.children).forEach((el, idx)=>{ el.style.animationDelay = `${idx*120}ms`; });
  // Fade out any existing layers
  const existing = Array.from(container.querySelectorAll('.page-layer'));
  existing.forEach(el=> el.classList.add('fade-out'));
  // Append new
  container.appendChild(layer);
  // Cleanup old after fade
  setTimeout(()=>{ existing.forEach(el=> el.remove()); }, 1300);
}


function render(options={}){

  const preserveTicker = !!options.preserveTicker;
  const list = Array.isArray(data?.cases) ? data.cases : [];
    const grouped = groupCases(list);
  const container = rowsEl();
  if(!grouped.length){
    container.innerHTML = '<div class="empty-state tv-empty">No active cases on the board.</div>';
    updateMetrics(grouped); renderPriority(grouped); renderMiniUpcoming(grouped); sizeBoard(); return;
  }


  // Flatten grouped cases for a single minimalist list (no section headers)
  const items = [];
  for(const g of grouped){ for(const item of g.cases){ items.push(item); } }
  // Build paged rows by fixed row count
  const pages = [];
  for(let i=0;i<items.length;i+=PAGE_ROWS_COUNT){ pages.push(items.slice(i,i+PAGE_ROWS_COUNT)); }
  if(pageIndex >= pages.length) pageIndex = 0;
    const page = pages.length ? pages[pageIndex] : [];
  // Build HTML in normal flow with staggered rows (no absolute layers to avoid clipping)
  container.classList.add('row-stagger');
  container.innerHTML = page.map(({case:c,info}, idx)=>`<div class="row-wrap" style="animation-delay:${idx*120}ms">${row(c,info)}</div>`).join('');
  container.classList.add('fade-in');
  setTimeout(()=>container.classList.remove('fade-in'), 1200);

  updateMetrics(grouped); renderPriority(grouped); renderMiniUpcoming(grouped); sizeBoard();


  // Page timing: 6–10s based on rows
    // Linger longer: ~double previous pacing
  // Double dwell for slower pacing
  const dwell = Math.min(40000, Math.max(24000, page.length * 2800));
  animateProgress(dwell);

  if(pageTimer) clearTimeout(pageTimer);
  pageTimer = setTimeout(()=>{
    pagePause = true; // brief pause at end
    setTimeout(()=>{
      pagePause = false;
      pageIndex = (pageIndex + 1) % Math.max(pages.length,1);
      render({preserveTicker:true});
      resetScroll();
    }, 1000);
  }, dwell);

}



async function load(){
  const res = await fetch(API, { cache: 'no-store' });
  const json = await res.json();
  data = json || { cases: [] };
  // Do not reset the ticker when case data updates
  render({preserveTicker:true});
  // keep case scroller at top on page changes only
  resetScroll();
}


function formatHeaderDate(d){ return d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric', timeZone: TIME_ZONE}); }
function tickClock(){
  const now = new Date();
    const c = clockEl(); if(c) c.textContent = now.toLocaleTimeString([], { hour:'numeric', minute:'2-digit', second:'2-digit', timeZone: TIME_ZONE });
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

function setVolumeActive(id){
  const buttons = document.querySelectorAll('.vol-btn');
  buttons.forEach(b=>b.classList.toggle('active', b.dataset.target === id));
}
// YouTube player instances for finer control
let YT_READY = false;
let YT_PLAYERS = {};
function onYouTubeIframeAPIReady(){ YT_READY = true; initYTPlayers(); }
function initYTPlayers(){
  const ids = ['tv_v1','tv_v2','tv_v3'];
  ids.forEach((id)=>{
    const el = document.getElementById(id);
    if(!el) return;
    if(YT_PLAYERS[id]) return;
    try{
      YT_PLAYERS[id] = new YT.Player(id, {
        events: {
          onReady: (ev)=>{ try{ ev.target.mute(); ev.target.playVideo && ev.target.playVideo(); }catch(e){} },
        }
      });
    }catch(e){}
  });
}
function setAudio(target){
  const muteAll = target === 'off';
  const ids = ['tv_v1','tv_v2','tv_v3'];
  ids.forEach((id, idx)=>{
    const p = YT_PLAYERS[id];
    if(!p || !p.mute || !p.unMute) return;
    const playerKey = `v${idx+1}`;
    try{
      if(muteAll || playerKey !== target){ p.mute(); } else { p.unMute(); p.setVolume && p.setVolume(100); }
    }catch(e){}
  });
  setVolumeActive(target);
}
function wireVolumeControls(){
  if(!YT_READY){
    const h = setInterval(()=>{ if(YT_READY){ clearInterval(h); initYTPlayers(); } }, 300);
  }

  const container = document.querySelector('.volume-controls'); if(!container) return;
  container.addEventListener('click', (e)=>{
    const btn = e.target.closest('.vol-btn'); if(!btn) return;
    const target = btn.dataset.target;
    setAudio(target);
  });
  // Default: all muted
  setVolumeActive('off');
}

function init(){
  setThemeByTime(); setInterval(setThemeByTime, 10*60*1000);
  tickClock(); setInterval(tickClock,1000);
    load(); setInterval(()=>{ load(); }, POLL_MS);
  // Enable College Football ticker
  ensureCFBTimers();
  loadCFB();
  window.addEventListener('resize', onResize);
  wireVolumeControls();
  try{ if(document.documentElement.requestFullscreen){ document.documentElement.requestFullscreen().catch(()=>{}); } }catch(e){}
}




document.addEventListener('DOMContentLoaded', init);
