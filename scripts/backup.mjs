// Script to export manual backup from Cloudflare D1.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const backupDir = path.resolve('backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(backupDir, `backup-${timestamp}.sql`);

console.log(`Starting Cloudflare D1 backup to: ${outputFile}`);
try {
  execSync(`npx wrangler d1 export cinema-party --remote --output "${outputFile}"`, {
    stdio: 'inherit',
  });
  console.log(`Backup completed successfully: ${outputFile}`);
} catch (err) {
  console.error('Backup failed:', err.message);
  process.exit(1);
}
