// Interactive setup helper for Cinema Party deployment.

import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

async function main() {
  console.log('=== Cinema Party Setup Assistant ===\n');

  console.log('1. Checking Cloudflare login status...');
  try {
    execSync('npx wrangler whoami', { stdio: 'inherit' });
  } catch {
    console.log('\nPlease run: npx wrangler login\n');
    rl.close();
    return;
  }

  const ans = await rl.question('\nCreate Cloudflare D1 database now? (y/n): ');
  if (ans.trim().toLowerCase() === 'y') {
    try {
      execSync('npx wrangler d1 create cinema-party', { stdio: 'inherit' });
      console.log('\nPlease copy the database_id printed above into wrangler.jsonc!');
    } catch (e) {
      console.warn('D1 create failed or already exists:', e.message);
    }
  }

  rl.close();
  console.log('\nSetup assistant finished. Refer to README.md for next steps.');
}

main().catch(console.error);
