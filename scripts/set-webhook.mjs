// Script to set Telegram bot webhook and menu button.

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });

async function run() {
  console.log('--- Telegram Webhook & Menu Button Setup ---');

  const workerUrl = (
    process.env.WORKER_URL || (await rl.question('Enter deployed Worker URL (e.g. https://cinema-party.your-subdomain.workers.dev): '))
  ).trim().replace(/\/+$/, '');

  const botToken = (
    process.env.BOT_TOKEN || (await rl.question('Enter Telegram BOT_TOKEN from @BotFather: '))
  ).trim();

  const webhookSecret = (
    process.env.WEBHOOK_SECRET || (await rl.question('Enter WEBHOOK_SECRET (configured on Worker): '))
  ).trim();

  rl.close();

  if (!workerUrl || !botToken) {
    console.error('Error: Worker URL and BOT_TOKEN are required.');
    process.exit(1);
  }

  // 1. Set webhook
  console.log(`Setting webhook to: ${workerUrl}/telegram`);
  const whRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${workerUrl}/telegram`,
      secret_token: webhookSecret || undefined,
      drop_pending_updates: true,
    }),
  });
  const whData = await whRes.json();
  if (!whData.ok) {
    console.error('Failed to set webhook:', whData.description);
  } else {
    console.log('Webhook set successfully.');
  }

  // 2. Set chat menu button
  console.log(`Setting chat menu button to: ${workerUrl}`);
  const mbRes = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      menu_button: {
        type: 'web_app',
        text: 'Movies',
        web_app: { url: workerUrl },
      },
    }),
  });
  const mbData = await mbRes.json();
  if (!mbData.ok) {
    console.warn('Warning: Could not set chat menu button:', mbData.description);
  } else {
    console.log('Chat menu button set successfully.');
  }

  console.log('Setup finished.');
}

run().catch(console.error);
