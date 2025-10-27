/* Caseboard TV — passive, responsive, “alive” */

const API = '/tv/cases';              // FastAPI endpoint
const POLL_MS = 60_000;               // refresh interval
const SCROLL_SPEED = 0.3;             // px per frame for autoscroll
const PAUSE_AT_END_MS = 2200;

const clockEl = () => document.getElementById('clock');
const rowsEl  = () => document.getElementById('rows');
const boardEl = () => document.getElementById('board');
const priorityEl = () => document.getElementById('priorityList');
const metricEl = id => document.getElementById(id);

let data = { cases: [] };
let rafId = null;
let autoscrollState = { dir: 1, pauseUntil: 0 };

const TEXT_FIXES = [
  [/â€”/g, '—'], [/â€“/g, '–'], [/â€™/g, '’'], [/â€œ/g, '“'], [/â€\u009d/g, '”'], [/â€\u009c/g, '“'], [/â€¦/g, '…']
];

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const GROUPS = [
  { key: 'overdue', label: 'Overdue', order: 0 },
  { key: 'today',   label: 'Due Today', order: 1 },
  { key: 'week',    label: 'Due This Week', order: 2 },
  { key: 'next',    label: 'Next 7 Days', order: 3 },
  { key: 'later',   label: 'Later', order: 4 },
  { key: 'nodue',   label: 'No Due Date', order: 5 },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  for (const [re, rep] of TEXT_FIXES) s = s.replace(re, rep);
  return s.trim();
}

function display(value, fallback = '—') {
  const s = normalizeText(value);
  return s ? s : fallback;
}

