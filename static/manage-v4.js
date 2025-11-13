const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const elements = {
  table: $('#case-table'),
  caseCount: $('#case-count'),
  attentionCount: $('#attention-count'),
  dueCount: $('#due-count'),
  staleCount: $('#stale-count'),
  visibleCount: $('#visible-count'),
  filters: {
    search: $('#filter-search'),
    stage: $('#filter-stage'),
    status: $('#filter-status'),
    attention: $('#filter-attention'),
    paralegal: $('#filter-paralegal'),
  },
  clearFilters: $('#clear-filters'),
  detail: {
    title: $('#detail-title'),
    subtitle: $('#detail-subtitle'),
    meta: {
      client: $('#meta-client'),
      case: $('#meta-case'),
      type: $('#meta-type'),
      paralegal: $('#meta-paralegal'),
      stage: $('#meta-stage'),
      status: $('#meta-status'),
      number: $('#meta-number'),
      county: $('#meta-county'),
      judge: $('#meta-judge'),
      due: $('#meta-due'),
    },
    focusUpdated: $('#meta-focus-updated'),
    deadlines: $('#deadlines-list'),
    addDeadline: $('#add-deadline'),
    focusForm: $('#focus-form'),
    focusInput: $('#focus-input'),
    focusSubmit: $('#focus-submit'),
    focusAuthor: $('#focus-author'),
    focusLog: $('#focus-log'),
  },
  tags: {
    needs: $('#tag-needs'),
    waiting: $('#tag-waiting'),
    clear: $('#tag-clear'),
    priority: $('#tag-priority'),
  },
  actions: {
    open: $('#action-open'),
    archive: $('#action-archive'),
    deleteCase: $('#action-delete'),
  },
  add: {
    button: $('#action-add'),
    overlay: $('#add-overlay'),
    clientInput: $('#add-client'),
    caseInput: $('#add-case'),
    typeInput: $('#add-type'),
    submit: $('#add-submit'),
    cancel: $('#add-cancel'),
  }
};

const state = {
  cases: [],
  filters: {
    search: '',
    stage: 'all',
    status: 'all',
    attention: 'all',
    paralegal: 'all',
  },
  selectedId: null,
  get selectedCase() {
    return state.cases.find((c) => c.id === state.selectedId) || null;
  },
};

const MS_PER_DAY = 86400000;

function escapeHtml(input) {
  return (input ?? '')
    .toString()
    .replace(/[&<>"']/g, (match) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match] ?? match));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDue(value) {
  if (!value) return '';
  const now = new Date();
  const due = new Date(`${value}T00:00:00`);
  if (Number.isNaN(due.getTime())) return '';
  const diff = Math.round((due - now) / MS_PER_DAY);
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 7) return `Due in ${diff} days`;
  return due.toLocaleDateString();
}

function normalizeStatus(status) {
  if (!status) return '';
  if (/^pre[-\s]?fil/i.test(status)) return 'Pre-Filing';
  return status;
}

function displayStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized || '—';
}

function hasStaleFocus(caseData, threshold = 14) {
  const log = Array.isArray(caseData.focus_log) ? caseData.focus_log : [];
  if (!log.length) return true;
  const latest = log[log.length - 1];
  if (!latest?.at) return true;
  const at = new Date(latest.at);
  if (Number.isNaN(at.getTime())) return true;
  const today = new Date();
  return Math.floor((today - at) / MS_PER_DAY) >= threshold;
}

function dueInDays(caseData) {
  if (!caseData.next_due) return null;
  const due = new Date(`${caseData.next_due}T00:00:00`);
  const today = new Date();
  return Math.floor((due - today) / MS_PER_DAY);
}

function isDueSoon(caseData) {
  const days = dueInDays(caseData);
  if (days === null) return false;
  return days <= 7;
}

function isOverdue(caseData) {
  const days = dueInDays(caseData);
  if (days === null) return false;
  return days < 0;
}

