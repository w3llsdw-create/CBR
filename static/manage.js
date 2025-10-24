const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const listEl = $('#list');
const resultCountEl = $('#result_count');
const detailTitleEl = $('#detail_title');
const detailSubtitleEl = $('#detail_subtitle');
const detailForm = $('#details_form');
const saveBtn = $('#save_case');
const resetBtn = $('#reset');
const openEditBtn = $('#open_edit');
const focusListEl = $('#focus_list');
const focusTextEl = $('#focus_text');
const focusAuthorEl = $('#focus_author');
const addFocusBtn = $('#add_focus');
const deadlinesEl = $('#deadlines');
const addDeadlineBtn = $('#add_deadline');
const hiddenId = $('#id');
const attentionButtons = $$('.attention-group .chip');
const importBtn = $('#import_cases');
const importInput = $('#import_file');
const importFeedback = $('#import_feedback');

const FORM_FIELDS = [
  'client_name',
  'case_name',
  'case_type',
  'paralegal',
  'stage',
  'status',
  'case_number',
  'county',
  'division',
  'judge',
  'opposing_counsel',
  'opposing_firm',
];

let CASES = [];
let filters = {
  search: '',
  stage: 'all',
  status: 'all',
  attention: 'all',
};
let activeId = null;

function esc(s) {
  const value = s == null ? '' : s;
  return value.toString().replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDue(dateValue) {
  if (!dateValue) return '—';
  const now = new Date();
  const due = new Date(dateValue + 'T00:00:00');
  const diff = Math.round((due - now) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff < 7) return `Due in ${diff} days`;
  return due.toLocaleDateString();
}

function dueClass(caseData) {
  if (!caseData.next_due) return '';
  const today = new Date();
  const due = new Date(caseData.next_due + 'T00:00:00');
  const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'soon';
  return '';
}

function statusClass(status) {
  return (status || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function attentionLabel(att) {
  if (att === 'needs_attention') return 'Needs attention';
  if (att === 'waiting') return 'Waiting';
  return 'Normal';
}

function setFormEnabled(enabled) {
  FORM_FIELDS.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.disabled = !enabled;
  });
  [focusTextEl, focusAuthorEl, addFocusBtn, addDeadlineBtn, saveBtn, resetBtn, openEditBtn].forEach((el) => {
    if (el) el.disabled = !enabled;
  });
  attentionButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
  if (!enabled) {
    focusListEl.innerHTML = '';
    deadlinesEl.innerHTML = '';
    deadlinesEl.dataset.json = JSON.stringify([]);
    detailTitleEl.textContent = 'Choose a case to review';
    detailSubtitleEl.textContent = '';
  }
}

function filtersMatch(caseData) {
  if (filters.stage !== 'all' && caseData.stage !== filters.stage) return false;
  if (filters.status !== 'all' && caseData.status !== filters.status) return false;
  if (filters.attention !== 'all' && caseData.attention !== filters.attention) return false;
  if (!filters.search) return true;
  const haystack = [
    caseData.client_name,
    caseData.case_name,
    caseData.paralegal,
    caseData.case_number,
    caseData.county,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(filters.search.toLowerCase());
}

function sortCases(list) {
  return list
    .slice()
    .sort((a, b) => {
      const attentionScore = { needs_attention: 0, waiting: 1, '': 2 };
      const attAKey = a.attention == null ? '' : a.attention;
      const attBKey = b.attention == null ? '' : b.attention;
      const hasOwn = Object.prototype.hasOwnProperty;
      const attA = hasOwn.call(attentionScore, attAKey) ? attentionScore[attAKey] : 3;
      const attB = hasOwn.call(attentionScore, attBKey) ? attentionScore[attBKey] : 3;
      if (attA !== attB) return attA - attB;
      const dueA = a.next_due ? new Date(a.next_due) : null;
      const dueB = b.next_due ? new Date(b.next_due) : null;
      if (dueA && dueB) {
        if (dueA.getTime() !== dueB.getTime()) return dueA - dueB;
      } else if (dueA || dueB) {
        return dueA ? -1 : 1;
      }
      return a.client_name.localeCompare(b.client_name);
    });
}

function applyFilters() {
  const matches = CASES.filter(filtersMatch);
  return sortCases(matches);
}

function updateResultCount(count) {
  resultCountEl.textContent = `${count} case${count === 1 ? '' : 's'}`;
}

function highlightRow(id) {
  $$('.case-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.id === id);
  });
}

function emptyState(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  wrapper.innerHTML = `<p>${esc(message)}</p>`;
  return wrapper;
}

function renderList() {
  const cases = applyFilters();
  listEl.innerHTML = '';
  updateResultCount(cases.length);
  if (!cases.length) {
    listEl.appendChild(emptyState('No cases match your filters.'));
    highlightRow(null);
    return;
  }
  cases.forEach((c) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `trow case-row ${dueClass(c)} ${c.attention === 'needs_attention' ? 'needs' : ''}`;
    row.dataset.id = c.id;
    row.innerHTML = `
      <div class="cell col-name">
        <strong>${esc(c.client_name)}</strong>
        <span class="muted">• ${esc(c.case_name)}</span>
      </div>
      <div class="cell col-type">${esc(c.case_type || '—')}</div>
      <div class="cell col-stage">${esc(c.stage || '—')}</div>
      <div class="cell col-status"><span class="badge ${statusClass(c.status)}">${esc(c.status || '—')}</span></div>
      <div class="cell col-para">${esc(c.paralegal || '—')}</div>
      <div class="cell col-due">
        <div>${fmtDate(c.next_due)}</div>
        <div class="micro muted">${relativeDue(c.next_due)}</div>
      </div>`;
    row.addEventListener('click', () => edit(c.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        edit(c.id);
      }
    });
    listEl.appendChild(row);
  });
  highlightRow(activeId);
}

