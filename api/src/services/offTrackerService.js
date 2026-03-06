import { pool, withTransaction } from '../db.js';
import { ApiError } from '../utils/response.js';
import {
  assert,
  isWeekend,
  parseYmd,
  round1,
  toDurationBySession,
  toDurationByType
} from '../utils/validate.js';

function computeStatus(used, remaining) {
  if (used <= 0) return 'UNUSED';
  if (remaining <= 0) return 'USED';
  return 'PARTIAL';
}

function normalizeReason(payload) {
  const reasonType = String(payload.reasonType || '').toUpperCase();
  let weekendOpsDate = payload.weekendOpsDate ? parseYmd(payload.weekendOpsDate, 'weekendOpsDate') : null;
  let reasonDetails = String(payload.reasonDetails || '').trim();
  let providedBy = String(payload.providedBy || '').trim();

  if (reasonType === 'OPS') {
    assert(!!weekendOpsDate, 'Weekend Ops duty date is required for OPS.');
    assert(isWeekend(weekendOpsDate), 'Weekend Ops duty date must be Saturday or Sunday.');
    reasonDetails = `Weekend Ops on ${weekendOpsDate}`;
    if (!providedBy) providedBy = 'Yourself';
  } else if (reasonType === 'OTHERS') {
    assert(!!reasonDetails, 'Reason details are required for OTHERS.');
    assert(!!providedBy, 'Provided by is required for OTHERS.');
    weekendOpsDate = null;
  } else {
    throw new ApiError(400, 'reasonType must be OPS or OTHERS.');
  }

  return { reasonType, weekendOpsDate, reasonDetails, providedBy };
}

async function appendAuditEvent(client, payload, user) {
  await client.query(
    `INSERT INTO audit_events (
      event_type, personnel_id, record_type, record_id, summary,
      before_json, after_json, request_id, actor_id, actor_email
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [
      payload.eventType,
      payload.personnelId || null,
      payload.recordType,
      payload.recordId,
      payload.summary,
      JSON.stringify(payload.before ?? null),
      JSON.stringify(payload.after ?? null),
      payload.requestId || null,
      user?.id || null,
      user?.email || null
    ]
  );
}

function mapGrant(row) {
  return {
    id: row.id,
    grantCode: row.grant_code,
    personnelId: row.personnel_id,
    grantedDate: row.granted_date,
    durationValue: Number(row.duration_value),
    reasonType: row.reason_type,
    weekendOpsDutyDate: row.weekend_ops_duty_date,
    reasonDetails: row.reason_details,
    providedBy: row.provided_by,
    usedValue: Number(row.used_value),
    remainingValue: Number(row.remaining_value),
    status: row.status,
    createdAt: row.created_at
  };
}

function mapUsage(row, allocations) {
  return {
    id: row.id,
    usageCode: row.usage_code,
    personnelId: row.personnel_id,
    intendedDate: row.intended_date,
    session: row.session,
    durationUsed: Number(row.duration_used),
    comments: row.comments,
    createdAt: row.created_at,
    allocations: allocations[row.id] || []
  };
}

async function getAllocationsByUsageIds(client, usageIds) {
  if (!usageIds.length) return {};
  const { rows } = await client.query(
    `SELECT a.usage_id, a.grant_id, g.grant_code, a.amount::float8 AS amount, a.allocation_order
     FROM off_usage_allocations a
     JOIN off_grants g ON g.id = a.grant_id
     WHERE a.reversed_at IS NULL
       AND a.usage_id = ANY($1::uuid[])
     ORDER BY a.usage_id, a.allocation_order`,
    [usageIds]
  );

  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.usage_id]) grouped[row.usage_id] = [];
    grouped[row.usage_id].push({
      grantId: row.grant_id,
      grantCode: row.grant_code,
      amount: Number(row.amount)
    });
  }
  return grouped;
}

export async function getBootstrap(preferredPersonnelId = null) {
  const client = await pool.connect();
  try {
    const [personnelRes, grantsRes, usageRes, logsRes] = await Promise.all([
      client.query(`SELECT id, name, is_active, created_at FROM personnel WHERE deleted_at IS NULL ORDER BY created_at, name`),
      client.query(`SELECT * FROM off_grants WHERE deleted_at IS NULL ORDER BY grant_code`),
      client.query(`SELECT * FROM off_usages WHERE undone_at IS NULL ORDER BY usage_code`),
      client.query(`SELECT id, log_code, event_type, personnel_id, record_type, record_id, summary, before_json, after_json, created_at
                    FROM audit_events
                    ORDER BY created_at DESC
                    LIMIT 500`)
    ]);

    const allocations = await getAllocationsByUsageIds(client, usageRes.rows.map((r) => r.id));
    const personnel = personnelRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.is_active,
      createdAt: r.created_at
    }));

    let selectedPersonnelId = preferredPersonnelId;
    if (!selectedPersonnelId || !personnel.some((p) => p.id === selectedPersonnelId)) {
      selectedPersonnelId = personnel[0]?.id || null;
    }

    return {
      personnel,
      selectedPersonnelId,
      grants: grantsRes.rows.map(mapGrant),
      usages: usageRes.rows.map((row) => mapUsage(row, allocations)),
      logs: logsRes.rows.map((l) => ({
        id: l.id,
        logCode: l.log_code,
        action: l.event_type,
        personnelId: l.personnel_id,
        recordType: l.record_type,
        recordId: l.record_id,
        summary: l.summary,
        before: l.before_json,
        after: l.after_json,
        timestamp: l.created_at
      }))
    };
  } finally {
    client.release();
  }
}

export async function listPersonnel() {
  const { rows } = await pool.query(
    `SELECT id, name, is_active, created_at FROM personnel WHERE deleted_at IS NULL ORDER BY created_at, name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, createdAt: r.created_at }));
}