function applyFilters(list) {
  return list
    .filter((item) => !item.archived)
    .filter((item) => {
      if (state.filters.stage !== 'all' && item.stage !== state.filters.stage) return false;
      if (state.filters.status !== 'all' && displayStatus(item.status) !== state.filters.status) return false;
      if (state.filters.attention !== 'all' && item.attention !== state.filters.attention) return false;
      if (state.filters.paralegal !== 'all') {
        const para = (item.paralegal || '').trim().toLowerCase();
        if (para !== state.filters.paralegal.toLowerCase()) return false;
      }
      if (!state.filters.search) return true;
      const haystack = [item.client_name, item.case_name, item.paralegal, item.case_number, item.county]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(state.filters.search.toLowerCase());
    })
    .sort((a, b) => {
      const attentionRank = { needs_attention: 0, waiting: 1, '': 2 };
      const attA = attentionRank[a.attention ?? ''] ?? 3;
      const attB = attentionRank[b.attention ?? ''] ?? 3;
      if (attA !== attB) return attA - attB;
      const dueA = a.next_due ? new Date(a.next_due) : null;
      const dueB = b.next_due ? new Date(b.next_due) : null;
      if (dueA && dueB && dueA.getTime() !== dueB.getTime()) return dueA - dueB;
      if (!dueA && dueB) return 1;
      if (dueA && !dueB) return -1;
      return (a.client_name || '').localeCompare(b.client_name || '');
    });
}

function updateMetrics(filtered) {
  const total = state.cases.filter((c) => !c.archived).length;
  const needsAttention = state.cases.filter((c) => !c.archived && c.attention === 'needs_attention').length;
  const dueSoon = state.cases.filter((c) => !c.archived && isDueSoon(c)).length;
  const staleFocus = state.cases.filter((c) => !c.archived && hasStaleFocus(c)).length;
  if (elements.caseCount) elements.caseCount.textContent = `${total} case${total === 1 ? '' : 's'}`;
  if (elements.attentionCount) elements.attentionCount.textContent = `${needsAttention} need attention`;
  if (elements.dueCount) elements.dueCount.textContent = `${dueSoon} due soon`;
  if (elements.staleCount) elements.staleCount.textContent = `${staleFocus} stale focus`;
  if (elements.visibleCount) {
    const count = filtered.length;
    elements.visibleCount.textContent = `${count} shown`;
  }
}

function populateParalegalOptions() {
  const select = elements.filters.paralegal;
  if (!select) return;
  const existing = state.filters.paralegal;
  const names = Array.from(
    new Set(
      state.cases
        .filter((c) => c?.paralegal)
        .map((c) => c.paralegal.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  select.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = 'All paralegals';
  select.append(defaultOption);
  names.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  });
  if (existing && existing !== 'all' && names.some((n) => n.toLowerCase() === existing.toLowerCase())) {
    select.value = names.find((n) => n.toLowerCase() === existing.toLowerCase());
    state.filters.paralegal = select.value;
  } else {
    select.value = 'all';
    state.filters.paralegal = 'all';
  }
}

function badgeClass(status) {
  const normalized = displayStatus(status).toLowerCase();
  if (normalized.includes('settlement')) return 'bg-emerald-500/20 text-emerald-200';
  if (normalized.includes('prospect')) return 'bg-sky-500/20 text-sky-200';
  if (normalized.includes('appeal')) return 'bg-indigo-500/20 text-indigo-200';
  if (normalized.includes('post-trial')) return 'bg-amber-500/20 text-amber-200';
  if (normalized.includes('trial')) return 'bg-rose-500/20 text-rose-200';
  if (normalized.includes('pre-filing')) return 'bg-brand-surfaceDeep text-brand-muted';
  return 'bg-brand-surfaceDeep text-brand-text';
}

function highlightSelectedRow() {
  $$('#case-table tr[data-id]').forEach((row) => {
    row.classList.toggle('bg-brand-surfaceDeep/70', row.dataset.id === state.selectedId);
    row.classList.toggle('outline', row.dataset.id === state.selectedId);
    row.classList.toggle('outline-brand-copper/60', row.dataset.id === state.selectedId);
  });
}

function emptyTableState(message) {
  const row = document.createElement('tr');
  row.innerHTML = `<td colspan="4" class="px-4 py-10 text-center text-brand-muted">${escapeHtml(message)}</td>`;
  return row;
}

function renderTable() {
  if (!elements.table) return;
  const filtered = applyFilters(state.cases);
  updateMetrics(filtered);
  elements.table.innerHTML = '';
  if (!filtered.length) {
    elements.table.append(emptyTableState('No cases match your filters.'));
    highlightSelectedRow();
    return;
  }
  filtered.forEach((item) => {
    const row = document.createElement('tr');
    row.dataset.id = item.id;
    row.tabIndex = 0;
    const focusText = (item.current_focus || '').trim() || 'No focus logged';
    const focusColor = item.current_focus ? 'text-brand-text' : 'text-brand-muted';
    const dueText = formatDate(item.next_due);
    const relative = relativeDue(item.next_due);
    const priorityChecked = item.top_priority ? 'checked' : '';
    const relativeMarkup = relative ? ` • <span class="text-brand-muted">${escapeHtml(relative)}</span>` : '';
  // base row classes
  row.className = 'transition hover:bg-brand-surfaceDeep/70 focus:outline-none focus-visible:bg-brand-surfaceDeep/70 row-accent';
  // attention / waiting / priority markers
  if (item.attention === 'needs_attention') row.classList.add('row-needs');
  else if (item.attention === 'waiting') row.classList.add('row-waiting');
  if (item.top_priority) row.classList.add('row-priority');
    // Render compact row: Client | Case | Type | Last Focus timestamp
    const latestFocus = Array.isArray(item.focus_log) && item.focus_log.length ? item.focus_log[item.focus_log.length - 1] : null;
    const latestAt = latestFocus && latestFocus.at ? new Date(latestFocus.at) : null;
    const latestAtText = latestAt && !Number.isNaN(latestAt.getTime()) ? latestAt.toLocaleString() : '—';
    row.innerHTML = `
      <td class="whitespace-nowrap px-4 py-3 font-medium text-brand-text">${escapeHtml(item.client_name || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3 text-brand-text">${escapeHtml(item.case_name || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3 text-brand-muted">${escapeHtml(item.case_type || '—')}</td>
      <td class="whitespace-nowrap px-4 py-3 text-brand-muted flex items-center justify-between">
        <span class="flex-1">${escapeHtml(latestAtText)}</span>
        <button type="button" class="quick-focus-btn ml-3 rounded border border-brand-border px-2 py-1 text-xs text-brand-muted hover:border-brand-copper" title="Quick add focus">+</button>
      </td>
    `;
    // attach quick-focus handler
    const qbtn = row.querySelector('.quick-focus-btn');
    if (qbtn) {
      qbtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickFocus(item.id);
      });
    }
    row.addEventListener('click', () => selectCase(item.id));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectCase(item.id);
      }
    });
    elements.table.append(row);
  });
  highlightSelectedRow();
}

