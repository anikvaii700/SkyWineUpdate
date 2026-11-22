import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function readFallbackFirebaseProjectId(): string {
  try {
    const configPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
      if (parsed.projectId && parsed.projectId !== 'remixed-project-id') return parsed.projectId.trim();
    }
  } catch {
    // Ignore missing or unreadable applet config; env var takes precedence.
  }
  return '';
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeAdminPhone(raw: string): string {
  let digits = raw.replace(/\\D/g, '');
  if (digits.startsWith('880') && digits.length === 13) digits = '0' + digits.slice(3);
  return digits;
}

const rawPort = Number.parseInt(process.env.PORT || '3000', 10);

export const env = {
  rootDir: ROOT_DIR,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3000,
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  firebaseProjectId: (process.env.FIREBASE_PROJECT_ID || readFallbackFirebaseProjectId()).trim(),
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
  adminEmails: parseList(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
  adminPhones: parseList(process.env.ADMIN_PHONES).map(normalizeAdminPhone).filter((phone) => /^01[0-9]{9}$/.test(phone)),
} as const;
