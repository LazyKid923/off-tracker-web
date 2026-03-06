const API_BASE = window.OFF_TRACKER_API_BASE || 'http://localhost:8787/api';
const PERSONNEL_META_KEY = 'offTracker.personnelMeta.v1';
const state = {
  personnel: [],
  selectedPersonnelId: null,
  grants: [],
  usages: [],
  logs: []
};
let personnelMeta = loadPersonnelMeta();
const modalRoot = document.getElementById('modalRoot');
let onboardingPromptOpen = false;

init();

async function init() {
  bindTopbarActions();
  bindTabs();
  try {
    await refreshFromApi();
  } catch (err) {
    alert(`Failed to load data from backend: ${err.message || String(err)}`);
  }
}

function saveState() {
  // Backend is source of truth.
}

function loadPersonnelMeta() {
  try {
    const raw = localStorage.getItem(PERSONNEL_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function persistPersonnelMeta() {
  localStorage.setItem(PERSONNEL_META_KEY, JSON.stringify(personnelMeta));
}

function setPersonnelMeta(personnelId, meta) {
  if (!personnelId) return;
  personnelMeta[personnelId] = {
    enlistmentDate: toYmd(meta.enlistmentDate || ''),
    ordDate: toYmd(meta.ordDate || '')
  };
  persistPersonnelMeta();
}

function removePersonnelMeta(personnelId) {
  if (!personnelId || !personnelMeta[personnelId]) return;
  delete personnelMeta[personnelId];
  persistPersonnelMeta();
}

function bindTopbarActions() {
  document.getElementById('exportBtn').addEventListener('click', async () => {
    const snapshot = await apiRequest('GET', '/bootstrap');
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `off-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    e.target.value = '';
    alert('Import is disabled in backend mode. Use API/database migrations for data loading.');
  });
}

function bindTabs() {
  const nav = document.getElementById('tabNav');
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === btn));
    document.querySelectorAll('.panel').forEach((x) => x.classList.toggle('active', x.dataset.panel === tab));
  });
}

function renderAll() {
  ensureOnboardingPrompt();
  renderTopbarStatus();
  renderDashboard();
  renderPersonnel();
  renderGrants();
  renderUsage();
  renderCalendar();
  renderLogs();
}

function renderTopbarStatus() {
  const p = getSelectedPersonnel();
  document.getElementById('activePersonnelText').textContent = p
    ? `Active Personnel: ${p.name}`
    : 'No personnel yet. Add one to start tracking.';
}

function getSelectedPersonnel() {
  return state.personnel.find((p) => p.id === state.selectedPersonnelId) || null;
}

function grantsForSelected() {
  return state.grants.filter((g) => g.personnelId === state.selectedPersonnelId);
}

function usageForSelected() {
  return state.usages.filter((u) => u.personnelId === state.selectedPersonnelId);
}

function renderDashboard() {
  const container = document.querySelector('[data-panel="dashboard"]');
  const selectedPersonnel = getSelectedPersonnel();
  const grants = grantsForSelected();
  const usages = usageForSelected();

  const totalGranted = round1(grants.reduce((n, g) => n + g.durationValue, 0));
  const totalUsed = round1(usages.reduce((n, u) => n + u.durationUsed, 0));
  const totalRemain = round1(grants.reduce((n, g) => n + g.remainingValue, 0));

  container.innerHTML = `
    <h2>Dashboard</h2>
    ${selectedPersonnel ? '' : '<p class="small">No personnel found. Create your first personnel to start.</p>'}
    <div class="dashboard-personnel-row">
      <label class="field dashboard-personnel-field">Active Personnel
        <select id="dashPersonnelSelect" class="compact-select">
          ${state.personnel
            .map((p) => `<option value="${esc(p.id)}" ${p.id === state.selectedPersonnelId ? 'selected' : ''}>${esc(p.name)}</option>`)
            .join('')}
        </select>
      </label>
    </div>
    <div class="grid-cards">
      <article class="card"><h3>Total Offs Granted</h3><div class="big">${fmt(totalGranted)}</div></article>
      <article class="card"><h3>Total Offs Used</h3><div class="big">${fmt(totalUsed)}</div></article>
      <article class="card"><h3>Off Balance Remaining</h3><div class="big">${fmt(totalRemain)}</div></article>
    </div>
    <div style="margin-top:12px" class="row">
      <button class="success" id="quickAddGrant">Add Off</button>
      <button class="danger" id="quickUseOff">Use Off</button>
      <button id="quickRefresh" class="ghost">Refresh</button>
    </div>
  `;

  const dashPersonnelSelect = container.querySelector('#dashPersonnelSelect');
  if (dashPersonnelSelect) {
    dashPersonnelSelect.addEventListener('change', async () => {
      state.selectedPersonnelId = dashPersonnelSelect.value || null;
      renderAll();
      try {
        await refreshFromApi(state.selectedPersonnelId);
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }
  container.querySelector('#quickAddGrant').addEventListener('click', () => {
    if (!getSelectedPersonnel()) return openAddPersonnelModal(true);
    openAddGrantModal();
  });
  container.querySelector('#quickUseOff').addEventListener('click', () => {
    if (!getSelectedPersonnel()) return openAddPersonnelModal(true);
    openUseOffModal();
  });
  container.querySelector('#quickRefresh').addEventListener('click', async () => {
    try {
      await refreshFromApi(state.selectedPersonnelId);
    } catch (err) {
      alert(err.message || String(err));
    }
  });
}

function renderPersonnel() {
  const container = document.querySelector('[data-panel="personnel"]');

  container.innerHTML = `
    <div class="row space"><h2>Personnel</h2></div>
    <div class="personnel-controls">
      <label class="field personnel-select-field">Selected Personnel
        <select id="personnelSelect" class="compact-select"></select>
      </label>
      <button class="primary" id="addPersonnelBtn">Add Personnel</button>
      <button class="danger" id="deletePersonnelBtn">Delete Personnel</button>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Enlistment</th><th>ORD</th><th>Created</th><th>Records</th></tr></thead>
      <tbody id="personnelRows"></tbody>
    </table>
  `;

  const select = container.querySelector('#personnelSelect');
  state.personnel.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if (state.selectedPersonnelId) {
    select.value = state.selectedPersonnelId;
  }
  select.addEventListener('change', async () => {
    state.selectedPersonnelId = select.value;
    renderAll();
    try {
      await refreshFromApi(state.selectedPersonnelId);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  container.querySelector('#addPersonnelBtn').addEventListener('click', openAddPersonnelModal);
  container.querySelector('#deletePersonnelBtn').addEventListener('click', openDeletePersonnelModal);

  const rows = container.querySelector('#personnelRows');
  rows.innerHTML = state.personnel
    .map((p) => {
      const count = state.grants.filter((g) => g.personnelId === p.id).length + state.usages.filter((u) => u.personnelId === p.id).length;
      return `<tr><td>${esc(p.name)}</td><td>${esc(toYmd(p.enlistmentDate) || '-')}</td><td>${esc(toYmd(p.ordDate) || '-')}</td><td>${esc(formatDateTime(p.createdAt))}</td><td>${count}</td></tr>`;
    })
    .join('');
}

function renderGrants() {
  const container = document.querySelector('[data-panel="grants"]');
  const grants = grantsForSelected().slice().sort((a, b) => a.grantCode.localeCompare(b.grantCode));

  container.innerHTML = `
    <div class="row space"><h2>Off Grants</h2></div>
    <div class="row" style="margin-bottom:10px">
      <button class="primary" id="addGrantBtn">Add Off Grant</button>
      <button id="editGrantBtn" class="ghost">Edit Selected Grant</button>
      <button id="deleteGrantBtn" class="danger">Delete Selected Grant</button>
    </div>
    <table>
      <thead>
        <tr>
          <th></th><th>ID</th><th>Date</th><th>Duration</th><th>Reason</th><th>Provided By</th><th>Used</th><th>Remaining</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${grants
          .map(
            (g) => `<tr>
              <td><input type="radio" name="grantPick" value="${g.id}" /></td>
              <td>${esc(g.grantCode)}</td>
              <td>${esc(toYmd(g.grantedDate))}</td>
              <td>${fmt(g.durationValue)}</td>
              <td>
                ${esc(g.reasonType)}
                <div class="small">${esc(g.reasonDetails || '')}</div>
              </td>
              <td>${esc(g.providedBy || '-')}</td>
              <td>${fmt(g.usedValue)}</td>
              <td>${fmt(g.remainingValue)}</td>
              <td>${statusPill(g.status)}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;

  container.querySelector('#addGrantBtn').addEventListener('click', openAddGrantModal);
  container.querySelector('#editGrantBtn').addEventListener('click', () => {
    const selected = selectedRadio('grantPick');
    if (!selected) return alert('Select one grant row first.');
    openEditGrantModal(selected);
  });
  container.querySelector('#deleteGrantBtn').addEventListener('click', async () => {
    const selected = selectedRadio('grantPick');
    if (!selected) return alert('Select one grant row first.');
    const grant = state.grants.find((g) => g.id === selected);
    if (!grant) return;
    if (grant.usedValue > 0) return alert('Only completely unused grants can be deleted.');
    if (!confirm(`Delete ${grant.grantCode}? This cannot be undone.`)) return;
    try {
      await apiRequest('DELETE', '/grants', { ids: [selected] });
      await refreshFromApi(state.selectedPersonnelId);
    } catch (err) {
      alert(err.message || String(err));
    }
  });
}

function renderUsage() {
  const container = document.querySelector('[data-panel="usage"]');
  const usages = usageForSelected().slice().sort((a, b) => a.usageCode.localeCompare(b.usageCode));

  container.innerHTML = `
    <div class="row space"><h2>Off Usage</h2></div>
    <div class="row" style="margin-bottom:10px">
      <button class="primary" id="addUsageBtn">Record Off Usage</button>
      <button id="editUsageBtn" class="ghost">Edit Selected Usage</button>
      <button id="undoUsageBtn" class="danger">Undo Selected Usage</button>
    </div>
    <table>
      <thead><tr><th></th><th>Use ID</th><th>Date Intended</th><th>Session</th><th>Duration</th><th>Allocated Grants</th><th>Comments</th></tr></thead>
      <tbody>
      ${usages
        .map(
          (u) => `<tr>
            <td><input type="radio" name="usagePick" value="${u.id}" /></td>
            <td>${esc(u.usageCode)}</td>
            <td>${esc(toYmd(u.intendedDate))}</td>
            <td>${esc(u.session)}</td>
            <td>${fmt(u.durationUsed)}</td>
            <td>${esc(formatAllocations(u.allocations))}</td>
            <td>${esc(u.comments || '-')}</td>
          </tr>`
        )
        .join('')}
      </tbody>
    </table>
  `;

  container.querySelector('#addUsageBtn').addEventListener('click', openUseOffModal);
  container.querySelector('#editUsageBtn').addEventListener('click', () => {
    const selected = selectedRadio('usagePick');
    if (!selected) return alert('Select one usage row first.');
    openEditUsageModal(selected);
  });
  container.querySelector('#undoUsageBtn').addEventListener('click', () => {
    const selected = selectedRadio('usagePick');
    if (!selected) return alert('Select one usage row first.');
    undoUsage(selected);
  });
}

function renderCalendar() {
  const container = document.querySelector('[data-panel="calendar"]');
  const selectedPersonnel = getSelectedPersonnel();
  const months = monthOptionsForPersonnel(selectedPersonnel);
  if (!months.length) {
    container.innerHTML = `
      <div class="row space"><h2>Calendar</h2></div>
      <p class="small">No calendar months available. Set enlistment and ORD dates for this personnel.</p>
    `;
    return;
  }
  const currentSelection = container.dataset.month || '';
  const currentMonthValue = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const selectedMonth = months.some((m) => m.value === currentSelection)
    ? currentSelection
    : (months.some((m) => m.value === currentMonthValue) ? currentMonthValue : months[0].value);
  container.dataset.month = selectedMonth;

  const [yearStr, monthStr] = selectedMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  container.innerHTML = `
    <div class="row space">
      <h2>Calendar</h2>
      <label class="field">Month
        <select id="monthPick">
          ${months.map((m) => `<option value="${m.value}" ${m.value === selectedMonth ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="small" style="margin-bottom:8px">Legend: <span class="chip plus">+ granted</span> <span class="chip minus">- used</span> (click chips for details)</div>
    <div class="calendar-grid" id="calendarGrid"></div>
  `;

  container.querySelector('#monthPick').addEventListener('change', (e) => {
    container.dataset.month = e.target.value;
    renderCalendar();
  });

  const grid = container.querySelector('#calendarGrid');
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  dayNames.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-head';
    el.textContent = d;
    grid.appendChild(el);
  });

  const selectedGrants = grantsForSelected();
  const selectedUsages = usageForSelected();
  const usageBuckets = buildUsageCalendarBuckets(selectedGrants, selectedUsages);

  buildCalendarCells(year, month).forEach((day) => {
    const grants = selectedGrants.filter((g) => grantCalendarDate(g) === day.date);
    const usageBucket = usageBuckets[day.date] || { total: 0, items: [] };

    const grantTotal = round1(grants.reduce((n, g) => n + g.durationValue, 0));
    const useTotal = round1(usageBucket.total || 0);

    const cell = document.createElement('div');
    cell.className = `cal-cell ${day.inMonth ? '' : 'dim'}`;
    cell.innerHTML = `<div><strong>${day.day}</strong></div>`;
    if (grantTotal > 0) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip chip-btn plus';
      c.textContent = `+${fmt(grantTotal)}`;
      c.title = `View added off details for ${day.date}`;
      c.addEventListener('click', () => openCalendarDetailsModal(day.date, 'GRANTED', grants, usageBucket.items));
      cell.appendChild(c);
    }
    if (useTotal > 0) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip chip-btn minus';
      c.textContent = `-${fmt(useTotal)}`;
      c.title = `View used off details for ${day.date}`;
      c.addEventListener('click', () => openCalendarDetailsModal(day.date, 'USED', grants, usageBucket.items));
      cell.appendChild(c);
    }
    grid.appendChild(cell);
  });
}

function renderLogs() {
  const container = document.querySelector('[data-panel="logs"]');
  const logs = state.logs
    .filter((l) => !state.selectedPersonnelId || l.personnelId === state.selectedPersonnelId)
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (!logs.length) {
    container.innerHTML = `
      <h2>Edit Logs</h2>
      <p class="small">No logs yet for this personnel.</p>
    `;
    return;
  }

  container.innerHTML = `
    <h2>Edit Logs</h2>
    <div class="log-list">
      ${logs
        .map((l) => {
          const actionTone = logActionTone(l.action);
          const recordLabel = `${l.recordType || 'RECORD'} ${shortId(l.recordId || '-')}`;
          return `<article class="log-card">
            <div class="log-head">
              <div class="log-meta">
                <span class="pill ${actionTone}">${esc(l.action || 'UNKNOWN')}</span>
                <span class="small">${esc(recordLabel)}</span>
              </div>
              <div class="small">${esc(formatDateTime(l.timestamp))}</div>
            </div>
            <p class="log-summary">${esc(l.summary || '-')}</p>
            <div class="log-json-grid">
              <details class="log-json">
                <summary>Before</summary>
                <pre>${esc(formatJsonPretty(l.before))}</pre>
              </details>
              <details class="log-json">
                <summary>After</summary>
                <pre>${esc(formatJsonPretty(l.after))}</pre>
              </details>
            </div>
          </article>`;
        })
        .join('')}
    </div>
  `;
}

function openAddPersonnelModal(required = false) {
  onboardingPromptOpen = true;
  openModal('Add Personnel', `
    <div class="form-grid">
      <label class="field full">Name
        <input id="personnelName" placeholder="Enter personnel name" />
      </label>
      <label class="field">Enlistment Date
        <input id="enlistmentDate" type="date" />
      </label>
      <label class="field">ORD Date
        <input id="ordDate" type="date" />
      </label>
    </div>
  `, async () => {
    const name = val('#personnelName').trim();
    const enlistmentDate = val('#enlistmentDate');
    const ordDate = val('#ordDate');
    if (!name) throw new Error('Name is required.');
    if (!enlistmentDate || !ordDate) throw new Error('Enlistment date and ORD date are required.');
    if (toYmd(enlistmentDate) > toYmd(ordDate)) throw new Error('ORD date must be on or after enlistment date.');
    const created = await apiRequest('POST', '/personnel', { name });
    setPersonnelMeta(created.id, { enlistmentDate, ordDate });
    onboardingPromptOpen = false;
    await refreshFromApi(created.id);
  }, 'Add Personnel', 'primary', !required, () => {
    onboardingPromptOpen = false;
  });
}

function openDeletePersonnelModal() {
  if (state.personnel.length <= 1) return alert('At least one personnel must remain.');
  openModal('Delete Personnel', `
    <p>Select one or more personnel to delete.</p>
    <div class="personnel-delete-list">
      ${state.personnel
        .map((p) => {
          const isActive = p.id === state.selectedPersonnelId ? ' (active)' : '';
          return `<label class="personnel-delete-item">
            <input type="checkbox" name="personnelDeleteIds" value="${esc(p.id)}" />
            <span>${esc(p.name)}${esc(isActive)}</span>
          </label>`;
        })
        .join('')}
    </div>
    <label class="checkbox-row"><input id="deleteData" type="checkbox" /> <span>Also delete all grants/usages/logs for selected personnel</span></label>
  `, async () => {
    const selectedIds = checkedValues('personnelDeleteIds');
    if (!selectedIds.length) {
      throw new Error('Select at least one personnel to delete.');
    }
    const remainingCount = state.personnel.length - selectedIds.length;
    if (remainingCount < 1) {
      throw new Error('At least one personnel must remain.');
    }
    const deleteData = !!document.querySelector('#deleteData').checked;
    for (const id of selectedIds) {
      await apiRequest('DELETE', `/personnel/${id}?deleteData=${deleteData ? 'true' : 'false'}`);
      removePersonnelMeta(id);
    }
    await refreshFromApi();
  }, 'Delete Selected', 'danger');
}

function openAddGrantModal() {
  openModal('Add Off Grant', `
    <div class="form-grid">
      <label class="field">Date Granted
        <input id="grantedDate" type="date" value="${today()}" />
      </label>
      <label class="field">Duration
        <select id="durationType">
          <option value="FULL">Full Day (1)</option>
          <option value="HALF">Half Day (0.5)</option>
        </select>
      </label>
      <label class="field">Reason Type
        <select id="reasonType">
          <option value="OPS">Ops</option>
          <option value="OTHERS">Others</option>
        </select>
      </label>
      <div id="weekendOpsField">
        <label class="field">Weekend Ops Duty Date
          <input id="weekendOpsDate" type="date" />
        </label>
      </div>
      <label class="field full">Reason Details
        <textarea id="reasonDetails" rows="3"></textarea>
      </label>
      <label class="field full">Provided By
        <input id="providedBy" placeholder="Name" />
      </label>
    </div>
  `, async () => {
    const payload = {
      grantedDate: val('#grantedDate'),
      durationType: val('#durationType'),
      reasonType: val('#reasonType'),
      weekendOpsDate: val('#weekendOpsDate'),
      reasonDetails: val('#reasonDetails').trim(),
      providedBy: val('#providedBy').trim()
    };
    await addGrant(payload);
  });

  const reasonType = modalRoot.querySelector('#reasonType');
  const weekendOpsField = modalRoot.querySelector('#weekendOpsField');
  const weekendOpsDate = modalRoot.querySelector('#weekendOpsDate');
  const syncReasonFields = () => {
    const isOps = reasonType && reasonType.value === 'OPS';
    if (weekendOpsField) {
      weekendOpsField.style.display = isOps ? '' : 'none';
    }
    if (!isOps && weekendOpsDate) {
      weekendOpsDate.value = '';
    }
  };
  if (reasonType) {
    reasonType.addEventListener('change', syncReasonFields);
  }
  syncReasonFields();
}

function openEditGrantModal(grantId) {
  const grant = state.grants.find((g) => g.id === grantId);
  if (!grant) return;

  openModal('Edit Off Grant', `
    <div class="form-grid">
      <label class="field">Date Granted
        <input id="grantedDate" type="date" value="${esc(toYmd(grant.grantedDate))}" />
      </label>
      <label class="field">Duration
        <select id="durationType">
          <option value="FULL" ${grant.durationValue === 1 ? 'selected' : ''}>Full Day (1)</option>
          <option value="HALF" ${grant.durationValue === 0.5 ? 'selected' : ''}>Half Day (0.5)</option>
        </select>
      </label>
      <label class="field">Reason Type
        <select id="reasonType">
          <option value="OPS" ${grant.reasonType === 'OPS' ? 'selected' : ''}>Ops</option>
          <option value="OTHERS" ${grant.reasonType === 'OTHERS' ? 'selected' : ''}>Others</option>
        </select>
      </label>
      <div id="weekendOpsField">
        <label class="field">Weekend Ops Duty Date
          <input id="weekendOpsDate" type="date" value="${esc(toYmd(grant.weekendOpsDutyDate || ''))}" />
        </label>
      </div>
      <label class="field full">Reason Details
        <textarea id="reasonDetails" rows="3">${esc(grant.reasonDetails || '')}</textarea>
      </label>
      <label class="field full">Provided By
        <input id="providedBy" value="${esc(grant.providedBy || '')}" />
      </label>
    </div>
  `, async () => {
    const payload = {
      grantedDate: val('#grantedDate'),
      durationType: val('#durationType'),
      reasonType: val('#reasonType'),
      weekendOpsDate: val('#weekendOpsDate'),
      reasonDetails: val('#reasonDetails').trim(),
      providedBy: val('#providedBy').trim()
    };
    await editGrant(grantId, payload);
  }, 'Save');

  const reasonType = modalRoot.querySelector('#reasonType');
  const weekendOpsField = modalRoot.querySelector('#weekendOpsField');
  const weekendOpsDate = modalRoot.querySelector('#weekendOpsDate');
  const syncReasonFields = () => {
    const isOps = reasonType && reasonType.value === 'OPS';
    if (weekendOpsField) {
      weekendOpsField.style.display = isOps ? '' : 'none';
    }
    if (!isOps && weekendOpsDate) {
      weekendOpsDate.value = '';
    }
  };
  if (reasonType) {
    reasonType.addEventListener('change', syncReasonFields);
  }
  syncReasonFields();
}

function openUseOffModal() {
  const grants = grantsForSelected().filter((g) => g.remainingValue > 0);
  if (!grants.length) return alert('No available grant balances for this personnel.');

  openModal('Record Off Usage', `
    <div class="form-grid">
      <label class="field">Date Intended
        <input id="intendedDate" type="date" value="${today()}" />
      </label>
      <label class="field">Session
        <select id="session">
          <option value="FULL">Full Day (1)</option>
          <option value="AM">AM (0.5)</option>
          <option value="PM">PM (0.5)</option>
        </select>
      </label>
      <div class="full">
        <div class="small">Select one or more grant IDs in allocation order:</div>
        <div class="useoff-grant-list">
          ${grants
            .map((g) => {
              const reasonText = g.reasonType === 'OPS'
                ? `Weekend Ops (${toYmd(g.weekendOpsDutyDate) || '-'})`
                : (g.reasonDetails || 'Others');
              return `<label class="useoff-grant-item">
                <input type="checkbox" name="grantPickUse" value="${esc(g.id)}" />
                <div class="useoff-grant-text">
                  <div class="useoff-grant-main">
                    <strong>${esc(g.grantCode)}</strong>
                    <span class="small">remaining ${fmt(g.remainingValue)}</span>
                  </div>
                  <div class="small">${esc(reasonText)}</div>
                </div>
              </label>`;
            })
            .join('')}
        </div>
      </div>
      <label class="field full">Comments
        <textarea id="comments" rows="3"></textarea>
      </label>
    </div>
  `, async () => {
    const selectedGrantIds = checkedValues('grantPickUse');
    const payload = {
      intendedDate: val('#intendedDate'),
      session: val('#session'),
      selectedGrantIds,
      comments: val('#comments').trim()
    };
    await useOff(payload);
  }, 'Record');
}

function openEditUsageModal(usageId) {
  const usage = state.usages.find((u) => u.id === usageId);
  if (!usage) return;
  const available = grantsForSelected().filter((g) => g.remainingValue > 0 || usage.allocations.some((a) => a.grantId === g.id));
  const selectedSet = new Set(usage.allocations.map((a) => a.grantId));

  openModal('Edit Off Usage', `
    <div class="form-grid">
      <label class="field">Date Intended
        <input id="intendedDate" type="date" value="${esc(toYmd(usage.intendedDate))}" />
      </label>
      <label class="field">Session
        <select id="session">
          <option value="FULL" ${usage.session === 'FULL' ? 'selected' : ''}>Full Day (1)</option>
          <option value="AM" ${usage.session === 'AM' ? 'selected' : ''}>AM (0.5)</option>
          <option value="PM" ${usage.session === 'PM' ? 'selected' : ''}>PM (0.5)</option>
        </select>
      </label>
      <div class="full">
        <div class="small">Select grant IDs to reallocate this usage (existing + additional if needed):</div>
        ${available
          .map(
            (g) => `<label class="field"><input type="checkbox" name="grantPickEditUse" value="${g.id}" ${
              selectedSet.has(g.id) ? 'checked' : ''
            } /> ${esc(g.grantCode)} (remaining ${fmt(g.remainingValue)})</label>`
          )
          .join('')}
      </div>
      <label class="field full">Comments
        <textarea id="comments" rows="3">${esc(usage.comments || '')}</textarea>
      </label>
    </div>
  `, async () => {
    const payload = {
      intendedDate: val('#intendedDate'),
      session: val('#session'),
      selectedGrantIds: checkedValues('grantPickEditUse'),
      comments: val('#comments').trim()
    };
    await editUsage(usageId, payload);
  }, 'Save');
}

function addGrant(payload) {
  const personnel = getSelectedPersonnel();
  if (!personnel) throw new Error('No selected personnel.');
  return apiRequest('POST', '/grants', { ...payload, personnelId: personnel.id })
    .then(() => refreshFromApi(personnel.id));
}

function editGrant(grantId, payload) {
  return apiRequest('PATCH', `/grants/${grantId}`, payload)
    .then(() => refreshFromApi(state.selectedPersonnelId));
}

function useOff(payload) {
  const personnel = getSelectedPersonnel();
  if (!personnel) throw new Error('No selected personnel.');
  return apiRequest('POST', '/usages', { ...payload, personnelId: personnel.id })
    .then(() => refreshFromApi(personnel.id));
}

function editUsage(usageId, payload) {
  return apiRequest('PATCH', `/usages/${usageId}`, payload)
    .then(() => refreshFromApi(state.selectedPersonnelId));
}

function undoUsage(usageId) {
  const usage = state.usages.find((u) => u.id === usageId);
  if (!usage) return;
  if (!confirm(`Undo ${usage.usageCode}? This restores grant balances.`)) return;
  return apiRequest('DELETE', `/usages/${usageId}/undo`)
    .then(() => refreshFromApi(state.selectedPersonnelId))
    .catch((err) => alert(err.message || String(err)));
}

function openModal(
  title,
  bodyHtml,
  onSubmit,
  submitLabel = 'Save',
  submitClass = 'primary',
  allowCancel = true,
  onClose = null
) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${esc(title)}</h2>
        ${bodyHtml}
        <div class="error" id="modalError"></div>
        <div class="modal-actions">
          ${allowCancel ? '<button id="modalCancel" class="ghost" type="button">Cancel</button>' : ''}
          <button id="modalSubmit" class="${submitClass}" type="button">${esc(submitLabel)}</button>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    modalRoot.innerHTML = '';
    if (typeof onClose === 'function') onClose();
  };

  if (allowCancel) {
    modalRoot.querySelector('#modalCancel').addEventListener('click', close);
    modalRoot.querySelector('.modal-backdrop').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) close();
    });
  }

  modalRoot.querySelector('#modalSubmit').addEventListener('click', async () => {
    const errEl = modalRoot.querySelector('#modalError');
    errEl.textContent = '';
    try {
      await onSubmit();
      close();
    } catch (err) {
      errEl.textContent = err.message || String(err);
    }
  });
}