function clearDetailPanel() {
  state.selectedId = null;
  const { detail, tags, actions } = elements;
  detail.title.textContent = 'Choose a case';
  detail.subtitle.textContent = 'Pick a matter to view its full context.';
  Object.values(detail.meta).forEach((node) => {
    if (node) node.textContent = '—';
  });
  if (detail.focusUpdated) detail.focusUpdated.textContent = '—';
  if (detail.deadlines) {
    detail.deadlines.innerHTML = '';
    detail.deadlines.append(emptyDetailState('Select a case to see deadlines.'));
  }
  if (detail.focusLog) {
    detail.focusLog.innerHTML = '';
    detail.focusLog.append(emptyDetailState('Select a case to view focus history.'));
  }
  disableCaseActions(true);
  highlightSelectedRow();
}

function disableCaseActions(disabled) {
  const controls = [
    elements.detail.addDeadline,
    elements.detail.focusForm,
    elements.detail.focusInput,
    elements.detail.focusSubmit,
    elements.detail.focusAuthor,
    elements.tags.needs,
    elements.tags.waiting,
    elements.tags.clear,
    elements.tags.priority,
    elements.actions.open,
    elements.actions.archive,
    elements.actions.deleteCase,
  ];
  controls.forEach((el) => {
    if (!el) return;
    if (el instanceof HTMLFormElement) {
      Array.from(el.elements).forEach((child) => {
        child.disabled = disabled;
      });
    } else {
      el.disabled = disabled;
    }
  });
}

function emptyDetailState(message) {
  const div = document.createElement('div');
  div.className = 'rounded-lg border border-dashed border-brand-border px-4 py-3 text-center text-sm text-brand-muted';
  div.textContent = message;
  return div;
}

