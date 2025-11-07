/* Colleague Board - TV-style interface */

// Constants
const POLL_MS = 30000;
const API = '/tv/cases';
const TIME_ZONE = 'America/New_York';

// DOM elements (matching TV structure)
const clockEl = () => document.getElementById('clock');
const dateEl = () => document.getElementById('date');
const liveIndicatorEl = () => document.getElementById('liveIndicator');
const rowsEl = () => document.getElementById('rows');
const metricTotalEl = () => document.getElementById('metricTotalLabel');
const searchInputEl = () => document.getElementById('searchInput');
const clearSearchEl = () => document.getElementById('clearSearch');
const caseDetailsEl = () => document.getElementById('caseDetails');
const closeDetailsEl = () => document.getElementById('closeDetails');

// State
let allCases = [];
let filteredCases = [];
let selectedCaseId = null;
let currentFilter = 'all';
let searchQuery = '';

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

// Utility functions
function escapeHtml(v) { 
  if (!v) return '';
  return String(v).replace(/[&<>'"]/g, ch => HTML_ESC[ch]); 
}

function escapeAttr(v) { 
  return escapeHtml(v).replace(/`/g, '&#96;'); 
}

function formatDate(dt) { 
  if (!dt) return '—'; 
  const d = new Date(dt); 
  if (Number.isNaN(d)) return '—'; 
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}); 
}

function formatTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d)) return '';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function getDaysUntilDue(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

function needsAttention(caseData) {
  const attention = (caseData.attention || '').toLowerCase();
  return attention === 'needs_attention' || attention.includes('need');
}

function isTopPriority(caseData) {
  return Boolean(caseData.top_priority);
}

function isDueSoon(caseData) {
  if (!caseData.next_due) return false;
  const days = getDaysUntilDue(caseData.next_due);
  return days !== null && days <= 7;
}

// Filter functions
function filterCases() {
  let filtered = [...allCases];
  
  // Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(c => 
      (c.client_name || '').toLowerCase().includes(query) ||
      (c.case_name || '').toLowerCase().includes(query) ||
      (c.case_number || '').toLowerCase().includes(query) ||
      (c.case_type || '').toLowerCase().includes(query)
    );
  }
  
  // Apply category filter
  switch (currentFilter) {
    case 'urgent':
      filtered = filtered.filter(needsAttention);
      break;
    case 'due-soon':
      filtered = filtered.filter(isDueSoon);
      break;
    case 'top-priority':
      filtered = filtered.filter(isTopPriority);
      break;
    // 'all' shows everything
  }
  
  filteredCases = filtered;
  renderCases();
  updateStats();
}

// Helper functions (matching TV interface)
function display(v) { return v || '—'; }

function badge(status) {
  const badgeClass = status === 'Active' ? 'active' : 
                   status === 'Closed' ? 'closed' : 
                   status === 'Pending' ? 'pending' : 'default';
  return `<span class="badge ${badgeClass}">${escapeHtml(status || '—')}</span>`;
}

function focusText(focus) {
  if (!focus) return '<span class="muted">No focus logged</span>';
  return `<span class="focus-text">${escapeHtml(focus)}</span>`;
}

function attentionClass(c) {
  return needsAttention(c) ? 'attention' : null;
}

// Case row rendering (exactly matching TV interface)
function row(c, info = {}) {
  const classes = ['trow', 'row', 'tv-row', info.accent || ''];
  const att = attentionClass(c);
  if (att) classes.push(att);
  if (c.top_priority) classes.push('top-priority');
  
  const client = display(c.client_name);
  const rawCaseNumber = (c.case_number ?? '').toString().trim();
  const caseName = display(c.case_name);
  const caseType = display(c.case_type);
  const county = display(c.county);
  
  const focus = c.current_focus ?? c.current_task;
  const ribbon = c.top_priority ? '<span class="priority-ribbon" aria-hidden="true"></span>' : '';
  const star = c.top_priority ? '<span class="priority-mark" title="Top Priority" aria-hidden="true">★</span>' : '';
  
  // Colleague task notification indicator
  const colleagueNotification = c.has_unreviewed_colleague_tasks ? 
    `<span class="colleague-notification" title="New colleague task (${c.unreviewed_colleague_task_count})">●</span>` : '';
  
  return `
  <div class="${classes.join(' ')}" data-case-id="${escapeAttr(c.id)}" data-group="${info.group || ''}">
    ${ribbon}
    <div class="cell col-client" title="${escapeAttr(client)}">
      <div class="client-line">
        ${star}<span class="client-name">${escapeHtml(client)}</span>${colleagueNotification}
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

function createStatusBadge(status) {
  if (!status || status === '—') return '<span class="badge none">No status</span>';
  
  const normalized = status.toLowerCase();
  let badgeClass = 'open';
  
  if (normalized.includes('active')) badgeClass = 'active';
  else if (normalized.includes('pre')) badgeClass = 'pre-filing';
  else if (normalized.includes('file')) badgeClass = 'filed';
  else if (normalized.includes('close')) badgeClass = 'closed';
  else if (normalized.includes('settle')) badgeClass = 'settlement';
  else if (normalized.includes('appeal')) badgeClass = 'appeal';
  
  return `<span class="badge ${badgeClass}">${escapeHtml(status)}</span>`;
}

function renderCases() {
  const container = rowsEl();
  if (!container) return;
  
  if (filteredCases.length === 0) {
    container.innerHTML = `
      <div class="no-cases" style="padding: 40px; text-align: center; color: #666;">
        ${searchQuery || currentFilter !== 'all' ? 'No cases match your filters.' : 'No cases available.'}
      </div>
    `;
    return;
  }
  
  // Sort cases: urgent first, then top priority, then by due date
  const sorted = [...filteredCases].sort((a, b) => {
    const aUrgent = needsAttention(a) ? 0 : 1;
    const bUrgent = needsAttention(b) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    
    const aPriority = isTopPriority(a) ? 0 : 1;
    const bPriority = isTopPriority(b) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    
    const aDays = getDaysUntilDue(a.next_due) ?? 9999;
    const bDays = getDaysUntilDue(b.next_due) ?? 9999;
    return aDays - bDays;
  });
  
  // Render cases using TV-style row function
  container.innerHTML = sorted.map(c => row(c, { accent: needsAttention(c) ? 'urgent' : 'normal' })).join('');
  
  // Add click listeners for case selection
  const rows = container.querySelectorAll('.trow, .tv-row, .row');
  rows.forEach(rowEl => {
    const caseId = rowEl.dataset.caseId;
    rowEl.addEventListener('click', () => {
      if (caseId) {
        selectCase(caseId);
      }
    });
  });
}

function updateStats() {
  const totalEl = metricTotalEl();
  
  if (totalEl) {
    const count = filteredCases.length;
    totalEl.textContent = count === 1 ? '1 case' : `${count} cases`;
  }
}

// Case selection
function selectCase(caseId) {
  selectedCaseId = caseId;
  
  // Update visual selection
  const allRows = document.querySelectorAll('.trow, .tv-row, .row');
  allRows.forEach(row => {
    row.classList.toggle('selected', row.dataset.caseId === caseId);
  });
  
  // Show details panel and load case details
  const caseDetails = caseDetailsEl();

  const sidebar = document.querySelector('.case-sidebar');
  if (sidebar) {
    sidebar.classList.add('open');
  }
  
  loadCaseDetails(caseId);
}

async function loadCaseDetails(caseId) {
  try {
    const response = await fetch(`/api/cases/${caseId}/details`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to fetch case details');
    
    const caseData = await response.json();
    
    // Update details header
    const caseNameEl = document.getElementById('detailsCaseName');
    const clientNameEl = document.getElementById('detailsClientName');
    const caseMetaEl = document.getElementById('detailsCaseMeta');
    
    if (caseNameEl) caseNameEl.textContent = caseData.case_name || 'Unnamed Case';
    if (clientNameEl) clientNameEl.textContent = caseData.client_name || 'Unknown Client';
    
    if (caseMetaEl) {
      caseMetaEl.innerHTML = `
        <span>${escapeHtml(caseData.case_type || 'Unknown Type')}</span> • 
        <span>${escapeHtml(caseData.status || 'No Status')}</span> • 
        <span>${escapeHtml(caseData.county || 'No County')}</span>
      `;
    }
    
    // Render focus history
    renderFocusHistory(caseData.focus_log || []);
    
    // Render colleague tasks
    renderColleagueTasks(caseData.colleague_tasks || []);
    
  } catch (err) {
    console.error('Error loading case details:', err);
    alert('Failed to load case details. Please try again.');
  }
}

function renderFocusHistory(focusLog) {
  const container = document.getElementById('focusHistoryList');
  if (!container) return;
  
  if (!focusLog || focusLog.length === 0) {
    container.innerHTML = '<div class="no-history">No focus history available.</div>';
    return;
  }
  
  // Sort by date (newest first) and take last 5
  const recent = [...focusLog]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 5);
  
  const html = recent.map(entry => `
    <div class="focus-item">
      <div class="focus-meta">
        <span class="focus-author">${escapeHtml(entry.author)}</span>
        <span class="focus-date">${formatTime(entry.at)}</span>
      </div>
      <div class="focus-text">${escapeHtml(entry.text)}</div>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

function renderColleagueTasks(tasks) {
  const container = document.getElementById('tasksList');
  if (!container) return;
  
  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<div class="no-tasks">No tasks yet for this case.</div>';
    return;
  }
  
  // Sort by date (newest first)
  const sorted = [...tasks].sort((a, b) => new Date(b.at) - new Date(a.at));
  
  const html = sorted.map(task => `
    <div class="colleague-task ${task.reviewed ? 'reviewed' : ''}">
      <div class="colleague-meta">
        <span class="colleague-author">${escapeHtml(task.author)}</span>
        <span class="colleague-date">${formatTime(task.at)}</span>
      </div>
      <div class="colleague-task-text">${escapeHtml(task.task)}</div>
      ${task.reviewed ? '<div class="task-status">✓ Reviewed</div>' : '<div class="task-status">• New</div>'}
    </div>
  `).join('');
  
  container.innerHTML = html;
}

// Task submission
async function addColleagueTask(taskText, authorInitials) {
  if (!selectedCaseId) {
    alert('Please select a case first.');
    return false;
  }
  
  try {
    const response = await fetch(`/api/cases/${selectedCaseId}/colleague-tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: taskText,
        author: authorInitials
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to add task');
    }
    
    // Refresh the case details
    await loadCaseDetails(selectedCaseId);
    return true;
    
  } catch (err) {
    console.error('Error adding colleague task:', err);
    alert(`Failed to add task: ${err.message}`);
    return false;
  }
}

// Event handlers
function setupEventListeners() {
  // Search functionality
  const searchInput = searchInputEl();
  const clearSearch = clearSearchEl();
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      filterCases();
    });
  }
  
  if (clearSearch) {
    clearSearch.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchQuery = '';
        filterCases();
      }
    });
  }
  
  // Filter pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      filterCases();
    });
  });
  
  // Task form
  const taskForm = document.getElementById('addTaskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const taskText = document.getElementById('taskText').value.trim();
      const authorInitials = document.getElementById('authorSelect').value;
      
      if (!taskText || !authorInitials) {
        alert('Please fill in both task description and your initials.');
        return;
      }
      
      const success = await addColleagueTask(taskText, authorInitials);
      if (success) {
        taskForm.reset();
      }
    });
  }
  
  // Clear task form
  const cancelBtn = document.getElementById('cancelTask');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (taskForm) taskForm.reset();
    });
  }
  
  // Close details panel
  const closeBtn = closeDetailsEl();
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      selectedCaseId = null;
      document.querySelectorAll('.tv-row').forEach(row => {
        row.classList.remove('selected');
      });
      
      // Hide details panel
      const detailsPanel = caseDetailsEl();
      const sidebar = document.querySelector('.case-sidebar');
      if (sidebar) {
        sidebar.classList.remove('open');
      }

      if (detailsPanel) {
        resetCaseDetails();
      }
    });
  }
}