function setImportFeedback(message, tone = 'info') {
  if (!importFeedback) return;
  importFeedback.textContent = message;
  importFeedback.dataset.tone = tone;
}

function renderFocusLog(entries) {
  focusListEl.innerHTML = '';
  if (!entries || !entries.length) {
    focusListEl.appendChild(emptyState('No focus entries yet.'));
    return;
  }
  entries
    .slice()
    .reverse()
    .forEach((entry) => {
      const li = document.createElement('li');
      const timestamp = new Date(entry.at).toLocaleString();
      li.innerHTML = `<span class="focus-time">${esc(timestamp)}</span><span class="focus-author">${esc(
        entry.author,
      )}</span><span class="focus-text">${esc(entry.text)}</span>`;
      focusListEl.appendChild(li);
    });
}

function renderDeadlines(dls) {
  deadlinesEl.innerHTML = '';
  if (!dls || !dls.length) {
    deadlinesEl.appendChild(emptyState('No deadlines set.'));
  } else {
    dls.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'deadline-row';
      row.innerHTML = `
        <input type="date" value="${d.due_date || ''}">
        <input type="text" placeholder="Description" value="${escAttr(d.description || '')}">
        <label class="small checkbox"><input type="checkbox" ${d.resolved ? 'checked' : ''}> Resolved</label>
        <button type="button" class="icon" aria-label="Remove deadline">×</button>`;
      const [dateInput, textInput, checkLabel, removeBtn] = row.children;
      const checkbox = checkLabel.querySelector('input');
      const commit = () => {
        const next = JSON.parse(deadlinesEl.dataset.json || '[]');
        next[i] = {
          due_date: dateInput.value || null,
          description: textInput.value || '',
          resolved: checkbox.checked,
        };
        deadlinesEl.dataset.json = JSON.stringify(next);
        markDirty();
      };
      dateInput.addEventListener('change', commit);
      textInput.addEventListener('input', commit);
      checkbox.addEventListener('change', commit);
      removeBtn.addEventListener('click', () => {
        const next = JSON.parse(deadlinesEl.dataset.json || '[]');
        next.splice(i, 1);
        deadlinesEl.dataset.json = JSON.stringify(next);
        renderDeadlines(next);
        markDirty();
      });
      deadlinesEl.appendChild(row);
    });
  }
  deadlinesEl.dataset.json = JSON.stringify(dls || []);
}

function populateForm(caseData) {
  hiddenId.value = caseData.id;
  FORM_FIELDS.forEach((field) => {
    const el = document.getElementById(field);
    if (!el) return;
    const value = caseData[field];
    el.value = value == null ? '' : value;
  });
  renderFocusLog(caseData.focus_log || []);
  renderDeadlines(caseData.deadlines || []);
  detailTitleEl.textContent = `${caseData.client_name}`;
  detailSubtitleEl.textContent = `${caseData.case_name} • ${attentionLabel(caseData.attention)}`;
  focusTextEl.value = '';
  focusAuthorEl.value = '';
  updateAttentionButtons(caseData.attention);
  saveBtn.disabled = true;
}

function updateAttentionButtons(state) {
  attentionButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.state === state);
  });
}

function markDirty() {
  if (!activeId) return;
  const current = collectForm();
  const original = CASES.find((c) => c.id === activeId);
  if (!original) return;
  const deadlinesChanged = deadlinesEl.dataset.json
    ? deadlinesEl.dataset.json !== JSON.stringify(original.deadlines || [])
    : false;
  const dirty = FORM_FIELDS.some((field) => {
    const originalVal = original[field] == null ? '' : original[field];
    return current[field] !== originalVal;
  });
  saveBtn.disabled = !(dirty || deadlinesChanged);
}

function collectForm() {
  const data = {};
  FORM_FIELDS.forEach((field) => {
    const el = document.getElementById(field);
    data[field] = el ? el.value : '';
  });
  return data;
}

async function edit(id) {
  const caseData = CASES.find((c) => c.id === id);
  if (!caseData) return;
  activeId = id;
  highlightRow(id);
  setFormEnabled(true);
  populateForm(caseData);
}

async function setAttention(state) {
  if (!activeId) return;
  try {
    const r = await fetch(`/api/cases/${activeId}/attention/${state}`, { method: 'POST' });
    if (!r.ok) throw new Error('Failed to update attention');
    await load({ keepSelection: true });
  } catch (err) {
    console.error(err);
    alert('Unable to update attention state.');
  }
}