function renderDeadlines(caseData) {
  const container = elements.detail.deadlines;
  if (!container) return;
  container.innerHTML = '';
  const deadlines = Array.isArray(caseData.deadlines) ? caseData.deadlines : [];
  if (!deadlines.length) {
    container.append(emptyDetailState('No deadlines yet.'));
    return;
  }
  deadlines.forEach((item, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'rounded-lg border border-brand-border bg-brand-surfaceDeep/60 px-4 py-4';
    wrapper.dataset.index = String(index);
    wrapper.innerHTML = `
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.28em] text-brand-muted sm:w-44">
          Due Date
          <input type="date" value="${item.due_date ?? ''}" class="deadline-date rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:border-brand-copper focus:ring-brand-copper" />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-xs uppercase tracking-[0.28em] text-brand-muted">
          Description
          <input type="text" value="${escapeHtml(item.description || '')}" class="deadline-desc rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text focus:border-brand-copper focus:ring-brand-copper" placeholder="e.g., Discovery responses" />
        </label>
      </div>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button type="button" class="deadline-toggle inline-flex items-center gap-2 rounded-full border border-brand-border px-3 py-1.5 text-xs transition hover:border-brand-copper hover:text-brand-text ${
          item.resolved ? 'text-emerald-300' : 'text-brand-muted'
        }">
          ${item.resolved ? 'Mark Active' : 'Mark Complete'}
        </button>
        <div class="flex items-center gap-2 text-xs text-brand-muted">
          <span class="rounded-full bg-brand-surface px-2 py-1 font-mono text-[11px]">${item.resolved ? 'Resolved' : 'Open'}</span>
          <button type="button" class="deadline-remove rounded-full border border-brand-border px-3 py-1.5 text-xs text-brand-muted transition hover:border-red-400 hover:text-red-200">
            Remove
          </button>
        </div>
      </div>
    `;
    const dateInput = $('.deadline-date', wrapper);
    const descInput = $('.deadline-desc', wrapper);
    const toggleBtn = $('.deadline-toggle', wrapper);
    const removeBtn = $('.deadline-remove', wrapper);
    if (dateInput) {
      dateInput.addEventListener('change', () => updateDeadline(index, { due_date: dateInput.value || null }));
    }
    if (descInput) {
      descInput.addEventListener('blur', () => updateDeadline(index, { description: descInput.value.trim() }));
    }
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => updateDeadline(index, { resolved: !item.resolved }));
    }
    if (removeBtn) {
      removeBtn.addEventListener('click', () => removeDeadline(index));
    }
    container.append(wrapper);
  });
}

