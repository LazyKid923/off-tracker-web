import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || '*'
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required. Set it in api/.env.');
}
