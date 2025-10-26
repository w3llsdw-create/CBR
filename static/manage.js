const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const listEl = $('#list');
const resultCountEl = $('#result_count');
const detailTitleEl = $('#detail_title');
const detailSubtitleEl = $('#detail_subtitle');
const openEditBtn = $('#open_edit');
const deleteCaseBtn = $('#delete_case');
const focusListEl = $('#focus_list');
const focusEntryInput = $('#focus_entry');
const currentFocusEl = $('#current_focus_text');
const deadlinesEl = $('#deadlines');
const addDeadlineBtn = $('#add_deadline');
const hiddenId = $('#id');
const attentionButtons = $$('.attention-group .chip');
const importBtn = $('#import_cases');
const importInput = $('#import_file');
const importFeedback = $('#import_feedback');
const detailFields = {
  client_name: $('#detail_client_name'),
  case_name: $('#detail_case_name'),
  case_type: $('#detail_case_type'),
  paralegal: $('#detail_paralegal'),
  stage: $('#detail_stage'),
  status: $('#detail_status'),
  case_number: $('#detail_case_number'),
  county: $('#detail_county'),
  division: $('#detail_division'),
  judge: $('#detail_judge'),
  opposing_counsel: $('#detail_opposing_counsel'),
  opposing_firm: $('#detail_opposing_firm'),
};

let CASES = [];
let filters = {
  search: '',
  stage: 'all',
  status: 'all',
  attention: 'all',
};
let activeId = null;
let activeCase = null;