function renderFocusLog(caseData) {
  const list = elements.detail.focusLog;
  if (!list) return;
  list.innerHTML = '';
  const entries = Array.isArray(caseData.focus_log) ? [...caseData.focus_log] : [];
  if (!entries.length) {
    list.append(emptyDetailState('No focus entries yet.'));
    return;
  }
  entries
    .slice()
    .reverse()
    .forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'rounded-lg border border-brand-border bg-brand-surfaceDeep/60 px-4 py-3';
      const at = entry.at ? new Date(entry.at) : null;
      const timestamp = at && !Number.isNaN(at.getTime()) ? at.toLocaleString() : '—';
      item.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-mono text-xs text-brand-muted">${escapeHtml(timestamp)}</span>
          <span class="rounded-full bg-brand-surface px-2 py-1 text-xs text-brand-muted">${escapeHtml(entry.author || '—')}</span>
        </div>
        <p class="mt-2 text-sm text-brand-text">${escapeHtml(entry.text || '')}</p>
      `;
      list.append(item);
    });
}

function updateDetailPanel(caseData) {
  if (!caseData) {
    clearDetailPanel();
    return;
  }
  disableCaseActions(false);
  const { detail, tags, actions } = elements;
  detail.title.textContent = caseData.client_name || 'Untitled case';
  const statusLabel = caseData.attention === 'needs_attention' ? 'Needs Attention' : caseData.attention === 'waiting' ? 'Waiting' : 'Normal';
  const priorityLabel = caseData.top_priority ? ' • Top Priority' : '';
  const archivedLabel = caseData.archived ? ' • Archived' : '';
  detail.subtitle.textContent = `${caseData.case_name || '—'} • ${statusLabel}${priorityLabel}${archivedLabel}`;
  detail.meta.client.textContent = caseData.client_name || '—';
  detail.meta.case.textContent = caseData.case_name || '—';
  detail.meta.type.textContent = caseData.case_type || '—';
  detail.meta.paralegal.textContent = caseData.paralegal || '—';
  detail.meta.stage.textContent = caseData.stage || '—';
  detail.meta.status.textContent = displayStatus(caseData.status);
  detail.meta.number.textContent = caseData.case_number || '—';
  detail.meta.county.textContent = caseData.county || '—';
  detail.meta.judge.textContent = caseData.judge || '—';
  const dueLabel = caseData.next_due ? `${formatDate(caseData.next_due)} (${relativeDue(caseData.next_due) || 'Upcoming'})` : '—';
  detail.meta.due.textContent = dueLabel;
  const latestFocus = Array.isArray(caseData.focus_log) && caseData.focus_log.length ? caseData.focus_log[caseData.focus_log.length - 1] : null;
  if (detail.focusUpdated) {
    detail.focusUpdated.textContent = latestFocus?.at ? new Date(latestFocus.at).toLocaleString() : '—';
  }
  if (elements.detail.focusAuthor) elements.detail.focusAuthor.value = 'DW';
  if (elements.actions.archive) elements.actions.archive.textContent = caseData.archived ? 'Unarchive' : 'Archive';
  [tags.needs, tags.waiting, tags.clear].forEach((btn) => {
    if (!btn) return;
    const active =
      (btn === tags.needs && caseData.attention === 'needs_attention') ||
      (btn === tags.waiting && caseData.attention === 'waiting') ||
      (btn === tags.clear && !caseData.attention);
    btn.classList.toggle('border-brand-copper', active);
    btn.classList.toggle('text-brand-text', active);
  });
  if (tags.priority) {
    tags.priority.classList.toggle('border-brand-copper', !!caseData.top_priority);
    tags.priority.classList.toggle('text-brand-text', !!caseData.top_priority);
  }
  renderDeadlines(caseData);
  renderFocusLog(caseData);
}

function mergeCaseUpdate(updated) {
  if (!updated) return;
  const idx = state.cases.findIndex((c) => c.id === updated.id);
  if (idx !== -1) {
    state.cases[idx] = updated;
  } else {
    state.cases.push(updated);
  }
  renderTable();
  if (state.selectedId === updated.id) {
    updateDetailPanel(updated);
    highlightSelectedRow();
  }
}

async function loadCases({ preserveSelection = false } = {}) {
  try {
    const response = await fetch('/api/cases', { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load cases');
    const data = await response.json();
    state.cases = Array.isArray(data.cases) ? data.cases : [];
    populateParalegalOptions();
    renderTable();
    if (preserveSelection && state.selectedId) {
      const exists = state.cases.some((c) => c.id === state.selectedId);
      if (exists) {
        updateDetailPanel(state.selectedCase);
        highlightSelectedRow();
      } else {
        clearDetailPanel();
      }
    } else {
      clearDetailPanel();
    }
  } catch (error) {
    console.error(error);
    if (elements.table) {
      elements.table.innerHTML = '';
      elements.table.append(emptyTableState('Unable to load cases.'));
    }
  }
}

function selectCase(id) {
  state.selectedId = id;
  const caseData = state.selectedCase;
  if (!caseData) {
    clearDetailPanel();
    return;
  }
  highlightSelectedRow();
  updateDetailPanel(caseData);
}

function resetFilters() {
  state.filters = {
    search: '',
    stage: 'all',
    status: 'all',
    attention: 'all',
    paralegal: 'all',
  };
  const { filters } = elements;
  filters.search.value = '';
  filters.stage.value = 'all';
  filters.status.value = 'all';
  filters.attention.value = 'all';
  filters.paralegal.value = 'all';
  renderTable();
}

async function updateAttention(stateValue) {
  if (!state.selectedId) return;
  try {
    const response = await fetch(`/api/cases/${state.selectedId}/attention/${stateValue}`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to update attention');
    const updated = await response.json();
    mergeCaseUpdate(updated);
  } catch (error) {
    console.error(error);
    alert('Unable to update attention.');
  }
}

async function togglePriority() {
  if (!state.selectedId) return;
  try {
    const response = await fetch(`/api/cases/${state.selectedId}/priority/toggle`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to toggle priority');
    const updated = await response.json();
    mergeCaseUpdate(updated);
  } catch (error) {
    console.error(error);
    alert('Unable to toggle priority.');
  }
}

async function toggleArchive() {
  if (!state.selectedId) return;
  try {
    const response = await fetch(`/api/cases/${state.selectedId}/archive/toggle`, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to toggle archive');
    const updated = await response.json();
    mergeCaseUpdate(updated);
  } catch (error) {
    console.error(error);
    alert('Unable to toggle archive.');
  }
}

async function deleteCase() {
  if (!state.selectedId) return;
  const confirmed = window.confirm('Delete this case? This action cannot be undone.');
  if (!confirmed) return;
  try {
    const response = await fetch(`/api/cases/${state.selectedId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) throw new Error('Failed to delete case');
    state.selectedId = null;
    await loadCases();
  } catch (error) {
    console.error(error);
    alert('Unable to delete this case.');
  }
}

