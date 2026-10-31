import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  redisUrl: process.env.REDIS_URL || '',
  stateFile: process.env.STATE_FILE || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-in-production',
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC || 3600),
  ticketTtlSec: Number(process.env.TICKET_TTL_SEC || 90),
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC || 43200),
  draftTtlSec: Number(process.env.DRAFT_TTL_SEC || 86400),
  leaseTtlMs: Number(process.env.LEASE_TTL_MS || 30000),
  webRoot: path.resolve(here, '../../web'),
  logLevel: process.env.LOG_LEVEL || 'info',
  adminCode: process.env.ADMIN_DEMO_CODE || 'ADMIN-2026',
  dailyLimitRub: Number(process.env.DAILY_LIMIT_RUB || 500000),
};
