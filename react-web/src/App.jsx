import React, { useEffect, useMemo, useState } from 'react';

const API_BASE =
  window.OFF_TRACKER_API_BASE ||
  import.meta.env.VITE_OFF_TRACKER_API_BASE ||
  '/api';

const PERSONNEL_META_KEY = 'offTracker.personnelMeta.v1';

function loadPersonnelMeta() {
  try {
    const raw = localStorage.getItem(PERSONNEL_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistPersonnelMeta(meta) {
  localStorage.setItem(PERSONNEL_META_KEY, JSON.stringify(meta));
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // noop
  }

  if (!res.ok || !payload || payload.ok === false) {
    throw new Error(payload?.message || `Request failed (${res.status}).`);
  }

  return payload.data;
}

function toLocalYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toYmd(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return toLocalYmd(d);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function today() {
  return toLocalYmd(new Date());
}

function parseYmd(value) {
  const ymd = toYmd(value);
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
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

function monthOptionsForPersonnel(personnel) {
  const enlistmentDate = personnel ? toYmd(personnel.enlistmentDate || '') : '';
  const ordDate = personnel ? toYmd(personnel.ordDate || '') : '';
  if (enlistmentDate && ordDate && enlistmentDate <= ordDate) {
    const start = parseYmd(enlistmentDate);
    const end = parseYmd(ordDate);
    if (start && end) return monthOptionsBetween(start, end);
  }
  return monthOptions(new Date(), 24);
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

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function fmt(n) {
  const x = round1(n);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleString();
}

function statusPill(status) {
  const norm = String(status || '').toLowerCase();
  const label = norm === 'unused' ? 'Unused' : norm === 'partial' ? 'Partial' : 'Used';
  return <span className={`pill ${norm || 'used'}`}>{label}</span>;
}

function formatAllocations(items) {
  return (items || []).map((a) => `${a.grantCode} (${fmt(a.amount)})`).join(' + ');
}

function grantCalendarDate(grant) {
  if (!grant) return '';
  if (String(grant.reasonType || '').toUpperCase() === 'OPS' && grant.weekendOpsDutyDate) {
    return toYmd(grant.weekendOpsDutyDate);
  }
  return toYmd(grant.grantedDate);
}

function buildUsageCalendarBuckets(usages) {
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

function App() {
  const [personnelMeta, setPersonnelMeta] = useState(() => loadPersonnelMeta());
  const [state, setState] = useState({
    personnel: [],
    selectedPersonnelId: null,
    grants: [],
    usages: [],
    logs: []
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [calendarMonth, setCalendarMonth] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);

  const selectedPersonnel = useMemo(
    () => state.personnel.find((p) => p.id === state.selectedPersonnelId) || null,
    [state.personnel, state.selectedPersonnelId]
  );

  const selectedGrants = useMemo(
    () => state.grants.filter((g) => g.personnelId === state.selectedPersonnelId),
    [state.grants, state.selectedPersonnelId]
  );

  const selectedUsages = useMemo(
    () => state.usages.filter((u) => u.personnelId === state.selectedPersonnelId),
    [state.usages, state.selectedPersonnelId]
  );

  const months = useMemo(() => monthOptionsForPersonnel(selectedPersonnel), [selectedPersonnel]);

  useEffect(() => {
    refreshFromApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || loadError) return;
    if (state.personnel.length > 0) return;
    setActiveTab('personnel');
    if (!modal || modal.type !== 'addPersonnelRequired') {
      setModal({ type: 'addPersonnelRequired' });
    }
  }, [state.personnel.length, modal, loading, loadError]);

  useEffect(() => {
    if (!months.length) {
      setCalendarMonth('');
      return;
    }
    setCalendarMonth((prev) => {
      if (months.some((m) => m.value === prev)) return prev;
      const currentMonthValue = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      if (months.some((m) => m.value === currentMonthValue)) return currentMonthValue;
      return months[0].value;
    });
  }, [months]);

  async function refreshFromApi(preferredPersonnelId = null) {
    try {
      setLoading(true);
      setLoadError('');
      const qp = preferredPersonnelId
        ? `?selectedPersonnelId=${encodeURIComponent(preferredPersonnelId)}`
        : '';
      const data = await apiRequest('GET', `/bootstrap${qp}`);

      const mergedPersonnel = (data.personnel || []).map((p) => {
        const meta = personnelMeta[p.id] || {};
        const enlistmentDate = toYmd(p.enlistmentDate || meta.enlistmentDate || '');
        const ordDate = toYmd(p.ordDate || meta.ordDate || '');
        return { ...p, enlistmentDate, ordDate };
      });

      setState({
        personnel: mergedPersonnel,
        selectedPersonnelId:
          data.selectedPersonnelId || (mergedPersonnel[0] && mergedPersonnel[0].id) || null,
        grants: data.grants || [],
        usages: data.usages || [],
        logs: data.logs || []
      });
    } catch (err) {
      setLoadError(`Failed to load data from backend (${API_BASE}): ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function savePersonnelMeta(nextMeta) {
    setPersonnelMeta(nextMeta);
    persistPersonnelMeta(nextMeta);
  }

  function openModal(type, payload = {}) {
    setModal({ type, payload });
  }

  function closeModal() {
    if (modal?.type === 'addPersonnelRequired') return;
    setModal(null);
  }

  async function addPersonnel(values) {
    const name = values.name.trim();
    const enlistmentDate = toYmd(values.enlistmentDate);
    const ordDate = toYmd(values.ordDate);

    if (!name) throw new Error('Name is required.');
    if (!enlistmentDate || !ordDate) throw new Error('Enlistment date and ORD date are required.');
    if (enlistmentDate > ordDate) throw new Error('ORD date must be on or after enlistment date.');

    const created = await apiRequest('POST', '/personnel', { name });
    savePersonnelMeta({
      ...personnelMeta,
      [created.id]: { enlistmentDate, ordDate }
    });
    setModal(null);
    await refreshFromApi(created.id);
  }

  async function deletePersonnelBatch(values) {
    const selectedIds = values.selectedIds || [];
    const deleteData = !!values.deleteData;

    if (!selectedIds.length) throw new Error('Select at least one personnel to delete.');
    if (state.personnel.length - selectedIds.length < 1) {
      throw new Error('At least one personnel must remain.');
    }

    for (const id of selectedIds) {
      await apiRequest('DELETE', `/personnel/${id}?deleteData=${deleteData ? 'true' : 'false'}`);
    }

    const nextMeta = { ...personnelMeta };
    selectedIds.forEach((id) => delete nextMeta[id]);
    savePersonnelMeta(nextMeta);

    setModal(null);
    await refreshFromApi();
  }

  async function addGrant(payload) {
    if (!selectedPersonnel) throw new Error('No selected personnel.');
    await apiRequest('POST', '/grants', { ...payload, personnelId: selectedPersonnel.id });
    setModal(null);
    await refreshFromApi(selectedPersonnel.id);
  }

  async function editGrant(grantId, payload) {
    await apiRequest('PATCH', `/grants/${grantId}`, payload);
    setModal(null);
    await refreshFromApi(state.selectedPersonnelId);
  }

  async function deleteGrant(grantId) {
    const grant = state.grants.find((g) => g.id === grantId);
    if (!grant) return;
    if (grant.usedValue > 0) return alert('Only completely unused grants can be deleted.');
    if (!confirm(`Delete ${grant.grantCode}? This cannot be undone.`)) return;
    await apiRequest('DELETE', '/grants', { ids: [grantId] });
    await refreshFromApi(state.selectedPersonnelId);
  }

  async function addUsage(payload) {
    if (!selectedPersonnel) throw new Error('No selected personnel.');
    await apiRequest('POST', '/usages', { ...payload, personnelId: selectedPersonnel.id });
    setModal(null);
    await refreshFromApi(selectedPersonnel.id);
  }

  async function editUsage(usageId, payload) {
    await apiRequest('PATCH', `/usages/${usageId}`, payload);
    setModal(null);
    await refreshFromApi(state.selectedPersonnelId);
  }

  async function undoUsage(usageId) {
    const usage = state.usages.find((u) => u.id === usageId);
    if (!usage) return;
    if (!confirm(`Undo ${usage.usageCode}? This restores grant balances.`)) return;
    await apiRequest('DELETE', `/usages/${usageId}/undo`);
    await refreshFromApi(state.selectedPersonnelId);
  }

  function exportJson() {
    apiRequest('GET', '/bootstrap').then((snapshot) => {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `off-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }).catch((err) => alert(err.message || String(err)));
  }

  const usageBuckets = useMemo(() => buildUsageCalendarBuckets(selectedUsages), [selectedUsages]);
  const calendarCells = useMemo(() => {
    if (!calendarMonth) return [];
    const [y, m] = calendarMonth.split('-').map(Number);
    return buildCalendarCells(y, m).map((day) => {
      const grants = selectedGrants.filter((g) => grantCalendarDate(g) === day.date);
      const usageBucket = usageBuckets[day.date] || { total: 0, items: [] };
      return {
        ...day,
        grants,
        usageBucket,
        grantTotal: round1(grants.reduce((n, g) => n + g.durationValue, 0)),
        useTotal: round1(usageBucket.total || 0)
      };
    });
  }, [calendarMonth, selectedGrants, usageBuckets]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Off Tracker</h1>
          <p id="activePersonnelText" className="muted">
            {selectedPersonnel ? `Active Personnel: ${selectedPersonnel.name}` : 'No personnel yet. Add one to start tracking.'}
          </p>
        </div>
        <div className="topbar-actions">
          <button id="exportBtn" className="ghost" onClick={exportJson}>Export JSON</button>
          <label htmlFor="importInput" className="ghost import-label">Import JSON</label>
          <input id="importInput" type="file" accept="application/json" onChange={(e) => {
            e.target.value = '';
            alert('Import is disabled in backend mode. Use API/database migrations for data loading.');
          }} />
        </div>
      </header>

      <nav className="tabs" id="tabNav">
        {['dashboard', 'grants', 'usage', 'calendar', 'personnel', 'logs'].map((tab) => (
          <button
            key={tab}
            data-tab={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'grants' ? 'Off Grants' : tab === 'usage' ? 'Off Usage' : tab === 'logs' ? 'Edit Logs' : tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main>
        {loadError && (
          <div className="error" style={{ marginBottom: 10 }}>
            {loadError}
          </div>
        )}
        <section className={`panel ${activeTab === 'dashboard' ? 'active' : ''}`}>
          <h2>Dashboard</h2>
          {!selectedPersonnel && <p className="small">No personnel found. Create your first personnel to start.</p>}
          <div className="dashboard-personnel-row">
            <label className="field dashboard-personnel-field">Active Personnel
              <select
                id="dashPersonnelSelect"
                className="compact-select"
                value={state.selectedPersonnelId || ''}
                onChange={(e) => refreshFromApi(e.target.value || null)}
              >
                {state.personnel.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid-cards">
            <article className="card"><h3>Total Offs Granted</h3><div className="big">{fmt(selectedGrants.reduce((n, g) => n + g.durationValue, 0))}</div></article>
            <article className="card"><h3>Total Offs Used</h3><div className="big">{fmt(selectedUsages.reduce((n, u) => n + u.durationUsed, 0))}</div></article>
            <article className="card"><h3>Off Balance Remaining</h3><div className="big">{fmt(selectedGrants.reduce((n, g) => n + g.remainingValue, 0))}</div></article>
          </div>

          <div style={{ marginTop: 12 }} className="row">
            <button className="success" onClick={() => {
              if (!selectedPersonnel) return openModal('addPersonnelRequired');
              openModal('addGrant');
            }}>Add Off</button>
            <button className="danger" onClick={() => {
              if (!selectedPersonnel) return openModal('addPersonnelRequired');
              openModal('addUsage');
            }}>Use Off</button>
            <button className="ghost" onClick={() => refreshFromApi(state.selectedPersonnelId)}>Refresh</button>
          </div>
        </section>

        <section className={`panel ${activeTab === 'personnel' ? 'active' : ''}`}>
          <div className="row space"><h2>Personnel</h2></div>
          <div className="personnel-controls">
            <label className="field personnel-select-field">Selected Personnel
              <select
                id="personnelSelect"
                className="compact-select"
                value={state.selectedPersonnelId || ''}
                onChange={(e) => refreshFromApi(e.target.value || null)}
              >
                {state.personnel.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </label>
            <button className="primary" id="addPersonnelBtn" onClick={() => openModal('addPersonnel')}>Add Personnel</button>
            <button className="danger" id="deletePersonnelBtn" onClick={() => {
              if (state.personnel.length <= 1) return alert('At least one personnel must remain.');
              openModal('deletePersonnel');
            }}>Delete Personnel</button>
          </div>
          <table>
            <thead><tr><th>Name</th><th>Enlistment</th><th>ORD</th><th>Created</th><th>Records</th></tr></thead>
            <tbody>
              {state.personnel.map((p) => {
                const count = state.grants.filter((g) => g.personnelId === p.id).length + state.usages.filter((u) => u.personnelId === p.id).length;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{toYmd(p.enlistmentDate) || '-'}</td>
                    <td>{toYmd(p.ordDate) || '-'}</td>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td>{count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className={`panel ${activeTab === 'grants' ? 'active' : ''}`}>
          <div className="row space"><h2>Off Grants</h2></div>
          <GrantsPanel grants={selectedGrants} onAdd={() => openModal('addGrant')} onEdit={(id) => openModal('editGrant', { id })} onDelete={deleteGrant} />
        </section>

        <section className={`panel ${activeTab === 'usage' ? 'active' : ''}`}>
          <div className="row space"><h2>Off Usage</h2></div>
          <UsagePanel usages={selectedUsages} onAdd={() => openModal('addUsage')} onEdit={(id) => openModal('editUsage', { id })} onUndo={undoUsage} />
        </section>

        <section className={`panel ${activeTab === 'calendar' ? 'active' : ''}`}>
          <div className="row space">
            <h2>Calendar</h2>
            <label className="field">Month
              <select value={calendarMonth} onChange={(e) => setCalendarMonth(e.target.value)}>
                {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div className="small" style={{ marginBottom: 8 }}>Legend: <span className="chip plus">+ granted</span> <span className="chip minus">- used</span> (click chips for details)</div>
          <div className="calendar-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-head">{d}</div>)}
            {calendarCells.map((day) => (
              <div key={day.date} className={`cal-cell ${day.inMonth ? '' : 'dim'}`}>
                <div><strong>{day.day}</strong></div>
                {day.grantTotal > 0 && (
                  <button className="chip chip-btn plus" onClick={() => openModal('calendarDetails', { date: day.date, mode: 'GRANTED', grants: day.grants, usages: day.usageBucket.items })}>+{fmt(day.grantTotal)}</button>
                )}
                {day.useTotal > 0 && (
                  <button className="chip chip-btn minus" onClick={() => openModal('calendarDetails', { date: day.date, mode: 'USED', grants: day.grants, usages: day.usageBucket.items })}>-{fmt(day.useTotal)}</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className={`panel ${activeTab === 'logs' ? 'active' : ''}`}>
          <h2>Edit Logs</h2>
          <LogsPanel logs={state.logs.filter((l) => !state.selectedPersonnelId || l.personnelId === state.selectedPersonnelId)} />
        </section>
      </main>

      {loading && <div className="small" style={{ marginTop: 8 }}>Loading...</div>}

      <ModalHost
        modal={modal}
        closeModal={closeModal}
        selectedPersonnel={selectedPersonnel}
        state={state}
        selectedGrants={selectedGrants}
        selectedUsages={selectedUsages}
        addPersonnel={addPersonnel}
        deletePersonnelBatch={deletePersonnelBatch}
        addGrant={addGrant}
        editGrant={editGrant}
        addUsage={addUsage}
        editUsage={editUsage}
      />
    </div>
  );
}

function GrantsPanel({ grants, onAdd, onEdit, onDelete }) {
  const [selected, setSelected] = useState('');
  useEffect(() => setSelected(''), [grants]);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="primary" onClick={onAdd}>Add Off Grant</button>
        <button className="ghost" onClick={() => {
          if (!selected) return alert('Select one grant row first.');
          onEdit(selected);
        }}>Edit Selected Grant</button>
        <button className="danger" onClick={() => {
          if (!selected) return alert('Select one grant row first.');
          onDelete(selected);
        }}>Delete Selected Grant</button>
      </div>
      <table>
        <thead><tr><th></th><th>ID</th><th>Date</th><th>Duration</th><th>Reason</th><th>Provided By</th><th>Used</th><th>Remaining</th><th>Status</th></tr></thead>
        <tbody>
          {grants.sort((a, b) => a.grantCode.localeCompare(b.grantCode)).map((g) => (
            <tr key={g.id}>
              <td><input type="radio" checked={selected === g.id} onChange={() => setSelected(g.id)} /></td>
              <td>{g.grantCode}</td>
              <td>{toYmd(g.grantedDate)}</td>
              <td>{fmt(g.durationValue)}</td>
              <td>{g.reasonType}<div className="small">{g.reasonDetails || ''}</div></td>
              <td>{g.providedBy || '-'}</td>
              <td>{fmt(g.usedValue)}</td>
              <td>{fmt(g.remainingValue)}</td>
              <td>{statusPill(g.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function UsagePanel({ usages, onAdd, onEdit, onUndo }) {
  const [selected, setSelected] = useState('');
  useEffect(() => setSelected(''), [usages]);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="primary" onClick={onAdd}>Record Off Usage</button>
        <button className="ghost" onClick={() => {
          if (!selected) return alert('Select one usage row first.');
          onEdit(selected);
        }}>Edit Selected Usage</button>
        <button className="danger" onClick={() => {
          if (!selected) return alert('Select one usage row first.');
          onUndo(selected);
        }}>Undo Selected Usage</button>
      </div>
      <table>
        <thead><tr><th></th><th>Use ID</th><th>Date Intended</th><th>Session</th><th>Duration</th><th>Allocated Grants</th><th>Comments</th></tr></thead>
        <tbody>
          {usages.sort((a, b) => a.usageCode.localeCompare(b.usageCode)).map((u) => (
            <tr key={u.id}>
              <td><input type="radio" checked={selected === u.id} onChange={() => setSelected(u.id)} /></td>
              <td>{u.usageCode}</td>
              <td>{toYmd(u.intendedDate)}</td>
              <td>{u.session}</td>
              <td>{fmt(u.durationUsed)}</td>
              <td>{formatAllocations(u.allocations)}</td>
              <td>{u.comments || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function LogsPanel({ logs }) {
  const sorted = [...logs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (!sorted.length) return <p className="small">No logs yet for this personnel.</p>;

  return (
    <div className="log-list">
      {sorted.map((l) => (
        <article key={l.id || `${l.timestamp}-${l.recordId}`} className="log-card">
          <div className="log-head">
            <div className="log-meta">
              <span className={`pill ${logActionTone(l.action)}`}>{l.action || 'UNKNOWN'}</span>
              <span className="small">{`${l.recordType || 'RECORD'} ${shortId(l.recordId || '-')}`}</span>
            </div>
            <div className="small">{formatDateTime(l.timestamp)}</div>
          </div>
          <p className="log-summary">{l.summary || '-'}</p>
          <div className="log-json-grid">
            <details className="log-json"><summary>Before</summary><pre>{formatJsonPretty(l.before)}</pre></details>
            <details className="log-json"><summary>After</summary><pre>{formatJsonPretty(l.after)}</pre></details>
          </div>
        </article>
      ))}
    </div>
  );
}

function ModalHost(props) {
  const {
    modal,
    closeModal,
    selectedPersonnel,
    state,
    selectedGrants,
    selectedUsages,
    addPersonnel,
    deletePersonnelBatch,
    addGrant,
    editGrant,
    addUsage,
    editUsage
  } = props;

  if (!modal) return null;

  const isRequired = modal.type === 'addPersonnelRequired';

  return (
    <div className="modal-backdrop" onClick={(e) => {
      if (!isRequired && e.target.classList.contains('modal-backdrop')) closeModal();
    }}>
      <div className="modal">
        {modal.type === 'addPersonnel' || modal.type === 'addPersonnelRequired' ? (
          <AddPersonnelModal onSubmit={addPersonnel} onCancel={closeModal} required={isRequired} />
        ) : null}

        {modal.type === 'deletePersonnel' ? (
          <DeletePersonnelModal personnel={state.personnel} selectedPersonnelId={state.selectedPersonnelId} onSubmit={deletePersonnelBatch} onCancel={closeModal} />
        ) : null}

        {modal.type === 'addGrant' ? (
          <GrantModal title="Add Off Grant" onSubmit={addGrant} onCancel={closeModal} />
        ) : null}

        {modal.type === 'editGrant' ? (
          <GrantModal title="Edit Off Grant" grant={state.grants.find((g) => g.id === modal.payload.id)} onSubmit={(p) => editGrant(modal.payload.id, p)} onCancel={closeModal} />
        ) : null}

        {modal.type === 'addUsage' ? (
          <UsageModal title="Record Off Usage" grants={selectedGrants.filter((g) => g.remainingValue > 0)} onSubmit={addUsage} onCancel={closeModal} />
        ) : null}

        {modal.type === 'editUsage' ? (
          <UsageModal
            title="Edit Off Usage"
            usage={selectedUsages.find((u) => u.id === modal.payload.id)}
            grants={selectedGrants}
            onSubmit={(p) => editUsage(modal.payload.id, p)}
            onCancel={closeModal}
          />
        ) : null}

        {modal.type === 'calendarDetails' ? (
          <CalendarDetailsModal {...modal.payload} onClose={closeModal} />
        ) : null}
      </div>
    </div>
  );
}

function AddPersonnelModal({ onSubmit, onCancel, required }) {
  const [name, setName] = useState('');
  const [enlistmentDate, setEnlistmentDate] = useState('');
  const [ordDate, setOrdDate] = useState('');
  const [error, setError] = useState('');

  return (
    <>
      <h2>Add Personnel</h2>
      <div className="form-grid">
        <label className="field full">Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Enlistment Date<input type="date" value={enlistmentDate} onChange={(e) => setEnlistmentDate(e.target.value)} /></label>
        <label className="field">ORD Date<input type="date" value={ordDate} onChange={(e) => setOrdDate(e.target.value)} /></label>
      </div>
      <div className="error">{error}</div>
      <div className="modal-actions">
        {!required && <button className="ghost" onClick={onCancel}>Cancel</button>}
        <button className="primary" onClick={async () => {
          try {
            setError('');
            await onSubmit({ name, enlistmentDate, ordDate });
          } catch (err) {
            setError(err.message || String(err));
          }
        }}>Add Personnel</button>
      </div>
    </>
  );
}

function DeletePersonnelModal({ personnel, selectedPersonnelId, onSubmit, onCancel }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteData, setDeleteData] = useState(false);
  const [error, setError] = useState('');

  return (
    <>
      <h2>Delete Personnel</h2>
      <p>Select one or more personnel to delete.</p>
      <div className="personnel-delete-list">
        {personnel.map((p) => (
          <label key={p.id} className="personnel-delete-item">
            <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={(e) => {
              setSelectedIds((prev) => e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id));
            }} />
            <span>{p.name}{p.id === selectedPersonnelId ? ' (active)' : ''}</span>
          </label>
        ))}
      </div>
      <label className="checkbox-row"><input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} /><span>Also delete all grants/usages/logs for selected personnel</span></label>
      <div className="error">{error}</div>
      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="danger" onClick={async () => {
          try {
            setError('');
            await onSubmit({ selectedIds, deleteData });
          } catch (err) {
            setError(err.message || String(err));
          }
        }}>Delete Selected</button>
      </div>
    </>
  );
}

function GrantModal({ title, grant, onSubmit, onCancel }) {
  const [grantedDate, setGrantedDate] = useState(toYmd(grant?.grantedDate) || today());
  const [durationType, setDurationType] = useState(grant?.durationValue === 0.5 ? 'HALF' : 'FULL');
  const [reasonType, setReasonType] = useState(grant?.reasonType || 'OPS');
  const [weekendOpsDate, setWeekendOpsDate] = useState(toYmd(grant?.weekendOpsDutyDate || ''));
  const [reasonDetails, setReasonDetails] = useState(grant?.reasonDetails || '');
  const [providedBy, setProvidedBy] = useState(grant?.providedBy || '');
  const [error, setError] = useState('');

  return (
    <>
      <h2>{title}</h2>
      <div className="form-grid">
        <label className="field">Date Granted<input type="date" value={grantedDate} onChange={(e) => setGrantedDate(e.target.value)} /></label>
        <label className="field">Duration
          <select value={durationType} onChange={(e) => setDurationType(e.target.value)}>
            <option value="FULL">Full Day (1)</option>
            <option value="HALF">Half Day (0.5)</option>
          </select>
        </label>
        <label className="field">Reason Type
          <select value={reasonType} onChange={(e) => setReasonType(e.target.value)}>
            <option value="OPS">Ops</option>
            <option value="OTHERS">Others</option>
          </select>
        </label>
        {reasonType === 'OPS' && <label className="field">Weekend Ops Duty Date<input type="date" value={weekendOpsDate} onChange={(e) => setWeekendOpsDate(e.target.value)} /></label>}
        <label className="field full">Reason Details<textarea rows={3} value={reasonDetails} onChange={(e) => setReasonDetails(e.target.value)} /></label>
        <label className="field full">Provided By<input value={providedBy} onChange={(e) => setProvidedBy(e.target.value)} /></label>
      </div>
      <div className="error">{error}</div>
      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={async () => {
          try {
            setError('');
            await onSubmit({
              grantedDate,
              durationType,
              reasonType,
              weekendOpsDate: reasonType === 'OPS' ? weekendOpsDate : '',
              reasonDetails,
              providedBy
            });
          } catch (err) {
            setError(err.message || String(err));
          }
        }}>{grant ? 'Save' : 'Add'}</button>
      </div>
    </>
  );
}

function UsageModal({ title, usage, grants, onSubmit, onCancel }) {
  const usableGrants = (grants || []).filter((g) => g.remainingValue > 0 || (usage?.allocations || []).some((a) => a.grantId === g.id));
  const [intendedDate, setIntendedDate] = useState(toYmd(usage?.intendedDate) || today());
  const [session, setSession] = useState(usage?.session || 'FULL');
  const [comments, setComments] = useState(usage?.comments || '');
  const [selectedGrantIds, setSelectedGrantIds] = useState((usage?.allocations || []).map((a) => a.grantId));
  const [error, setError] = useState('');

  return (
    <>
      <h2>{title}</h2>
      <div className="form-grid">
        <label className="field">Date Intended<input type="date" value={intendedDate} onChange={(e) => setIntendedDate(e.target.value)} /></label>
        <label className="field">Session
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="FULL">Full Day (1)</option>
            <option value="AM">AM (0.5)</option>
            <option value="PM">PM (0.5)</option>
          </select>
        </label>
        <div className="full">
          <div className="small">Select one or more grant IDs in allocation order:</div>
          <div className="useoff-grant-list">
            {usableGrants.map((g) => {
              const reasonText = g.reasonType === 'OPS'
                ? `Weekend Ops (${toYmd(g.weekendOpsDutyDate) || '-'})`
                : (g.reasonDetails || 'Others');
              return (
                <label key={g.id} className="useoff-grant-item">
                  <input type="checkbox" checked={selectedGrantIds.includes(g.id)} onChange={(e) => {
                    setSelectedGrantIds((prev) => e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id));
                  }} />
                  <div className="useoff-grant-text">
                    <div className="useoff-grant-main"><strong>{g.grantCode}</strong><span className="small">remaining {fmt(g.remainingValue)}</span></div>
                    <div className="small">{reasonText}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        <label className="field full">Comments<textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} /></label>
      </div>
      <div className="error">{error}</div>
      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={async () => {
          try {
            setError('');
            await onSubmit({ intendedDate, session, selectedGrantIds, comments });
          } catch (err) {
            setError(err.message || String(err));
          }
        }}>{usage ? 'Save' : 'Record'}</button>
      </div>
    </>
  );
}

function CalendarDetailsModal({ date, mode, grants, usages, onClose }) {
  const isUsed = mode === 'USED';
  return (
    <>
      <h2>{isUsed ? 'Used Off' : 'Added Off'} Details - {date}</h2>
      {isUsed ? (
        <table>
          <thead><tr><th>Use ID</th><th>Session</th><th>Amount on Date</th><th>Allocations</th><th>Source</th><th>Comments</th></tr></thead>
          <tbody>
            {(usages || []).map((entry) => {
              const u = entry.usage || entry;
              return (
                <tr key={`${u.id}-${entry.amountOnDate || 0}`}>
                  <td>{u.usageCode || u.id}</td>
                  <td>{u.session || '-'}</td>
                  <td>{fmt(entry.amountOnDate != null ? entry.amountOnDate : (u.durationUsed || 0))}</td>
                  <td>{formatAllocations(u.allocations || [])}</td>
                  <td>{entry.source || '-'}</td>
                  <td>{u.comments || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table>
          <thead><tr><th>Grant ID</th><th>Duration</th><th>Reason</th><th>Provided By</th><th>Status</th></tr></thead>
          <tbody>
            {(grants || []).map((g) => (
              <tr key={g.id}>
                <td>{g.grantCode || g.id}</td>
                <td>{fmt(g.durationValue || 0)}</td>
                <td>{g.reasonType || '-'}<div className="small">{g.reasonDetails || ''}</div></td>
                <td>{g.providedBy || '-'}</td>
                <td>{statusPill(g.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </>
  );
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

function formatJsonPretty(value) {
  if (value == null) return '-';
  try {
    if (typeof value === 'string') return JSON.stringify(JSON.parse(value), null, 2);
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default App;