async function addFocusEntry(text) {
  const selected = state.selectedCase;
  if (!selected) return;
  const author = elements.detail.focusAuthor?.value || 'DW';
  try {
    const response = await fetch(`/api/cases/${selected.id}/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ at: new Date().toISOString(), author, text }),
    });
    if (!response.ok) throw new Error('Failed to add focus');
    const updated = await response.json();
    mergeCaseUpdate(updated);
  } catch (error) {
    console.error(error);
    alert('Unable to add focus entry.');
  }
}

async function persistDeadlines(deadlines) {
  const selected = state.selectedCase;
  if (!selected) return;
  try {
    const response = await fetch(`/api/cases/${selected.id}/deadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deadlines),
    });
    if (!response.ok) throw new Error('Failed to update deadlines');
    const updated = await response.json();
    mergeCaseUpdate(updated);
  } catch (error) {
    console.error(error);
    alert('Unable to update deadlines.');
    await loadCases({ preserveSelection: true });
  }
}

function updateDeadline(index, patch) {
  const selected = state.selectedCase;
  if (!selected) return;
  const deadlines = Array.isArray(selected.deadlines) ? selected.deadlines.map((d) => ({ ...d })) : [];
  if (!deadlines[index]) return;
  deadlines[index] = { ...deadlines[index], ...patch };
  persistDeadlines(deadlines);
}

function removeDeadline(index) {
  const selected = state.selectedCase;
  if (!selected) return;
  const deadlines = Array.isArray(selected.deadlines) ? selected.deadlines.map((d) => ({ ...d })) : [];
  if (!deadlines[index]) return;
  deadlines.splice(index, 1);
  persistDeadlines(deadlines);
}

function addDeadline() {
  const selected = state.selectedCase;
  if (!selected) {
    alert('Select a case first.');
    return;
  }
  const next = Array.isArray(selected.deadlines) ? selected.deadlines.map((d) => ({ ...d })) : [];
  next.push({ due_date: new Date().toISOString().slice(0, 10), description: '', resolved: false });
  persistDeadlines(next);
}

function attachListeners() {
  elements.filters.search?.addEventListener('input', (event) => {
    state.filters.search = event.target.value.trim();
    renderTable();
  });
  elements.filters.stage?.addEventListener('change', (event) => {
    state.filters.stage = event.target.value;
    renderTable();
  });
  elements.filters.status?.addEventListener('change', (event) => {
    state.filters.status = event.target.value;
    renderTable();
  });
  elements.filters.attention?.addEventListener('change', (event) => {
    state.filters.attention = event.target.value;
    renderTable();
  });
  elements.filters.paralegal?.addEventListener('change', (event) => {
    state.filters.paralegal = event.target.value;
    renderTable();
  });
  elements.clearFilters?.addEventListener('click', resetFilters);

  elements.tags.needs?.addEventListener('click', () => updateAttention('needs_attention'));
  elements.tags.waiting?.addEventListener('click', () => updateAttention('waiting'));
  elements.tags.clear?.addEventListener('click', () => updateAttention(''));
  elements.tags.priority?.addEventListener('click', togglePriority);

  elements.actions.open?.addEventListener('click', () => {
    if (!state.selectedId) return;
    window.open(`/edit?id=${encodeURIComponent(state.selectedId)}`, '_blank');
  });
  elements.actions.archive?.addEventListener('click', toggleArchive);
  elements.actions.deleteCase?.addEventListener('click', deleteCase);
  elements.detail.addDeadline?.addEventListener('click', addDeadline);

  // Add Case listeners
  if (elements.add && elements.add.button) {
    elements.add.button.addEventListener('click', (e) => {
      e.preventDefault();
      openAddCase();
    });
  }
  if (elements.add && elements.add.cancel) elements.add.cancel.addEventListener('click', (e) => { e.preventDefault(); closeAddCase(); });
  if (elements.add && elements.add.submit) elements.add.submit.addEventListener('click', submitAddCase);

  if (elements.detail.focusForm) {
    elements.detail.focusForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = elements.detail.focusInput?.value.trim();
      if (!text) return;
      await addFocusEntry(text);
      if (elements.detail.focusInput) {
        elements.detail.focusInput.value = '';
        elements.detail.focusInput.focus();
      }
    });
  }
}