export async function createPersonnel(payload, user) {
  const name = String(payload?.name || '').trim();
  assert(name, 'name is required.');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO personnel (name, created_by, updated_by)
       VALUES ($1, $2, $2)
       RETURNING id, name, is_active, created_at`,
      [name, user?.id || null]
    ).catch((err) => {
      if (String(err.code) === '23505') throw new ApiError(409, 'Personnel name already exists.');
      throw err;
    });

    const created = rows[0];

    await appendAuditEvent(client, {
      eventType: 'PERSONNEL_CREATED',
      personnelId: created.id,
      recordType: 'PERSONNEL',
      recordId: created.id,
      summary: `Added personnel \"${created.name}\".`,
      before: null,
      after: created
    }, user);

    return { id: created.id, name: created.name, isActive: created.is_active, createdAt: created.created_at };
  });
}

export async function deletePersonnel(personnelId, deleteData, user) {
  assert(personnelId, 'personnelId is required.');

  return withTransaction(async (client) => {
    const pRes = await client.query(
      `SELECT id, name FROM personnel WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [personnelId]
    );
    assert(pRes.rowCount === 1, 'Personnel not found.', 404);

    const p = pRes.rows[0];

    const activeCountRes = await client.query(`SELECT COUNT(*)::int AS c FROM personnel WHERE deleted_at IS NULL`);
    assert(activeCountRes.rows[0].c > 1, 'At least one personnel must remain.');

    const countsRes = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM off_grants WHERE personnel_id = $1 AND deleted_at IS NULL) AS grant_count,
         (SELECT COUNT(*)::int FROM off_usages WHERE personnel_id = $1 AND undone_at IS NULL) AS usage_count,
         (SELECT COUNT(*)::int FROM audit_events WHERE personnel_id = $1) AS log_count`,
      [personnelId]
    );

    const counts = countsRes.rows[0];
    const hasData = counts.grant_count > 0 || counts.usage_count > 0 || counts.log_count > 0;
    if (hasData && !deleteData) {
      throw new ApiError(409, 'Personnel has related records. Set deleteData=true to proceed.');
    }

    if (deleteData) {
      await client.query(
        `UPDATE off_usage_allocations
         SET reversed_at = now()
         WHERE reversed_at IS NULL
           AND usage_id IN (SELECT id FROM off_usages WHERE personnel_id = $1 AND undone_at IS NULL)`,
        [personnelId]
      );
      await client.query(
        `UPDATE off_usages
         SET undone_at = now(), undone_by = $2, updated_by = $2
         WHERE personnel_id = $1 AND undone_at IS NULL`,
        [personnelId, user?.id || null]
      );
      await client.query(
        `UPDATE off_grants
         SET deleted_at = now(), updated_by = $2
         WHERE personnel_id = $1 AND deleted_at IS NULL`,
        [personnelId, user?.id || null]
      );
    }

    await client.query(
      `UPDATE personnel SET deleted_at = now(), is_active = FALSE, updated_by = $2 WHERE id = $1`,
      [personnelId, user?.id || null]
    );

    await appendAuditEvent(client, {
      eventType: 'PERSONNEL_DELETED',
      personnelId,
      recordType: 'PERSONNEL',
      recordId: personnelId,
      summary: deleteData
        ? `Deleted personnel \"${p.name}\" with related data.`
        : `Deleted personnel \"${p.name}\".`,
      before: { counts },
      after: { deleted: true, deleteData }
    }, user);

    return { id: personnelId, deleted: true, deleteData };
  });
}