function openReadOnlyModal(title, bodyHtml) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${esc(title)}</h2>
        ${bodyHtml}
        <div class="modal-actions">
          <button id="modalCloseOnly" class="primary" type="button">Close</button>
        </div>
      </div>
    </div>
  `;
  const close = () => {
    modalRoot.innerHTML = '';
  };
  modalRoot.querySelector('#modalCloseOnly').addEventListener('click', close);
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });
}

function openCalendarDetailsModal(dateYmd, mode, grantsOnDate, usageOnDate) {
  const detailsTitle = `${mode === 'USED' ? 'Used Off' : 'Added Off'} Details - ${dateYmd}`;
  const isUsed = mode === 'USED';
  const items = isUsed ? usageOnDate : grantsOnDate;

  if (!items || items.length === 0) {
    openReadOnlyModal(detailsTitle, '<p class="small">No records for this date.</p>');
    return;
  }

  const content = isUsed
    ? `<table>
        <thead><tr><th>Use ID</th><th>Session</th><th>Amount on Date</th><th>Allocations</th><th>Source</th><th>Comments</th></tr></thead>
        <tbody>
          ${items
            .map(
              (entry) => {
                const u = entry.usage || entry;
                return `<tr>
                <td>${esc(u.usageCode || u.id)}</td>
                <td>${esc(u.session || '-')}</td>
                <td>${fmt(entry.amountOnDate != null ? entry.amountOnDate : (u.durationUsed || 0))}</td>
                <td>${esc(formatAllocations(u.allocations || []))}</td>
                <td>${esc(entry.source || '-')}</td>
                <td>${esc(u.comments || '-')}</td>
              </tr>`
              }
            )
            .join('')}
        </tbody>
      </table>`
    : `<table>
        <thead><tr><th>Grant ID</th><th>Duration</th><th>Reason</th><th>Provided By</th><th>Status</th></tr></thead>
        <tbody>
          ${items
            .map(
              (g) => `<tr>
                <td>${esc(g.grantCode || g.id)}</td>
                <td>${fmt(g.durationValue || 0)}</td>
                <td>${esc(g.reasonType || '-')}<div class="small">${esc(g.reasonDetails || '')}</div></td>
                <td>${esc(g.providedBy || '-')}</td>
                <td>${statusPill(g.status)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  openReadOnlyModal(detailsTitle, content);
}

function ensureOnboardingPrompt() {
  if (state.personnel.length > 0) return;
  state.selectedPersonnelId = null;
  if (onboardingPromptOpen) return;
  const personnelTabBtn = document.querySelector('.tab[data-tab="personnel"]');
  if (personnelTabBtn) personnelTabBtn.click();
  openAddPersonnelModal(true);
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    // noop
  }

  if (!res.ok || !payload || payload.ok === false) {
    const message = payload?.message || `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return payload.data;
}

async function refreshFromApi(preferredPersonnelId = null) {
  const qp = preferredPersonnelId
    ? `?selectedPersonnelId=${encodeURIComponent(preferredPersonnelId)}`
    : '';
  const data = await apiRequest('GET', `/bootstrap${qp}`);
  state.personnel = (data.personnel || []).map((p) => {
    const meta = personnelMeta[p.id] || {};
    const enlistmentDate = toYmd(p.enlistmentDate || meta.enlistmentDate || '');
    const ordDate = toYmd(p.ordDate || meta.ordDate || '');
    if (enlistmentDate || ordDate) {
      setPersonnelMeta(p.id, { enlistmentDate, ordDate });
    }
    return {
      ...p,
      enlistmentDate,
      ordDate
    };
  });
  state.selectedPersonnelId = data.selectedPersonnelId || (state.personnel[0] && state.personnel[0].id) || null;
  state.grants = data.grants || [];
  state.usages = data.usages || [];
  state.logs = data.logs || [];
  renderAll();
}

function statusPill(status) {
  const norm = String(status || '').toLowerCase();
  const label = norm === 'unused' ? 'Unused' : norm === 'partial' ? 'Partial' : 'Used';
  return `<span class="pill ${norm || 'used'}">${label}</span>`;
}

function computeStatus(used, remaining) {
  if (remaining <= 0 && used > 0) return 'USED';
  if (used <= 0) return 'UNUSED';
  return 'PARTIAL';
}

function formatAllocations(items) {
  return items.map((a) => `${a.grantCode} (${fmt(a.amount)})`).join(' + ');
}

function sessionDuration(session) {
  return session === 'FULL' ? 1 : 0.5;
}

function isWeekend(dateString) {
  const d = new Date(`${dateString}T00:00:00`);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function selectedRadio(name) {
  const x = document.querySelector(`input[name="${name}"]:checked`);
  return x ? x.value : '';
}

function checkedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((x) => x.value);
}

function val(selector) {
  const el = document.querySelector(selector);
  return el ? el.value : '';
}

function monthOptionsForPersonnel(personnel) {
  const enlistmentDate = personnel ? toYmd(personnel.enlistmentDate || '') : '';
  const ordDate = personnel ? toYmd(personnel.ordDate || '') : '';
  if (enlistmentDate && ordDate && enlistmentDate <= ordDate) {
    const start = parseYmd(enlistmentDate);
    const end = parseYmd(ordDate);
    if (start && end) return monthOptionsBetween(start, end);
  }
  const current = new Date();
  return monthOptions(current, 24);
}


function monthOptionsBetween(startDate, endDate) {
  const options = [];
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (d <= end) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const value = `${year}-${String(month).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    options.push({ value, label });
    d.setMonth(d.getMonth() + 1);
  }
  return options;
}

function grantCalendarDate(grant) {
  if (!grant) return '';
  if (String(grant.reasonType || '').toUpperCase() === 'OPS' && grant.weekendOpsDutyDate) {
    return toYmd(grant.weekendOpsDutyDate);
  }
  return toYmd(grant.grantedDate);
}

function buildUsageCalendarBuckets(grants, usages) {
  const buckets = {};

  (usages || []).forEach((usage) => {
    const date = toYmd(usage.intendedDate);
    if (!date) return;
    if (!buckets[date]) buckets[date] = { total: 0, items: [] };
    buckets[date].total = round1(buckets[date].total + (usage.durationUsed || 0));
    buckets[date].items.push({ usage, amountOnDate: usage.durationUsed || 0, source: 'Date Intended' });
  });

  return buckets;
}

function monthOptions(startDate, count) {
  const options = [];
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const value = `${year}-${String(month).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    options.push({ value, label });
    d.setMonth(d.getMonth() + 1);
  }
  return options;
}

function parseYmd(value) {
  const ymd = toYmd(value);
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildCalendarCells(year, month) {
  const first = new Date(year, month - 1, 1);
  const firstDay = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - firstDay);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const m = d.getMonth() + 1;
    cells.push({
      date: `${d.getFullYear()}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      day: d.getDate(),
      inMonth: m === month
    });
  }
  return cells;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nextCode(prefix, existingCodes, width) {
  let max = 0;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  existingCodes.forEach((c) => {
    const m = String(c).match(regex);
    if (!m) return;
    max = Math.max(max, Number(m[1]));
  });
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function fmt(n) {
  const x = round1(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isoNow() {
  return new Date().toISOString();
}

function today() {
  return toLocalYmd(new Date());
}

function todayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalYmd(d);
}

function toYmd(value) {
  if (!value) return '';
  const raw = String(value).trim();
  // Preserve date-only values exactly to avoid timezone day-shift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return toLocalYmd(d);
  }
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function toLocalYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleString();
}

function jsonShort(value) {
  if (value == null) return '-';
  const text = JSON.stringify(value);
  if (text.length <= 140) return text;
  return `${text.slice(0, 140)}...`;
}

function formatJsonPretty(value) {
  if (value == null) return '-';
  try {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    }
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function shortId(value) {
  const text = String(value || '');
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

function logActionTone(action) {
  const a = String(action || '').toUpperCase();
  if (a.includes('DELETE') || a.includes('UNDO')) return 'used';
  if (a.includes('EDIT') || a.includes('UPDATE')) return 'partial';
  return 'unused';
}
