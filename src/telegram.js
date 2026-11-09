// Telegram webhook update handler.
import { joinByCode } from './db.js';

export async function handleTelegramWebhook(request, env) {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  let update = null;
  try {
    update = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const message = update?.message;
  if (!message || !message.text) {
    return new Response('OK');
  }

  const text = message.text.trim();
  const from = message.from;
  if (!from) return new Response('OK');

  // Upsert user
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`
  )
    .bind(from.id, from.first_name || '', from.username || null)
    .run();

  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const code = (parts[1] || '').trim().toUpperCase();

    let replyText = 'Welcome to Cinema Party. Track movies together with friends.';
    let partyJoined = false;

    if (code) {
      const partyId = await joinByCode(env, from.id, code);
      if (partyId) {
        partyJoined = true;
        const party = await env.DB.prepare('SELECT name FROM parties WHERE id = ?')
          .bind(partyId)
          .first();
        replyText = `You joined "${party?.name || 'Party'}".`;
      } else {
        replyText = 'Invalid or expired invite code.';
      }
    }

    const appUrl = new URL(request.url).origin;
    const targetUrl = code ? `${appUrl}?code=${encodeURIComponent(code)}` : appUrl;

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '🎬 Open Cinema',
            web_app: { url: targetUrl },
          },
        ],
      ],
    };

    if (env.BOT_TOKEN) {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: replyText,
          reply_markup: replyMarkup,
        }),
      });
    }
  }

  return new Response('OK');
}
