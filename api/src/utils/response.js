export function ok(res, data, message = '') {
  return res.json({ ok: true, data, message, errors: [] });
}

export function fail(res, status, message, errors = []) {
  return res.status(status).json({ ok: false, data: null, message, errors });
}

export class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}
