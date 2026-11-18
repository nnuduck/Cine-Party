// Telegram webhook update handler and native bot OAuth confirmation.
import {
  getCover,
  joinByCode,
  resolveOrLinkTelegramUser,
  saveCover,
} from './db.js';

async function tgBotCall(env, method, payload) {
  if (!env.BOT_TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Downloads the Telegram profile photo via Bot API and stores it safely in D1 covers,
 * never storing raw api.telegram.org file tokens in database rows.
 */
export async function importTelegramAvatarIfMissing(env, tgUserId, targetUserId) {
  if (!env.BOT_TOKEN || !tgUserId || !targetUserId) return null;
  try {
    const existing = await env.DB.prepare('SELECT avatar_url FROM users WHERE id = ?1')
      .bind(targetUserId)
      .first();
    if (existing?.avatar_url) return existing.avatar_url;

    const photosRes = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/getUserProfilePhotos?user_id=${encodeURIComponent(tgUserId)}&limit=1`,
      { signal: AbortSignal.timeout(2500) }
    );
    const photosData = await photosRes.json().catch(() => null);
    const sizes = photosData?.ok ? photosData?.result?.photos?.[0] : null;
    if (!Array.isArray(sizes) || sizes.length === 0) return null;

    const chosen = sizes.length >= 2 ? sizes[1] : sizes[0];
    if (!chosen?.file_id) return null;

    const fileRes = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(chosen.file_id)}`,
      { signal: AbortSignal.timeout(2500) }
    );
    const fileData = await fileRes.json().catch(() => null);
    const filePath = fileData?.ok ? fileData?.result?.file_path : null;
    if (!filePath) return null;

    const imgRes = await fetch(
      `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`,
      { signal: AbortSignal.timeout(2500) }
    );
    if (!imgRes.ok) return null;
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    if (bytes.byteLength < 12 || bytes.byteLength > 190 * 1024) return null;

    const mime = imgRes.headers.get('content-type')?.includes('png') ? 'image/png' : 'image/jpeg';
    const coverId = await saveCover(env, targetUserId, mime, bytes);
    const url = `/api/covers/${coverId}`;
    await env.DB.prepare('UPDATE users SET avatar_url = COALESCE(avatar_url, ?1) WHERE id = ?2')
      .bind(url, targetUserId)
      .run();
    await env.DB.prepare(
      'UPDATE user_identities SET avatar_url = COALESCE(avatar_url, ?1) WHERE provider = ?2 AND provider_uid = ?3'
    )
      .bind(url, 'telegram', String(tgUserId))
      .run();
    return url;
  } catch {
    return null;
  }
}

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

  const origin = new URL(request.url).origin;

  // Handle native Android login/link confirmation buttons
  const cb = update?.callback_query;
  if (cb && cb.data && cb.from) {
    const data = String(cb.data);
    const from = cb.from;
    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;

    if (data.startsWith('tg_auth_no:')) {
      const challengeId = data.slice('tg_auth_no:'.length).toLowerCase();
      if (/^[a-f0-9]{32}$/.test(challengeId)) {
        await env.DB.prepare(
          "UPDATE auth_challenges SET status = 'cancelled', error_message = 'Cancelled in Telegram' WHERE id = ?1 AND status = 'pending'"
        )
          .bind(challengeId)
          .run();
      }
      await tgBotCall(env, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Отменено',
      });
      if (chatId && msgId) {
        await tgBotCall(env, 'editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: '❌ Вход в Cinema Party (Android) отменён.',
        });
      }
      return new Response('OK');
    }

    if (data.startsWith('tg_auth_ok:')) {
      const challengeId = data.slice('tg_auth_ok:'.length).toLowerCase();
      const challenge = /^[a-f0-9]{32}$/.test(challengeId)
        ? await env.DB.prepare(
            "SELECT * FROM auth_challenges WHERE id = ?1 AND provider = 'telegram' AND status = 'pending' AND datetime(expires_at) > datetime('now')"
          )
            .bind(challengeId)
            .first()
        : null;

      if (!challenge) {
        await tgBotCall(env, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Запрос устарел или уже использован',
          show_alert: true,
        });
        if (chatId && msgId) {
          await tgBotCall(env, 'editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: '⌛ Срок действия ссылки для входа истёк. Запросите новую в приложении.',
          });
        }
        return new Response('OK');
      }

      try {
        const tgUser = {
          id: Number(from.id),
          first_name: String(from.first_name || ''),
          username: from.username ? String(from.username) : null,
          photo_url: null,
        };
        const resolvedUserId = await resolveOrLinkTelegramUser(env, tgUser, {
          mode: challenge.mode,
          linkUserId: challenge.link_user_id ? Number(challenge.link_user_id) : null,
        });
        await importTelegramAvatarIfMissing(env, Number(from.id), resolvedUserId);

        await env.DB.prepare(
          "UPDATE auth_challenges SET status = 'approved', resolved_user_id = ?1 WHERE id = ?2"
        )
          .bind(resolvedUserId, challengeId)
          .run();

        await tgBotCall(env, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '✅ Вход подтверждён!',
        });
        if (chatId && msgId) {
          await tgBotCall(env, 'editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: '✅ Вход в Cinema Party (Android) подтверждён!\nНажмите кнопку ниже или просто вернитесь в приложение.',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🎬 Открыть Cinema Party',
                    url: `${origin}/api/auth/open?challenge=${encodeURIComponent(challengeId)}`,
                  },
                ],
              ],
            },
          });
        }
      } catch (err) {
        const errMsg = err?.message || 'Failed to confirm Telegram sign-in';
        await env.DB.prepare(
          "UPDATE auth_challenges SET status = 'error', error_message = ?1 WHERE id = ?2"
        )
          .bind(errMsg, challengeId)
          .run();
        await tgBotCall(env, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: errMsg.slice(0, 180),
          show_alert: true,
        });
        if (chatId && msgId) {
          await tgBotCall(env, 'editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: `⚠️ ${errMsg}`,
          });
        }
      }
      return new Response('OK');
    }

    await tgBotCall(env, 'answerCallbackQuery', { callback_query_id: cb.id });
    return new Response('OK');
  }

  const message = update?.message;
  if (!message || !message.text) {
    return new Response('OK');
  }

  const text = message.text.trim();
  const from = message.from;
  if (!from) return new Response('OK');

  // Upsert user without overwriting custom_name-backed first_name
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET
       first_name = CASE WHEN users.custom_name IS NULL THEN excluded.first_name ELSE users.first_name END,
       username = excluded.username`
  )
    .bind(from.id, from.first_name || '', from.username || null)
    .run();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const rawArg = (parts[1] || '').trim();

    if (rawArg.toLowerCase().startsWith('auth_')) {
      const challengeId = rawArg.slice(5).toLowerCase();
      const challenge = /^[a-f0-9]{32}$/.test(challengeId)
        ? await env.DB.prepare(
            "SELECT * FROM auth_challenges WHERE id = ?1 AND provider = 'telegram' AND status = 'pending' AND datetime(expires_at) > datetime('now')"
          )
            .bind(challengeId)
            .first()
        : null;

      if (!challenge) {
        await tgBotCall(env, 'sendMessage', {
          chat_id: message.chat.id,
          text: '⌛ Этот запрос на вход устарел или уже использован. Откройте Cinema Party на телефоне и попробуйте снова.',
        });
        return new Response('OK');
      }

      const actionLabel = challenge.mode === 'link'
        ? 'привязать этот Telegram-аккаунт к профилю'
        : 'войти в свой аккаунт в приложении';
      await tgBotCall(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: `🔐 Запрос на вход в Cinema Party (Android)\n\nНажмите кнопку ниже, чтобы ${actionLabel}. Все ваши комнаты, фильмы и папки будут синхронизированы.`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Подтвердить вход', callback_data: `tg_auth_ok:${challengeId}` },
              { text: '❌ Отмена', callback_data: `tg_auth_no:${challengeId}` },
            ],
          ],
        },
      });
      return new Response('OK');
    }

    const code = rawArg.toUpperCase();
    let replyText = 'Welcome to Cinema Party. Track movies together with friends.';

    if (code) {
      const partyId = await joinByCode(env, from.id, code);
      if (partyId) {
        const party = await env.DB.prepare('SELECT name FROM parties WHERE id = ?')
          .bind(partyId)
          .first();
        replyText = `You joined "${party?.name || 'Party'}".`;
      } else {
        replyText = 'Invalid or expired invite code.';
      }
    }

    const targetUrl = code ? `${origin}?code=${encodeURIComponent(code)}` : origin;

    const botUser = env.BOT_USERNAME;
    const appShort = env.APP_SHORT_NAME;
    const miniAppUrl = botUser && appShort
      ? `https://t.me/${botUser}/${appShort}${code ? `?startapp=${encodeURIComponent(code)}` : ''}`
      : null;

    const keyboard = [];
    if (miniAppUrl) {
      keyboard.push([
        {
          text: '🎬 Open Mini App',
          url: miniAppUrl,
        },
      ]);
    }
    keyboard.push([
      {
        text: miniAppUrl ? 'Open in Chat' : '🎬 Open Cinema',
        web_app: { url: targetUrl },
      },
    ]);

    await tgBotCall(env, 'sendMessage', {
      chat_id: message.chat.id,
      text: replyText,
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  return new Response('OK');
}

