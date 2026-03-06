import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { attachUser } from './middleware/auth.js';
import { buildOffTrackerRouter } from './routes/offTrackerRoutes.js';
import { fail } from './utils/response.js';

export function buildApp() {
  const app = express();
  const allowOrigin = config.corsOrigin || '*';
  const corsOptions = {
    origin: allowOrigin === '*' ? true : allowOrigin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS']
  };

  app.use((req, res, next) => {
    const reqOrigin = req.headers.origin;
    const isAllowedOrigin = allowOrigin === '*' || (reqOrigin && reqOrigin === allowOrigin);
    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin === '*' ? '*' : reqOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-user-id,x-user-email,x-user-role');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(attachUser);

  app.use('/api', buildOffTrackerRouter());

  app.use((err, _req, res, _next) => {
    const status = Number(err.status) || 500;
    const message = status >= 500 ? 'Internal server error.' : err.message || 'Request failed.';
    const errors = err.errors || [];
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    fail(res, status, message, errors);
  });

  return app;
}
