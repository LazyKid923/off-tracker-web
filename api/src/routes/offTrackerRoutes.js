import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { ok } from '../utils/response.js';
import {
  addGrant,
  addUsage,
  createPersonnel,
  deleteGrantBatch,
  deletePersonnel,
  editGrant,
  editUsage,
  getBootstrap,
  getCalendar,
  getDashboard,
  listGrants,
  listLogs,
  listPersonnel,
  listUsages,
  undoUsage
} from '../services/offTrackerService.js';
import { parseBoolean, parseMonth } from '../utils/validate.js';

export function buildOffTrackerRouter() {
  const router = Router();

  router.get('/health', (_req, res) => ok(res, { status: 'ok' }));

  router.get('/bootstrap', async (req, res, next) => {
    try {
      const data = await getBootstrap(req.query.selectedPersonnelId || null);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.get('/personnel', async (_req, res, next) => {
    try {
      ok(res, await listPersonnel());
    } catch (err) {
      next(err);
    }
  });

  router.post('/personnel', requireRole(['ADMIN']), async (req, res, next) => {
    try {
      ok(res, await createPersonnel(req.body, req.user), 'Personnel created.');
    } catch (err) {
      next(err);
    }
  });

  router.delete('/personnel/:id', requireRole(['ADMIN']), async (req, res, next) => {
    try {
      const deleteData = parseBoolean(req.query.deleteData);
      ok(res, await deletePersonnel(req.params.id, deleteData, req.user), 'Personnel deleted.');
    } catch (err) {
      next(err);
    }
  });

  router.get('/dashboard', async (req, res, next) => {
    try {
      ok(res, await getDashboard(String(req.query.personnelId || '')));
    } catch (err) {
      next(err);
    }
  });

  router.get('/grants', async (req, res, next) => {
    try {
      ok(res, await listGrants(String(req.query.personnelId || '')));
    } catch (err) {
      next(err);
    }
  });

  router.post('/grants', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await addGrant(req.body, req.user), 'Grant created.');
    } catch (err) {
      next(err);
    }
  });

  router.patch('/grants/:grantId', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await editGrant(req.params.grantId, req.body, req.user), 'Grant updated.');
    } catch (err) {
      next(err);
    }
  });

  router.delete('/grants', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await deleteGrantBatch(req.body.ids || [], req.user), 'Grant(s) deleted.');
    } catch (err) {
      next(err);
    }
  });

  router.get('/usages', async (req, res, next) => {
    try {
      ok(res, await listUsages(String(req.query.personnelId || '')));
    } catch (err) {
      next(err);
    }
  });

  router.post('/usages', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await addUsage(req.body, req.user), 'Usage created.');
    } catch (err) {
      next(err);
    }
  });

  router.patch('/usages/:usageId', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await editUsage(req.params.usageId, req.body, req.user), 'Usage updated.');
    } catch (err) {
      next(err);
    }
  });

  router.delete('/usages/:usageId/undo', requireRole(['ADMIN', 'EDITOR']), async (req, res, next) => {
    try {
      ok(res, await undoUsage(req.params.usageId, req.user), 'Usage undone.');
    } catch (err) {
      next(err);
    }
  });

  router.get('/calendar', async (req, res, next) => {
    try {
      const month = parseMonth(String(req.query.month || ''));
      ok(res, await getCalendar(String(req.query.personnelId || ''), month));
    } catch (err) {
      next(err);
    }
  });

  router.get('/logs', async (req, res, next) => {
    try {
      ok(res, await listLogs({
        personnelId: req.query.personnelId || null,
        action: req.query.action || null,
        page: req.query.page || 1,
        pageSize: req.query.pageSize || 50
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