export async function listGrants(personnelId) {
  assert(personnelId, 'personnelId is required.');
  const { rows } = await pool.query(
    `SELECT * FROM off_grants WHERE deleted_at IS NULL AND personnel_id = $1 ORDER BY grant_code`,
    [personnelId]
  );
  return rows.map(mapGrant);
}

export async function addGrant(payload, user) {
  const personnelId = String(payload?.personnelId || '').trim();
  assert(personnelId, 'personnelId is required.');
  const grantedDate = parseYmd(payload?.grantedDate, 'grantedDate');
  const durationValue = toDurationByType(payload?.durationType);
  const reason = normalizeReason(payload || {});

  return withTransaction(async (client) => {
    const personRes = await client.query(`SELECT id FROM personnel WHERE id = $1 AND deleted_at IS NULL`, [personnelId]);
    assert(personRes.rowCount === 1, 'Personnel not found.', 404);

    const { rows } = await client.query(
      `INSERT INTO off_grants (
          personnel_id, granted_date, duration_value, reason_type, weekend_ops_duty_date,
          reason_details, provided_by, used_value, remaining_value, status, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$3,'UNUSED',$8,$8)
       RETURNING *`,
      [
        personnelId,
        grantedDate,
        durationValue,
        reason.reasonType,
        reason.weekendOpsDate,
        reason.reasonDetails,
        reason.providedBy,
        user?.id || null
      ]
    );

    const created = mapGrant(rows[0]);
    await appendAuditEvent(client, {
      eventType: 'GRANT_CREATED',
      personnelId,
      recordType: 'GRANT',
      recordId: created.id,
      summary: `Added grant ${created.grantCode}.`,
      before: null,
      after: created
    }, user);

    return created;
  });
}

export async function editGrant(grantId, payload, user) {
  const grantedDate = parseYmd(payload?.grantedDate, 'grantedDate');
  const durationValue = toDurationByType(payload?.durationType);
  const reason = normalizeReason(payload || {});

  return withTransaction(async (client) => {
    const gRes = await client.query(
      `SELECT * FROM off_grants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [grantId]
    );
    assert(gRes.rowCount === 1, 'Grant not found.', 404);

    const existing = gRes.rows[0];
    const usedValue = Number(existing.used_value);
    assert(durationValue + 1e-9 >= usedValue, 'Cannot reduce duration below already used value.');

    const remainingValue = round1(durationValue - usedValue);
    const status = computeStatus(usedValue, remainingValue);

    const { rows } = await client.query(
      `UPDATE off_grants
       SET granted_date = $2,
           duration_value = $3,
           reason_type = $4,
           weekend_ops_duty_date = $5,
           reason_details = $6,
           provided_by = $7,
           remaining_value = $8,
           status = $9,
           updated_by = $10
       WHERE id = $1
       RETURNING *`,
      [
        grantId,
        grantedDate,
        durationValue,
        reason.reasonType,
        reason.weekendOpsDate,
        reason.reasonDetails,
        reason.providedBy,
        remainingValue,
        status,
        user?.id || null
      ]
    );

    const updated = mapGrant(rows[0]);
    await appendAuditEvent(client, {
      eventType: 'GRANT_UPDATED',
      personnelId: updated.personnelId,
      recordType: 'GRANT',
      recordId: updated.id,
      summary: `Edited grant ${updated.grantCode}.`,
      before: mapGrant(existing),
      after: updated
    }, user);

    return updated;
  });
}

export async function deleteGrantBatch(ids, user) {
  assert(Array.isArray(ids) && ids.length > 0, 'ids is required and must not be empty.');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM off_grants
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
       ORDER BY grant_code
       FOR UPDATE`,
      [ids]
    );

    assert(rows.length === ids.length, 'One or more grants were not found.', 404);

    for (const g of rows) {
      assert(Number(g.used_value) <= 1e-9, `Cannot delete ${g.grant_code}. It already has usage.`);
    }

    await client.query(
      `UPDATE off_grants SET deleted_at = now(), updated_by = $2 WHERE id = ANY($1::uuid[])`,
      [ids, user?.id || null]
    );

    await appendAuditEvent(client, {
      eventType: 'GRANT_DELETED_BATCH',
      personnelId: rows[0]?.personnel_id || null,
      recordType: 'GRANT',
      recordId: ids.join(','),
      summary: `Deleted ${ids.length} grant(s).`,
      before: rows.map(mapGrant),
      after: { deleted: true, count: ids.length }
    }, user);

    return { deletedCount: ids.length };
  });
}