async function load(options = {}) {
  try {
    const r = await fetch('/api/cases', { cache: 'no-store' });
    const data = await r.json();
    CASES = data.cases || [];
    renderList();
    if (options.keepSelection && activeId) {
      const exists = CASES.some((c) => c.id === activeId);
      if (exists) {
        edit(activeId);
      } else {
        activeId = null;
        setFormEnabled(false);
      }
    } else if (!activeId) {
      setFormEnabled(false);
    }
  } catch (err) {
    console.error('Failed to load cases', err);
    listEl.innerHTML = '';
    listEl.appendChild(emptyState('Unable to load cases.'));
  }
}

function clearFilters() {
  filters = { search: '', stage: 'all', status: 'all', attention: 'all' };
  $('#search').value = '';
  $('#filter_stage').value = 'all';
  $('#filter_status').value = 'all';
  $('#filter_attention').value = 'all';
  renderList();
}

function attachFilterListeners() {
  $('#search').addEventListener('input', (e) => {
    filters.search = e.target.value.trim();
    renderList();
  });
  $('#filter_stage').addEventListener('change', (e) => {
    filters.stage = e.target.value;
    renderList();
  });
  $('#filter_status').addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderList();
  });
  $('#filter_attention').addEventListener('change', (e) => {
    filters.attention = e.target.value;
    renderList();
  });
  $('#clear_filters').addEventListener('click', clearFilters);
}

function attachFormListeners() {
  detailForm.addEventListener('input', markDirty);
  detailForm.addEventListener('change', markDirty);
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!activeId) return;
    const original = CASES.find((c) => c.id === activeId);
    if (!original) return;
    populateForm(original);
    saveBtn.disabled = true;
  });
  detailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeId) return;
    const original = CASES.find((c) => c.id === activeId);
    if (!original) return;
    const payload = {
      ...original,
      ...collectForm(),
      deadlines: JSON.parse(deadlinesEl.dataset.json || '[]'),
    };
    try {
      const r = await fetch(`/api/cases/${activeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('Failed to save');
      await load({ keepSelection: true });
      saveBtn.disabled = true;
    } catch (err) {
      console.error(err);
      alert('Unable to save changes.');
    }
  });
  openEditBtn.addEventListener('click', () => {
    if (!activeId) return;
    window.open(`/edit?id=${encodeURIComponent(activeId)}`, '_blank');
  });
}

addDeadlineBtn.addEventListener('click', () => {
  const next = JSON.parse(deadlinesEl.dataset.json || '[]');
  next.push({ due_date: new Date().toISOString().slice(0, 10), description: '', resolved: false });
  deadlinesEl.dataset.json = JSON.stringify(next);
  renderDeadlines(next);
  markDirty();
});

addFocusBtn.addEventListener('click', async () => {
  if (!activeId) return alert('Select a case first.');
  const text = focusTextEl.value.trim();
  if (!text) return;
  const author = focusAuthorEl.value.trim() || 'DW';
  try {
    const r = await fetch(`/api/cases/${activeId}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), author, text }),
    });
    if (!r.ok) throw new Error('Failed to add focus');
    focusTextEl.value = '';
    focusAuthorEl.value = '';
    await load({ keepSelection: true });
  } catch (err) {
    console.error(err);
    alert('Unable to add focus entry.');
  }
});

attentionButtons.forEach((btn) => {
  btn.addEventListener('click', () => setAttention(btn.dataset.state));
});

if (importBtn && importInput) {
  const setImportLoading = (loading) => {
    if (!importBtn) return;
    importBtn.disabled = loading;
    importBtn.textContent = loading ? 'Importing…' : 'Import CSV';
  };

  importBtn.addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async (event) => {
    const file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;
    let csvText = '';
    try {
      csvText = await file.text();
    } catch (err) {
      console.error(err);
      setImportFeedback('Unable to read the selected file.', 'error');
      importInput.value = '';
      return;
    }
    setImportLoading(true);
    setImportFeedback('Importing cases…');
    try {
      const response = await fetch('/api/cases/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      });
      if (!response.ok) throw new Error('Upload failed');
      const result = await response.json();
      const parts = [];
      if (typeof result.added === 'number') parts.push(`${result.added} added`);
      if (typeof result.updated === 'number') parts.push(`${result.updated} updated`);
      if (Array.isArray(result.errors) && result.errors.length) {
        parts.push(`${result.errors.length} skipped`);
        setImportFeedback(`${parts.join(', ')}. ${result.errors.join(' ')}`, 'warn');
      } else {
        setImportFeedback(parts.join(', ') || 'Import complete', 'success');
      }
      await load({ keepSelection: true });
    } catch (err) {
      console.error(err);
      setImportFeedback('Unable to import cases. Please check the CSV and try again.', 'error');
    } finally {
      setImportLoading(false);
      importInput.value = '';
    }
  });
}

setFormEnabled(false);
attachFilterListeners();
attachFormListeners();
load();
