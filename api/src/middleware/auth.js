export function attachUser(req, _res, next) {
  // In production, replace with real auth middleware (JWT/session).
  req.user = {
    id: req.header('x-user-id') || null,
    email: req.header('x-user-email') || 'local@offtracker.dev',
    role: (req.header('x-user-role') || 'ADMIN').toUpperCase()
  };
  next();
}

export function requireRole(roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      const err = new Error(`Role ${req.user.role} cannot access this endpoint.`);
      err.status = 403;
      return next(err);
    }
    next();
  };
}