function escapeHtml(value) {
  return display(value, '').replace(/[&<>"']/g, ch => HTML_ESC[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (Number.isNaN(d)) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
}

function badge(status) {
  const normalized = normalizeText(status);
  if (!normalized) return '<span class="badge none">NO STATUS</span>';
  const s = normalized.toLowerCase();
  const cls =
    s.includes('pre') ? 'pre-filing' :
    s.includes('file') ? 'filed' :
    s.includes('close') ? 'closed' :
    s.includes('settle') ? 'settlement' :
    s.includes('appeal') ? 'appeal' :
    'open';
  return `<span class="badge ${cls}">${escapeHtml(normalized.toUpperCase())}</span>`;
}

function needsAttention(c) {
  const note = normalizeText(c?.attention || '');
  return note && note.toLowerCase().includes('need');
}

function parseDueDate(c) {
  if (!c || !c.next_due) return null;
  const d = new Date(c.next_due);
  return Number.isNaN(d) ? null : d;
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function categorizeCase(c) {
  const dueDate = parseDueDate(c);
  if (!dueDate) {
    return {
      group: 'nodue',
      accent: 'nodue',
      pillLabel: 'No deadline set',
      dueDate: null,
      diffDays: null,
      sortValue: Number.POSITIVE_INFINITY,
    };
  }
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  const diffDays = Math.round((due - today) / MS_PER_DAY);

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      group: 'overdue',
      accent: 'overdue',
      pillLabel: overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`,
      dueDate: due,
      diffDays,
      sortValue: due.getTime(),
    };
  }
  if (diffDays === 0) {
    return {
      group: 'today',
      accent: 'today',
      pillLabel: 'Due today',
      dueDate: due,
      diffDays,
      sortValue: due.getTime(),
    };
  }
  if (diffDays === 1) {
    return {
      group: 'week',
      accent: 'week',
      pillLabel: 'Due tomorrow',
      dueDate: due,
      diffDays,
      sortValue: due.getTime(),
    };
  }
  if (diffDays <= 3) {
    return {
      group: 'week',
      accent: 'week',
      pillLabel: `Due in ${diffDays} days`,
      dueDate: due,
      diffDays,
      sortValue: due.getTime(),
    };
  }
  if (diffDays <= 7) {
    return {
      group: 'next',
      accent: 'next',
      pillLabel: `Due in ${diffDays} days`,
      dueDate: due,
      diffDays,
      sortValue: due.getTime(),
    };
  }
  return {
    group: 'later',
    accent: 'later',
    pillLabel: `Due in ${diffDays} days`,
    dueDate: due,
    diffDays,
    sortValue: due.getTime(),
  };
}

function fvDot(c) {
  return c?.filevine_id
    ? '<span class="fv on" title="Filevine linked"></span>'
    : '<span class="fv off" title="Not linked"></span>';
}

function priorityIcon(info) {
  switch (info.group) {
    case 'overdue': return '⛔';
    case 'today': return '⏰';
    case 'week': return '⚠️';
    case 'next': return '🗓️';
    default: return '📌';
  }
}

function priorityFlag(info) {
  return `<span class="priority-flag ${info.accent}" aria-hidden="true">${priorityIcon(info)}</span>`;
}

function duePill(info) {
  if (!info || !info.dueDate) {
    return '<span class="due-pill nodue"><strong>No deadline</strong><span>Set date</span></span>';
  }
  return `<span class="due-pill ${info.accent}"><strong>${escapeHtml(info.pillLabel)}</strong><span>${fmtDate(info.dueDate)}</span></span>`;
}

function row(c, info) {
  const classes = ['trow', 'row', info.accent];
  if (needsAttention(c)) classes.push('needs');
  const caseNumber = display(c.case_number);
  const caseName = display(c.case_name);
  const caseType = display(c.case_type);
  const stage = display(c.stage);
  const paralegal = display(c.paralegal);
  const focus = display(c.current_task);

  return `
  <div class="${classes.join(' ')}" data-group="${info.group}">
    <div class="cell col-case" title="${escapeAttr(caseNumber)}">
      ${priorityFlag(info)}
      <span class="case-id">${escapeHtml(caseNumber)}</span>
      ${fvDot(c)}
    </div>
    <div class="cell col-name" title="${escapeAttr(caseName)}">${escapeHtml(caseName)}</div>
    <div class="cell col-type" title="${escapeAttr(caseType)}">${escapeHtml(caseType)}</div>
    <div class="cell col-stage" title="${escapeAttr(stage)}">${escapeHtml(stage)}</div>
    <div class="cell col-status">${badge(c.status)}</div>
    <div class="cell col-para" title="${escapeAttr(paralegal)}">${escapeHtml(paralegal)}</div>
    <div class="cell col-focus" title="${escapeAttr(focus)}">${escapeHtml(focus)}</div>
    <div class="cell col-due">${duePill(info)}</div>
  </div>`;
}

function groupRow(group, count) {
  return `<div class="group-row ${group.key}"><span class="group-name">${group.label}</span><span class="group-count">${count}</span></div>`;
}

function groupCases(list) {
  const buckets = new Map(GROUPS.map(g => [g.key, { ...g, cases: [] }]));
  for (const c of list) {
    const info = categorizeCase(c);
    const bucket = buckets.get(info.group) || buckets.get('nodue');
    bucket.cases.push({ case: c, info });
  }
  const grouped = Array.from(buckets.values()).sort((a, b) => a.order - b.order);
  for (const group of grouped) {
    group.cases.sort((a, b) => a.info.sortValue - b.info.sortValue || a.info.diffDays - b.info.diffDays || 0);
  }
  return grouped.filter(group => group.cases.length > 0);
}

function updateMetrics(grouped) {
  const counts = { overdue: 0, today: 0, week: 0, next: 0, later: 0, nodue: 0 };
  let total = 0;
  for (const group of grouped) {
    const count = group.cases.length;
    counts[group.key] = count;
    total += count;
  }
  const weekTotal = (counts.week || 0) + (counts.next || 0);
  const metrics = {
    metricOverdue: counts.overdue || 0,
    metricToday: counts.today || 0,
    metricWeek: weekTotal,
    metricTotal: total,
  };
  for (const [id, value] of Object.entries(metrics)) {
    const el = metricEl(id);
    if (el) el.textContent = value;
  }
}

function renderPriority(grouped) {
  const el = priorityEl();
  if (!el) return;
  const urgent = grouped
    .filter(group => ['overdue', 'today', 'week', 'next'].includes(group.key))
    .flatMap(group => group.cases.map(item => ({ ...item, group: group.key })));
  urgent.sort((a, b) => (a.info.sortValue - b.info.sortValue));
  const top = urgent.slice(0, 4);
  if (!top.length) {
    el.innerHTML = '<div class="priority-empty">No urgent deadlines in the next week.</div>';
    return;
  }
  el.innerHTML = top.map(({ case: c, info }) => {
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

function sizeBoard() {
  const headerH = document.querySelector('.header')?.offsetHeight || 0;
  const glanceH = document.querySelector('.glance')?.offsetHeight || 0;
  const priorityH = document.querySelector('.priority-panel')?.offsetHeight || 0;
  const margin = 72;
  const max = Math.max(window.innerHeight - headerH - glanceH - priorityH - margin, 320);
  boardEl().style.maxHeight = `${max}px`;
}

function render() {
  const list = Array.isArray(data?.cases) ? data.cases : [];
  const grouped = groupCases(list);
  const fragments = [];
  for (const group of grouped) {
    fragments.push(groupRow(group, group.cases.length));
    fragments.push(group.cases.map(({ case: c, info }) => row(c, info)).join(''));
  }
  rowsEl().innerHTML = fragments.join('');
  updateMetrics(grouped);
  renderPriority(grouped);
  sizeBoard();
}

async function load() {
  const res = await fetch(API, { cache: 'no-store' });
  const json = await res.json();
  data = json || { cases: [] };
  render();
  resetScroll();
}

function tickClock() {
  const now = new Date();
  clockEl().textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
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

function onResize() {
  sizeBoard();
}

function init() {
  tickClock();
  setInterval(tickClock, 1000);
  load();
  setInterval(load, POLL_MS);
  window.addEventListener('resize', onResize);
  rafId = requestAnimationFrame(autoScroll);
}

document.addEventListener('DOMContentLoaded', init);