export async function listUsages(personnelId) {
  assert(personnelId, 'personnelId is required.');
  const client = await pool.connect();
  try {
    const usageRes = await client.query(
      `SELECT * FROM off_usages WHERE undone_at IS NULL AND personnel_id = $1 ORDER BY usage_code`,
      [personnelId]
    );
    const allocations = await getAllocationsByUsageIds(client, usageRes.rows.map((r) => r.id));
    return usageRes.rows.map((row) => mapUsage(row, allocations));
  } finally {
    client.release();
  }
}

export async function addUsage(payload, user) {
  const personnelId = String(payload?.personnelId || '').trim();
  assert(personnelId, 'personnelId is required.');
  const intendedDate = parseYmd(payload?.intendedDate, 'intendedDate');
  const session = String(payload?.session || '').toUpperCase();
  const durationNeeded = toDurationBySession(session);
  const selectedGrantIds = Array.isArray(payload?.selectedGrantIds) ? payload.selectedGrantIds : [];
  assert(selectedGrantIds.length > 0, 'selectedGrantIds must contain at least one grant id.');
  const comments = String(payload?.comments || '').trim();

  return withTransaction(async (client) => {
    const personRes = await client.query(`SELECT id FROM personnel WHERE id = $1 AND deleted_at IS NULL`, [personnelId]);
    assert(personRes.rowCount === 1, 'Personnel not found.', 404);

    const grantsRes = await client.query(
      `SELECT * FROM off_grants
       WHERE deleted_at IS NULL
         AND personnel_id = $1
         AND id = ANY($2::uuid[])
       ORDER BY array_position($2::uuid[], id)
       FOR UPDATE`,
      [personnelId, selectedGrantIds]
    );

    assert(grantsRes.rowCount > 0, 'No valid selected grants with remaining balance.');

    const grants = grantsRes.rows.map((g) => ({ ...g, used_value: Number(g.used_value), remaining_value: Number(g.remaining_value) }));
    const totalRemaining = round1(grants.reduce((sum, g) => sum + g.remaining_value, 0));
    assert(totalRemaining + 1e-9 >= durationNeeded, 'Selected grants do not have enough remaining balance.');

    let need = durationNeeded;
    const allocations = [];

    for (const g of grants) {
      if (need <= 1e-9) break;
      if (g.remaining_value <= 1e-9) continue;
      const take = round1(Math.min(g.remaining_value, need));
      if (take <= 0) continue;
      g.used_value = round1(g.used_value + take);
      g.remaining_value = round1(g.remaining_value - take);
      allocations.push({ grant: g, amount: take });
      need = round1(need - take);
    }

    assert(need <= 1e-9, 'Unable to allocate required duration from selected grants.');

    for (const alloc of allocations) {
      const status = computeStatus(alloc.grant.used_value, alloc.grant.remaining_value);
      await client.query(
        `UPDATE off_grants
         SET used_value = $2, remaining_value = $3, status = $4, updated_by = $5
         WHERE id = $1`,
        [alloc.grant.id, alloc.grant.used_value, alloc.grant.remaining_value, status, user?.id || null]
      );
    }

    const usageInsert = await client.query(
      `INSERT INTO off_usages (personnel_id, intended_date, session, duration_used, comments, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)
       RETURNING *`,
      [personnelId, intendedDate, session, durationNeeded, comments, user?.id || null]
    );
    const usage = usageInsert.rows[0];

    for (let i = 0; i < allocations.length; i += 1) {
      const a = allocations[i];
      await client.query(
        `INSERT INTO off_usage_allocations (usage_id, grant_id, amount, allocation_order, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [usage.id, a.grant.id, a.amount, i + 1, user?.id || null]
      );
    }

    const allocView = allocations.map((a) => ({ grantId: a.grant.id, grantCode: a.grant.grant_code, amount: a.amount }));
    const mapped = {
      id: usage.id,
      usageCode: usage.usage_code,
      personnelId: usage.personnel_id,
      intendedDate: usage.intended_date,
      session: usage.session,
      durationUsed: Number(usage.duration_used),
      comments: usage.comments,
      createdAt: usage.created_at,
      allocations: allocView
    };

    await appendAuditEvent(client, {
      eventType: 'USAGE_CREATED',
      personnelId,
      recordType: 'USAGE',
      recordId: usage.id,
      summary: `Added usage ${usage.usage_code}.`,
      before: null,
      after: mapped
    }, user);

    return mapped;
  });
}

export async function editUsage(usageId, payload, user) {
  const intendedDate = parseYmd(payload?.intendedDate, 'intendedDate');
  const session = String(payload?.session || '').toUpperCase();
  const targetDuration = toDurationBySession(session);
  const selectedGrantIds = Array.isArray(payload?.selectedGrantIds) ? payload.selectedGrantIds : [];
  assert(selectedGrantIds.length > 0, 'selectedGrantIds must contain at least one grant id.');
  const comments = String(payload?.comments || '').trim();

  return withTransaction(async (client) => {
    const usageRes = await client.query(
      `SELECT * FROM off_usages WHERE id = $1 AND undone_at IS NULL FOR UPDATE`,
      [usageId]
    );
    assert(usageRes.rowCount === 1, 'Usage not found.', 404);
    const usage = usageRes.rows[0];

    const currentAllocRes = await client.query(
      `SELECT * FROM off_usage_allocations
       WHERE usage_id = $1 AND reversed_at IS NULL
       ORDER BY allocation_order
       FOR UPDATE`,
      [usageId]
    );
    assert(currentAllocRes.rowCount > 0, 'Existing usage allocations not found.');

    const currentAllocs = currentAllocRes.rows.map((r) => ({ grantId: r.grant_id, amount: Number(r.amount) }));
    const lockGrantIds = Array.from(new Set([...currentAllocs.map((a) => a.grantId), ...selectedGrantIds]));

    const grantsRes = await client.query(
      `SELECT * FROM off_grants
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
       FOR UPDATE`,
      [lockGrantIds]
    );

    const grants = new Map(grantsRes.rows.map((g) => [g.id, { ...g, used_value: Number(g.used_value), remaining_value: Number(g.remaining_value) }]));

    for (const alloc of currentAllocs) {
      const grant = grants.get(alloc.grantId);
      assert(grant, `Grant ${alloc.grantId} not found.`);
      grant.used_value = round1(grant.used_value - alloc.amount);
      grant.remaining_value = round1(grant.remaining_value + alloc.amount);
      assert(grant.used_value >= -1e-9 && grant.remaining_value >= -1e-9, 'Invalid grant balances while reverting usage.');
    }

    const selectedGrants = selectedGrantIds
      .map((id) => grants.get(id))
      .filter((g) => g && g.personnel_id === usage.personnel_id && g.remaining_value > 0);

    assert(selectedGrants.length > 0, 'No valid selected grants with remaining balance.');

    const totalRemaining = round1(selectedGrants.reduce((sum, g) => sum + g.remaining_value, 0));
    assert(totalRemaining + 1e-9 >= targetDuration, 'Selected grants are insufficient for the updated duration.');

    let need = targetDuration;
    const newAllocs = [];
    for (const g of selectedGrants) {
      if (need <= 1e-9) break;
      const take = round1(Math.min(g.remaining_value, need));
      if (take <= 0) continue;
      g.used_value = round1(g.used_value + take);
      g.remaining_value = round1(g.remaining_value - take);
      newAllocs.push({ grant: g, amount: take });
      need = round1(need - take);
    }
    assert(need <= 1e-9, 'Unable to allocate enough duration for updated usage.');

    for (const g of grants.values()) {
      const status = computeStatus(g.used_value, g.remaining_value);
      await client.query(
        `UPDATE off_grants SET used_value = $2, remaining_value = $3, status = $4, updated_by = $5 WHERE id = $1`,
        [g.id, g.used_value, g.remaining_value, status, user?.id || null]
      );
    }

    await client.query(
      `UPDATE off_usage_allocations
       SET reversed_at = now()
       WHERE usage_id = $1 AND reversed_at IS NULL`,
      [usageId]
    );

    for (let i = 0; i < newAllocs.length; i += 1) {
      const a = newAllocs[i];
      await client.query(
        `INSERT INTO off_usage_allocations (usage_id, grant_id, amount, allocation_order, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [usageId, a.grant.id, a.amount, i + 1, user?.id || null]
      );
    }

    const usageUpdate = await client.query(
      `UPDATE off_usages
       SET intended_date = $2, session = $3, duration_used = $4, comments = $5, updated_by = $6
       WHERE id = $1
       RETURNING *`,
      [usageId, intendedDate, session, targetDuration, comments, user?.id || null]
    );

    const updated = usageUpdate.rows[0];
    const mappedAfter = {
      id: updated.id,
      usageCode: updated.usage_code,
      personnelId: updated.personnel_id,
      intendedDate: updated.intended_date,
      session: updated.session,
      durationUsed: Number(updated.duration_used),
      comments: updated.comments,
      createdAt: updated.created_at,
      allocations: newAllocs.map((a) => ({ grantId: a.grant.id, grantCode: a.grant.grant_code, amount: a.amount }))
    };

    await appendAuditEvent(client, {
      eventType: 'USAGE_UPDATED',
      personnelId: updated.personnel_id,
      recordType: 'USAGE',
      recordId: updated.id,
      summary: `Edited usage ${updated.usage_code}.`,
      before: {
        id: usage.id,
        usageCode: usage.usage_code,
        intendedDate: usage.intended_date,
        session: usage.session,
        durationUsed: Number(usage.duration_used),
        comments: usage.comments,
        allocations: currentAllocs
      },
      after: mappedAfter
    }, user);

    return mappedAfter;
  });
}

export async function undoUsage(usageId, user) {
  return withTransaction(async (client) => {
    const usageRes = await client.query(
      `SELECT * FROM off_usages WHERE id = $1 AND undone_at IS NULL FOR UPDATE`,
      [usageId]
    );
    assert(usageRes.rowCount === 1, 'Usage not found.', 404);
    const usage = usageRes.rows[0];

    const allocRes = await client.query(
      `SELECT * FROM off_usage_allocations
       WHERE usage_id = $1 AND reversed_at IS NULL
       ORDER BY allocation_order
       FOR UPDATE`,
      [usageId]
    );
    assert(allocRes.rowCount > 0, 'Usage allocations not found.');

    const allocs = allocRes.rows.map((a) => ({ grantId: a.grant_id, amount: Number(a.amount) }));

    const grantsRes = await client.query(
      `SELECT * FROM off_grants WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE`,
      [allocs.map((a) => a.grantId)]
    );
    const grants = new Map(grantsRes.rows.map((g) => [g.id, { ...g, used_value: Number(g.used_value), remaining_value: Number(g.remaining_value) }]));

    for (const alloc of allocs) {
      const g = grants.get(alloc.grantId);
      assert(g, `Grant ${alloc.grantId} not found.`);
      g.used_value = round1(g.used_value - alloc.amount);
      g.remaining_value = round1(g.remaining_value + alloc.amount);
      assert(g.used_value >= -1e-9 && g.remaining_value >= -1e-9, 'Invalid grant balances while undoing usage.');
    }

    for (const g of grants.values()) {
      const status = computeStatus(g.used_value, g.remaining_value);
      await client.query(
        `UPDATE off_grants SET used_value = $2, remaining_value = $3, status = $4, updated_by = $5 WHERE id = $1`,
        [g.id, g.used_value, g.remaining_value, status, user?.id || null]
      );
    }

    await client.query(
      `UPDATE off_usage_allocations SET reversed_at = now() WHERE usage_id = $1 AND reversed_at IS NULL`,
      [usageId]
    );

    await client.query(
      `UPDATE off_usages SET undone_at = now(), undone_by = $2, updated_by = $2 WHERE id = $1`,
      [usageId, user?.id || null]
    );

    await appendAuditEvent(client, {
      eventType: 'USAGE_UNDONE',
      personnelId: usage.personnel_id,
      recordType: 'USAGE',
      recordId: usage.id,
      summary: `Undid usage ${usage.usage_code}.`,
      before: {
        id: usage.id,
        usageCode: usage.usage_code,
        intendedDate: usage.intended_date,
        session: usage.session,
        durationUsed: Number(usage.duration_used),
        comments: usage.comments,
        allocations: allocs
      },
      after: { undone: true }
    }, user);

    return { id: usageId, undone: true };
  });
}

export async function getDashboard(personnelId) {
  assert(personnelId, 'personnelId is required.');
  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(duration_value)::float8 FROM off_grants WHERE personnel_id = $1 AND deleted_at IS NULL), 0) AS total_granted,
       COALESCE((SELECT SUM(duration_used)::float8 FROM off_usages WHERE personnel_id = $1 AND undone_at IS NULL), 0) AS total_used,
       COALESCE((SELECT SUM(remaining_value)::float8 FROM off_grants WHERE personnel_id = $1 AND deleted_at IS NULL), 0) AS balance`,
    [personnelId]
  );

  return {
    personnelId,
    totalGranted: round1(rows[0].total_granted),
    totalUsed: round1(rows[0].total_used),
    balance: round1(rows[0].balance)
  };
}

export async function getCalendar(personnelId, month) {
  assert(personnelId, 'personnelId is required.');
  assert(/^\d{4}-\d{2}$/.test(String(month || '')), 'month must be in YYYY-MM format.');

  const start = `${month}-01`;
  const grantsRes = await pool.query(
    `SELECT granted_date::text AS date, SUM(duration_value)::float8 AS total
     FROM off_grants
     WHERE personnel_id = $1
       AND deleted_at IS NULL
       AND date_trunc('month', granted_date) = date_trunc('month', $2::date)
     GROUP BY granted_date`,
    [personnelId, start]
  );

  const usageRes = await pool.query(
    `SELECT intended_date::text AS date, SUM(duration_used)::float8 AS total
     FROM off_usages
     WHERE personnel_id = $1
       AND undone_at IS NULL
       AND date_trunc('month', intended_date) = date_trunc('month', $2::date)
     GROUP BY intended_date`,
    [personnelId, start]
  );

  return {
    personnelId,
    month,
    grantedByDate: grantsRes.rows.map((r) => ({ date: r.date, total: round1(r.total) })),
    usedByDate: usageRes.rows.map((r) => ({ date: r.date, total: round1(r.total) }))
  };
}

export async function listLogs({ personnelId = null, action = null, page = 1, pageSize = 50 }) {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (pageNumber - 1) * size;

  const clauses = [];
  const params = [];

  if (personnelId) {
    params.push(personnelId);
    clauses.push(`personnel_id = $${params.length}`);
  }
  if (action) {
    params.push(String(action));
    clauses.push(`event_type = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  params.push(size);
  params.push(offset);

  const { rows } = await pool.query(
    `SELECT id, log_code, event_type, personnel_id, record_type, record_id, summary, before_json, after_json, actor_email, created_at
     FROM audit_events
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    logCode: r.log_code,
    action: r.event_type,
    personnelId: r.personnel_id,
    recordType: r.record_type,
    recordId: r.record_id,
    summary: r.summary,
    before: r.before_json,
    after: r.after_json,
    editedBy: r.actor_email,
    timestamp: r.created_at
  }));
}