// Data loading
async function loadCases() {
  try {
    const response = await fetch(API, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    allCases = Array.isArray(data.cases) ? data.cases : [];
    
    filterCases(); // This will call renderCases() and updateStats()
    
    // Update live indicator
    const indicator = liveIndicatorEl();
    if (indicator) {
      indicator.textContent = '● LIVE';
      indicator.style.color = '#10b981'; // green
    }
    
  } catch (err) {
    console.error('Failed to load cases:', err);
    
    // Update live indicator to show offline state
    const indicator = liveIndicatorEl();
    if (indicator) {
      indicator.textContent = '● OFFLINE';
      indicator.style.color = '#ef4444'; // red
    }
    
    // Show error message in cases container
    const container = rowsEl();
    if (container) {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #ef4444;">
          <p>Failed to load cases</p>
          <p style="color: #666; margin-top: 8px;">Please check your connection and refresh the page</p>
        </div>
      `;
    }
  }
}

// Clock and date functions
function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('date');
  
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: TIME_ZONE
    });
  }
  
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: TIME_ZONE
    });
  }
}

// Initialize the application
function init() {
  updateClock();
  setInterval(updateClock, 1000);
  
  loadCases();
  setInterval(loadCases, POLL_MS);
  
  setupEventListeners();
  resetCaseDetails();
  
  // Initial details panel state (hidden)
  const sidebar = document.querySelector('.case-sidebar');
  if (sidebar) {
    sidebar.classList.remove('open');
  }
}

function resetCaseDetails() {
  const caseNameEl = document.getElementById('detailsCaseName');
  const clientNameEl = document.getElementById('detailsClientName');
  const caseMetaEl = document.getElementById('detailsCaseMeta');
  const focusList = document.getElementById('focusHistoryList');
  const tasksList = document.getElementById('tasksList');

  if (caseNameEl) caseNameEl.textContent = 'Select a Case';
  if (clientNameEl) clientNameEl.textContent = '';
  if (caseMetaEl) caseMetaEl.innerHTML = '';
  if (focusList) {
    focusList.innerHTML = '<div class="loading">Select a case to view history...</div>';
  }
  if (tasksList) {
    tasksList.innerHTML = '<div class="no-tasks">Select a case to view tasks.</div>';
  }
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', init);