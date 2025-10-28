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
const focusAuthorSelect = $('#focus_author');
const currentFocusEl = $('#current_focus_text');
const deadlinesEl = $('#deadlines');
const addDeadlineBtn = $('#add_deadline');
const hiddenId = $('#id');
const attentionButtons = $$('.attention-group .chip');
const importBtn = $('#import_cases');
const importInput = $('#import_file');
const importFeedback = $('#import_feedback');
const paralegalFilter = $('#filter_paralegal');
const searchInput = $('#search');
const stageFilter = $('#filter_stage');
const statusFilter = $('#filter_status');
const attentionFilter = $('#filter_attention');
const clearFiltersBtn = $('#clear_filters');
const metrics = {
  total: $('#metric_total'),
  attention: $('#metric_attention'),
  dueSoon: $('#metric_due_soon'),
  staleFocus: $('#metric_stale_focus'),
};
const detailsCard = document.querySelector('.details-card');
const metricHints = {
  total: $('#metric_total_hint'),
  attention: $('#metric_attention_hint'),
  dueSoon: $('#hint_due_soon'),
  stale: $('#hint_stale_focus'),
};
const quickFilterButtons = $$('.insight-card.actionable');
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
  paralegal: 'all',
  due: 'all',
  staleFocus: false,
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

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysUntilDue(caseData) {
  if (!caseData || !caseData.next_due) return null;
  const due = new Date(caseData.next_due + 'T00:00:00');
  const today = new Date();
  return Math.floor((due - today) / MS_PER_DAY);
}

function isDueSoon(caseData) {
  const days = daysUntilDue(caseData);
  if (days === null) return false;
  return days <= 7;
}

function isOverdue(caseData) {
  const days = daysUntilDue(caseData);
  if (days === null) return false;
  return days < 0;
}

function hasStaleFocus(caseData, thresholdDays = 14) {
  if (!caseData) return false;
  if (!Array.isArray(caseData.focus_log) || !caseData.focus_log.length) return true;
  const lastEntry = caseData.focus_log[caseData.focus_log.length - 1];
  if (!lastEntry || !lastEntry.at) return true;
  const last = new Date(lastEntry.at);
  if (Number.isNaN(last.getTime())) return true;
  const now = new Date();
  const diffDays = Math.floor((now - last) / MS_PER_DAY);
  return diffDays >= thresholdDays;
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
  if (/^pre[-\s]?fil/i.test(status)) return 'Pre-filing';
  return status;
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
  if (focusListEl) {
    focusListEl.innerHTML = '';
    focusListEl.appendChild(emptyState('Select a case to view the focus log.'));
  }
  if (deadlinesEl) {
    deadlinesEl.innerHTML = '';
    deadlinesEl.appendChild(emptyState('Select a case to manage deadlines.'));
  }
}

function setDetailsEnabled(enabled) {
  [focusEntryInput, focusAuthorSelect, addDeadlineBtn, openEditBtn, deleteCaseBtn].forEach((el) => {
    if (el) el.disabled = !enabled;
  });
  attentionButtons.forEach((btn) => {
    btn.disabled = !enabled;
  });
  if (detailsCard) detailsCard.classList.toggle('has-selection', !!enabled);
  if (!enabled) {
    hiddenId.value = '';
    detailTitleEl.textContent = 'Choose a case to review';
    detailSubtitleEl.textContent = '';
    clearDetails();
    activeCase = null;
    if (focusAuthorSelect) focusAuthorSelect.value = 'DW';
  }
}


