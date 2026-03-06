import { ApiError } from './response.js';

export function assert(condition, message, status = 400) {
  if (!condition) throw new ApiError(status, message);
}

export function parseYmd(value, fieldName) {
  const text = String(value || '').trim();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(text), `${fieldName} must be in YYYY-MM-DD format.`);
  return text;
}

export function parseMonth(value) {
  const text = String(value || '').trim();
  assert(/^\d{4}-\d{2}$/.test(text), 'month must be in YYYY-MM format.');
  return text;
}

export function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

export function toDurationBySession(session) {
  const normalized = String(session || '').toUpperCase();
  if (normalized === 'FULL') return 1;
  if (normalized === 'AM' || normalized === 'PM') return 0.5;
  throw new ApiError(400, 'session must be FULL, AM, or PM.');
}

export function toDurationByType(durationType) {
  const normalized = String(durationType || '').toUpperCase();
  if (normalized === 'FULL') return 1;
  if (normalized === 'HALF') return 0.5;
  throw new ApiError(400, 'durationType must be FULL or HALF.');
}

export function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function isWeekend(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}