function esc(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, (m) => ({
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

function normalizeStatus(status) {
  if (!status) return status;
  return status === 'Pre-Filling' ? 'Pre-filing' : status;
}

function displayStatus(status) {
  const normalized = normalizeStatus(status);
  if (!normalized) return '—';
  return normalized;
}

function clearDetails() {
  Object.values(detailFields).forEach((el) => {
    if (el) el.textContent = '—';
  });
  if (currentFocusEl) currentFocusEl.textContent = 'Select a case to see the latest focus.';
  focusListEl.innerHTML = '';
  deadlinesEl.innerHTML = '';
  focusListEl.appendChild(emptyState('Select a case to view the focus log.'));
  deadlinesEl.appendChild(emptyState('Select a case to manage deadlines.'));
}

function setDetailsEnabled(enabled) {
  [focusEntryInput, addDeadlineBtn, openEditBtn, deleteCaseBtn].forEach((el) => {
    if (el) el.disabled = !enabled;
  });
  attentionButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
  if (!enabled) {
    hiddenId.value = '';
    detailTitleEl.textContent = 'Choose a case to review';
    detailSubtitleEl.textContent = '';
    clearDetails();
    activeCase = null;
  }
}

function filtersMatch(caseData) {
  if (filters.stage !== 'all' && caseData.stage !== filters.stage) return false;
  if (filters.status !== 'all' && normalizeStatus(caseData.status) !== filters.status) return false;
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
      const attA = attentionScore[a.attention ?? ''] ?? 3;
      const attB = attentionScore[b.attention ?? ''] ?? 3;
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
    const paralegalName = (c.paralegal || '').trim();
    const clientName = c.client_name && c.client_name.trim() ? c.client_name : '—';
    const caseName = c.case_name && c.case_name.trim() ? c.case_name : '—';
    const statusText = displayStatus(c.status);
    const statusClassName = statusText === '—' ? 'none' : statusClass(statusText);
    row.innerHTML = `
      <div class="cell col-name">
        <span class="primary">${esc(clientName)}</span>
        <span class="secondary">${esc(caseName)}</span>
      </div>
      <div class="cell col-type">${esc(c.case_type || '—')}</div>
      <div class="cell col-stage">${esc(c.stage || '—')}</div>
      <div class="cell col-status"><span class="badge ${statusClassName}">${esc(statusText)}</span></div>
      <div class="cell col-para">${esc(paralegalName || '—')}</div>
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
  const list = Array.isArray(dls) ? dls : [];
  if (!list.length) {
    deadlinesEl.appendChild(emptyState('No deadlines set.'));
    return;
  }
  list.forEach((d, index) => {
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
      if (!activeCase) return;
      const next = (activeCase.deadlines || []).map((item, i) =>
        i === index
          ? {
              due_date: dateInput.value || null,
              description: textInput.value.trim(),
              resolved: checkbox.checked,
            }
          : item
      );
      activeCase.deadlines = next;
      persistDeadlines(next);
    };
    dateInput.addEventListener('change', commit);
    textInput.addEventListener('blur', commit);
    checkbox.addEventListener('change', commit);
    removeBtn.addEventListener('click', () => {
      if (!activeCase) return;
      const next = (activeCase.deadlines || []).slice();
      next.splice(index, 1);
      activeCase.deadlines = next;
      persistDeadlines(next);
    });
    deadlinesEl.appendChild(row);
  });
}

function normalizeCase(caseData) {
  if (!caseData) return caseData;
  return { ...caseData, status: normalizeStatus(caseData.status) };
}

function populateDetails(caseData) {
  if (!caseData) return;
  activeCase = JSON.parse(JSON.stringify(normalizeCase(caseData)));
  hiddenId.value = activeCase.id;
  Object.entries(detailFields).forEach(([field, el]) => {
    if (!el) return;
    const raw = field === 'status' ? displayStatus(activeCase.status) : activeCase[field];
    el.textContent = raw && raw !== '' ? raw : '—';
  });
  detailTitleEl.textContent = `${activeCase.client_name}`;
  detailSubtitleEl.textContent = `${activeCase.case_name} • ${attentionLabel(activeCase.attention)}`;
  if (currentFocusEl) {
    currentFocusEl.textContent = activeCase.current_focus ? activeCase.current_focus : 'No current focus recorded.';
  }
  renderDeadlines(activeCase.deadlines || []);
  renderFocusLog(activeCase.focus_log || []);
  updateAttentionButtons(activeCase.attention);
  if (focusEntryInput) focusEntryInput.value = '';
}

function updateAttentionButtons(state) {
  attentionButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.state === state);
  });
}

function applyCaseUpdate(updatedCase) {
  if (!updatedCase) return;
  const normalized = normalizeCase(updatedCase);
  CASES = CASES.map((c) => (c.id === normalized.id ? normalized : c));
  renderList();
  if (activeId === normalized.id) {
    populateDetails(normalized);
    highlightRow(activeId);
  }
}

async function persistDeadlines(next) {
  if (!activeCase) return;
  try {
    const r = await fetch(`/api/cases/${activeCase.id}/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!r.ok) throw new Error('Failed to update deadlines');
    const updated = await r.json();
    applyCaseUpdate(updated);
  } catch (err) {
    console.error(err);
    alert('Unable to update deadlines.');
    await load({ keepSelection: true });
  }
}

async function addFocusEntry(text) {
  if (!activeCase) {
    alert('Select a case first.');
    return;
  }
  const author = activeCase.paralegal && activeCase.paralegal.trim() ? activeCase.paralegal : 'DW';
  try {
    const r = await fetch(`/api/cases/${activeCase.id}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), author, text }),
    });
    if (!r.ok) throw new Error('Failed to add focus');
    const updated = await r.json();
    applyCaseUpdate(updated);
  } catch (err) {
    console.error(err);
    alert('Unable to add focus entry.');
  }
}

async function deleteActiveCase() {
  if (!activeCase) return;
  const confirmed = window.confirm('Delete this case? This action cannot be undone.');
  if (!confirmed) return;
  try {
    const r = await fetch(`/api/cases/${activeCase.id}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error('Failed to delete case');
    activeId = null;
    activeCase = null;
    await load();
    setDetailsEnabled(false);
  } catch (err) {
    console.error(err);
    alert('Unable to delete this case.');
  }
}

async function edit(id) {
  const caseData = CASES.find((c) => c.id === id);
  if (!caseData) return;
  activeId = id;
  highlightRow(id);
  setDetailsEnabled(true);
  populateDetails(caseData);
}

async function setAttention(state) {
  if (!activeId) return;
  try {
    const r = await fetch(`/api/cases/${activeId}/attention/${state}`, { method: 'POST' });
    if (!r.ok) throw new Error('Failed to update attention');
    const updated = await r.json();
    applyCaseUpdate(updated);
  } catch (err) {
    console.error(err);
    alert('Unable to update attention state.');
  }
}

async function load(options = {}) {
  try {
    const r = await fetch('/api/cases', { cache: 'no-store' });
    const data = await r.json();
    CASES = (data.cases || []).map(normalizeCase);
    renderList();
    if (options.keepSelection && activeId) {
      const exists = CASES.some((c) => c.id === activeId);
      if (exists) {
        edit(activeId);
      } else {
        activeId = null;
        setDetailsEnabled(false);
      }
    } else if (!activeId) {
      setDetailsEnabled(false);
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

function attachDetailListeners() {
  if (openEditBtn) {
    openEditBtn.addEventListener('click', () => {
      if (!activeId) return;
      window.open(`/edit?id=${encodeURIComponent(activeId)}`, '_blank');
    });
  }
  if (addDeadlineBtn) {
    addDeadlineBtn.addEventListener('click', () => {
      if (!activeCase) {
        alert('Select a case first.');
        return;
      }
      const next = (activeCase.deadlines || []).slice();
      next.push({ due_date: new Date().toISOString().slice(0, 10), description: '', resolved: false });
      activeCase.deadlines = next;
      renderDeadlines(next);
      persistDeadlines(next);
    });
  }
  if (focusEntryInput) {
    focusEntryInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const text = focusEntryInput.value.trim();
      if (!text) return;
      await addFocusEntry(text);
      if (focusEntryInput) {
        focusEntryInput.value = '';
        focusEntryInput.focus();
      }
    });
  }
  if (deleteCaseBtn) {
    deleteCaseBtn.addEventListener('click', deleteActiveCase);
  }
}

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
    const file = event.target.files?.[0];
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

setDetailsEnabled(false);
attachFilterListeners();
attachDetailListeners();
load();
