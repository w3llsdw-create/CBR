/* Caseboard TV â€” passive, responsive, â€œaliveâ€ */

const API = '/tv/cases';              // FastAPI endpoint
const POLL_MS = 60_000;           // refresh interval
const SCROLL_SPEED = 0.25;        // px per frame for autoscroll
const PAUSE_AT_END_MS = 2200;

const clockEl = () => document.getElementById("clock");
const rowsEl  = () => document.getElementById("rows");
const boardEl = () => document.getElementById("board");

let data = { cases: [] };
let rafId = null;
let autoscrollState = { dir: 1, pauseUntil: 0 };

function fmtDate(dt) {
  if (!dt) return "â€”";
  // Accept "YYYY-MM-DD" or ISO
  const d = new Date(dt);
  if (Number.isNaN(d)) return "â€”";
  return d.toLocaleDateString(undefined, { month:"short", day:"2-digit", year:"numeric" });
}

function badge(status) {
  const s = String(status || "").toLowerCase();
  const cls =
    s.includes("pre") ? "pre-filing" :
    s.includes("file") ? "filed" :
    s.includes("close") ? "closed" : "open";
  return `<span class="badge ${cls}">${(status||"").toUpperCase()}</span>`;
}

function attentionClass(c) {
  // derive subtle left accent by attributes
  if (c.next_due) {
    const due = new Date(c.next_due);
    const now = new Date();
    const days = Math.floor((due - now)/(1000*60*60*24));
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days <= 14) return "soon";
  }
  if (String(c.attention||"").toLowerCase().includes("need")) return "needs";
  return "";
}

function fvDot(c){ return c.filevine_id ? `<span class="fv on" title="Filevine linked"></span>` :
                                       `<span class="fv off" title="Not linked"></span>`; }

function row(c) {
  return `
  <div class="trow row ${attentionClass(c)}">
    <div class="cell col-case">${c.case_number || "â€”"} ${fvDot(c)}</div>
    <div class="cell col-name">${c.case_name || "â€”"}</div>
    <div class="cell col-type">${c.case_type || "â€”"}</div>
    <div class="cell col-stage">${c.stage || "â€”"}</div>
    <div class="cell col-status">${badge(c.status || "")}</div>
    <div class="cell col-para">${c.paralegal || "â€”"}</div>
    <div class="cell col-focus">${c.current_task || "â€”"}</div>
    <div class="cell col-due">${fmtDate(c.next_due)}</div>
  </div>`;
}

function render() {
  rowsEl().innerHTML = data.cases.map(row).join("");
  // size board to viewport minus header margin
  const h = window.innerHeight - document.querySelector(".header").offsetHeight - 24;
  boardEl().style.maxHeight = `${h}px`;
}

async function load() {
  const res = await fetch(API, { cache:"no-store" });
  const json = await res.json();
  data = json || { cases: [] };
  render();
  resetScroll();
}

function tickClock() {
  const now = new Date();
  clockEl().textContent = now.toLocaleTimeString(undefined, { hour: "numeric", minute:"2-digit", second:"2-digit" });
}

function resetScroll() {
  const el = boardEl();
  el.scrollTop = 0;
  autoscrollState = { dir: 1, pauseUntil: 0 };
}

function autoScroll(ts) {
  const el = boardEl();
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) { rafId = requestAnimationFrame(autoScroll); return; }

  if (ts < autoscrollState.pauseUntil) { rafId = requestAnimationFrame(autoScroll); return; }

  el.scrollTop += SCROLL_SPEED * autoscrollState.dir;

  if (el.scrollTop <= 0) {
    autoscrollState.dir = 1;
    autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS;
  } else if (el.scrollTop >= max - 1) {
    autoscrollState.dir = -1;
    autoscrollState.pauseUntil = ts + PAUSE_AT_END_MS;
  }
  rafId = requestAnimationFrame(autoScroll);
}

function onResize() { render(); }

function init() {
  tickClock();
  setInterval(tickClock, 1000);
  load();
  setInterval(load, POLL_MS);
  window.addEventListener("resize", onResize);
  rafId = requestAnimationFrame(autoScroll);
}

document.addEventListener("DOMContentLoaded", init);




(function caseboardTVPostfix(){
  const REPLACERS = [
    [/â€”/g,'—'], [/â€“/g,'–'], [/â€™/g,'’'], [/â€œ|â€\u009D|â€\u009C|â€\u009D/g,'"'], [/â€¦/g,'…']
  ];
  function cleanText(t){
    if (!t || !String(t).trim()) return '—';
    let s = String(t);
    for (const [re,rep] of REPLACERS) s = s.replace(re,rep);
    return s;
  }
  function sweep(){
    document.querySelectorAll('.cell').forEach(el=>{
      const cleaned = cleanText(el.textContent);
      if (el.textContent !== cleaned) el.textContent = cleaned;
      if (!el.title) el.title = cleaned;
    });
  }
  // run after initial render and on interval while TV updates
  sweep(); setInterval(sweep, 1500);
})();