function filtersMatch(caseData) {
  if (filters.stage !== 'all' && caseData.stage !== filters.stage) return false;
  if (filters.status !== 'all' && normalizeStatus(caseData.status) !== filters.status) return false;
  if (filters.attention !== 'all' && caseData.attention !== filters.attention) return false;
  if (filters.paralegal && filters.paralegal !== 'all') {
    const para = (caseData.paralegal || '').trim().toLowerCase();
    if (para !== filters.paralegal.toLowerCase()) return false;
  }
  if (filters.due === 'soon' && !isDueSoon(caseData)) return false;
  if (filters.due === 'overdue' && !isOverdue(caseData)) return false;
  if (filters.staleFocus && !hasStaleFocus(caseData)) return false;
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

function updateInsights(visibleCount) {
  if (!metrics.total) return;
  const total = CASES.length;
  metrics.total.textContent = total;
  if (metricHints.total) {
    if (visibleCount === total) {
      metricHints.total.textContent = total ? 'Showing all cases' : 'No cases yet';
    } else {
      metricHints.total.textContent = `Showing ${visibleCount} of ${total}`;
    }
  }

  const needsAttention = CASES.filter((c) => c.attention === 'needs_attention').length;
  const waiting = CASES.filter((c) => c.attention === 'waiting').length;
  if (metrics.attention) metrics.attention.textContent = needsAttention;
  if (metricHints.attention) {
    metricHints.attention.textContent = waiting ? `${waiting} waiting` : 'Tap to show only urgent matters';
  }

  const dueSoonCount = CASES.filter(isDueSoon).length;
  const overdueCount = CASES.filter(isOverdue).length;
  if (metrics.dueSoon) metrics.dueSoon.textContent = dueSoonCount;
  if (metricHints.dueSoon) {
    metricHints.dueSoon.textContent = dueSoonCount
      ? `${overdueCount} overdue, ${Math.max(dueSoonCount - overdueCount, 0)} upcoming`
      : 'Next 7 days';
  }

  const staleCount = CASES.filter((c) => hasStaleFocus(c)).length;
  const neverLogged = CASES.filter((c) => !c.focus_log || !c.focus_log.length).length;
  if (metrics.staleFocus) metrics.staleFocus.textContent = staleCount;
  if (metricHints.stale) {
    if (!staleCount) {
      metricHints.stale.textContent = 'All cases recently updated';
    } else if (neverLogged) {
      metricHints.stale.textContent = `${staleCount} need updates (${neverLogged} with no log)`;
    } else {
      metricHints.stale.textContent = `${staleCount} need updates`;
    }
  }
}

function updateQuickFiltersUI() {
  quickFilterButtons.forEach((btn) => {
    const type = btn.dataset.filter;
    const value = btn.dataset.value;
    let active = false;
    if (type === 'attention') {
      active = filters.attention === value;
    } else if (type === 'due') {
      active = filters.due === value;
    } else if (type === 'stale') {
      active = filters.staleFocus;
    }
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (metricHints.attention && filters.attention === 'needs_attention') {
    metricHints.attention.textContent = 'Filter applied';
  }
  if (metricHints.dueSoon && filters.due !== 'all') {
    metricHints.dueSoon.textContent = 'Filter applied';
  }
  if (metricHints.stale && filters.staleFocus) {
    metricHints.stale.textContent = 'Filter applied';
  }
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

function populateParalegalOptions(list) {
  if (!paralegalFilter) return;
  const selected = filters.paralegal;
  const unique = Array.from(
    new Set(
      (list || [])
        .map((c) => (c.paralegal || '').trim())
        .filter((name) => !!name)
    )
  ).sort((a, b) => a.localeCompare(b));

  const frag = document.createDocumentFragment();
  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = 'All paralegals';
  frag.appendChild(defaultOption);
  unique.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    frag.appendChild(option);
  });
  paralegalFilter.innerHTML = '';
  paralegalFilter.appendChild(frag);

  if (selected && selected !== 'all') {
    const match = unique.find((name) => name.toLowerCase() === selected.toLowerCase());
    if (match) {
      paralegalFilter.value = match;
      filters.paralegal = match;
      return;
    }
  }
  paralegalFilter.value = 'all';
  filters.paralegal = 'all';
}

function renderList() {
  const cases = applyFilters();
  listEl.innerHTML = '';
  updateResultCount(cases.length);
  updateInsights(cases.length);
  updateQuickFiltersUI();
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
    const focusText = (c.current_focus || '').trim();
    const focusHtml = focusText
      ? `<span class="focus-text">${esc(focusText)}</span>`
      : '<span class="muted focus-text">No focus logged</span>';
    row.innerHTML = `
        <div class="cell col-client">${esc(clientName)}</div>
        <div class="cell col-case-name">${esc(caseName)}</div>
        <div class="cell col-type">${esc(c.case_type || '—')}</div>
        <div class="cell col-stage">${esc(c.stage || '—')}</div>
        <div class="cell col-status"><span class="badge ${statusClassName}">${esc(statusText)}</span></div>
        <div class="cell col-focus">${focusHtml}</div>
        <div class="cell col-para">${esc(paralegalName || '—')}</div>
        <div class="cell col-due">
          <div class="due-inline">
            <span class="due-date">${fmtDate(c.next_due)}</span>
            <span class="micro muted due-relative">${relativeDue(c.next_due)}</span>
          </div>
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
  if (!focusListEl) return;
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
  if (!deadlinesEl) return;
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
  populateParalegalOptions(CASES);
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
  const author = focusAuthorSelect && focusAuthorSelect.value ? focusAuthorSelect.value : 'DW';
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
    populateParalegalOptions(CASES);
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
  filters = {
    search: '',
    stage: 'all',
    status: 'all',
    attention: 'all',
    paralegal: 'all',
    due: 'all',
    staleFocus: false,
  };
  $('#search').value = '';
  $('#filter_stage').value = 'all';
  $('#filter_status').value = 'all';
  $('#filter_attention').value = 'all';
  if (paralegalFilter) paralegalFilter.value = 'all';
  renderList();
}

function attachFilterListeners() {
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filters.search = e.target.value.trim();
      renderList();
    });
  }
  if (stageFilter) {
    stageFilter.addEventListener('change', (e) => {
      filters.stage = e.target.value;
      renderList();
    });
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      filters.status = e.target.value;
      renderList();
    });
  }
  if (attentionFilter) {
    attentionFilter.addEventListener('change', (e) => {
      filters.attention = e.target.value;
      renderList();
    });
  }
  if (paralegalFilter) {
    paralegalFilter.addEventListener('change', (e) => {
      filters.paralegal = e.target.value;
      renderList();
    });
  }
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);
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

quickFilterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.filter;
    const value = btn.dataset.value;
    if (type === 'attention') {
      const next = filters.attention === value ? 'all' : value;
      filters.attention = next;
      if (attentionFilter) attentionFilter.value = next;
    } else if (type === 'due') {
      filters.due = filters.due === value ? 'all' : value;
    } else if (type === 'stale') {
      filters.staleFocus = !filters.staleFocus;
    }
    renderList();
  });
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
