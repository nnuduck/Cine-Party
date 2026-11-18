// Interactive setup helper for Google Sign-In & OAuth secrets on Cloudflare Worker.
import { execFileSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

function putSecret(name, value) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(cmd, ['wrangler', 'secret', 'put', name], {
    input: `${value}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

async function run() {
  console.log('=== Cinema Party — Google Sign-In & Linking Setup ===\n');
  console.log('In Google Cloud Console -> APIs & Services -> Credentials:');
  console.log('1) Create an Android OAuth client ID:');
  console.log('   Package name: app.cinemaparty.nothing');
  console.log('   SHA-1 (Release APK): EA:17:F1:16:A0:48:8B:1E:A0:26:D2:F4:FE:00:7B:0A:7C:0C:1D:ED\n');
  console.log('2) Create a Web application OAuth client ID (used as serverClientId by Android CredentialManager & PKCE fallback):');
  console.log('   Authorized redirect URI: https://cinema-party.nnuduck-cinema.workers.dev/api/auth/google/callback\n');

  const clientId = (
    process.argv[2] ||
    process.env.GOOGLE_CLIENT_ID ||
    (await rl.question('Enter Google Web Client ID (required): '))
  ).trim();

  if (!clientId) {
    rl.close();
    console.error('Aborted: GOOGLE_CLIENT_ID is required.');
    process.exit(1);
  }

  const clientSecret = (
    process.argv[3] ||
    process.env.GOOGLE_CLIENT_SECRET ||
    (await rl.question('Enter Google Web Client Secret (optional, for browser Custom Tab fallback; Enter to skip): '))
  ).trim();

  rl.close();

  console.log('\nUploading GOOGLE_CLIENT_ID secret to Cloudflare Worker...');
  putSecret('GOOGLE_CLIENT_ID', clientId);

  if (clientSecret) {
    console.log('Uploading GOOGLE_CLIENT_SECRET secret to Cloudflare Worker...');
    putSecret('GOOGLE_CLIENT_SECRET', clientSecret);
  }

  console.log('\nDone! The Android APK reads /api/auth/providers dynamically and enables Google Sign-In without rebuilding.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
