import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Off Tracker API listening on http://localhost:${config.port}`);
});