attachListeners();
loadCases();

// ---- Quick Focus modal logic ----
const qfOverlay = document.getElementById('qf-overlay');
const qfInput = document.getElementById('qf-input');
const qfSubmit = document.getElementById('qf-submit');
const qfCancel = document.getElementById('qf-cancel');
let qfTargetId = null;

function openQuickFocus(caseId) {
  qfTargetId = caseId;
  if (qfOverlay) {
    qfOverlay.style.display = 'flex';
    qfOverlay.setAttribute('aria-hidden', 'false');
  }
  if (qfInput) {
    qfInput.value = '';
    setTimeout(() => qfInput.focus(), 50);
  }
}

function closeQuickFocus() {
  qfTargetId = null;
  if (qfOverlay) {
    qfOverlay.style.display = 'none';
    qfOverlay.setAttribute('aria-hidden', 'true');
  }
  if (qfInput) qfInput.value = '';
}

async function submitQuickFocus() {
  if (!qfTargetId) return;
  const text = qfInput?.value?.trim();
  if (!text) return;
  try {
    const payload = { at: new Date().toISOString(), author: (elements.detail.focusAuthor?.value || 'DW'), text };
    const r = await fetch(`/api/cases/${encodeURIComponent(qfTargetId)}/focus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('Failed to add focus');
    const updated = await r.json();
    mergeCaseUpdate(updated);
    closeQuickFocus();
  } catch (err) {
    console.error(err);
    alert('Unable to save focus.');
  }
}

if (qfSubmit) qfSubmit.addEventListener('click', submitQuickFocus);
if (qfCancel) qfCancel.addEventListener('click', (e) => { e.preventDefault(); closeQuickFocus(); });
if (qfInput) {
  qfInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitQuickFocus();
    } else if (e.key === 'Escape') {
      closeQuickFocus();
    }
  });
}
// close when clicking overlay itself
if (qfOverlay) {
  qfOverlay.addEventListener('click', (e) => {
    if (e.target === qfOverlay) closeQuickFocus();
  });
}

// ---- Add Case modal logic ----
const addOverlay = document.getElementById('add-overlay');
const addClient = document.getElementById('add-client');
const addCaseInput = document.getElementById('add-case');
const addType = document.getElementById('add-type');
let addInProgress = false;

function openAddCase() {
  if (addOverlay) {
    addOverlay.style.display = 'flex';
    addOverlay.setAttribute('aria-hidden', 'false');
  }
  if (addClient) addClient.value = '';
  if (addCaseInput) addCaseInput.value = '';
  if (addType) addType.value = '';
  setTimeout(() => addClient?.focus(), 40);
}

function closeAddCase() {
  if (addOverlay) {
    addOverlay.style.display = 'none';
    addOverlay.setAttribute('aria-hidden', 'true');
  }
  if (addClient) addClient.value = '';
  if (addCaseInput) addCaseInput.value = '';
  if (addType) addType.value = '';
  addInProgress = false;
}

async function submitAddCase() {
  if (addInProgress) return;
  const client = addClient?.value?.trim();
  const casetitle = addCaseInput?.value?.trim();
  const type = addType?.value?.trim() || 'General';
  if (!client || !casetitle) {
    alert('Client name and case title are required.');
    return;
  }
  addInProgress = true;
  try {
    const payload = { client_name: client, case_name: casetitle, case_type: type };
    const r = await fetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('Failed to create case');
    const created = await r.json();
    mergeCaseUpdate(created);
    // select the newly created case
    state.selectedId = created.id;
    updateDetailPanel(created);
    populateParalegalOptions();
    closeAddCase();
  } catch (err) {
    console.error(err);
    alert('Unable to create case.');
  } finally {
    addInProgress = false;
  }
}

if (addOverlay) {
  addOverlay.addEventListener('click', (e) => {
    if (e.target === addOverlay) closeAddCase();
  });
}

if (addClient) {
  addClient.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCaseInput?.focus();
    } else if (e.key === 'Escape') closeAddCase();
  });
}

if (addCaseInput) {
  addCaseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAddCase();
    } else if (e.key === 'Escape') closeAddCase();
  });
}

if (addType) {
  addType.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAddCase();
    } else if (e.key === 'Escape') closeAddCase();
  });
}

