#!/usr/bin/env node
/**
 * HDrezka Viewing History Importer for Cinema Party
 * 
 * Usage:
 *   node scripts/import-hdrezka.mjs --preview
 *   node scripts/import-hdrezka.mjs --sql-only
 *   node scripts/import-hdrezka.mjs --apply --remote
 *   node scripts/import-hdrezka.mjs --apply --local
 * 
 * Options:
 *   --input <file>        Input text file (default: scripts/hdrezka.txt)
 *   --user-id <id>        Telegram User ID (default: 8705354226)
 *   --party-id <id>       Party ID (default: 1)
 *   --kind <kind>         'personal' or 'together' (default: personal)
 *   --status <status>     'watched' or 'want' (default: watched)
 *   --skip-enrich         Skip fetching posters and genres from TMDB
 *   --preview             Show summary and sample records without creating files or modifying DB
 *   --sql-only            Generate import_hdrezka.sql without executing
 *   --apply               Execute generated SQL on database
 *   --remote              Target Cloudflare D1 production database (default with --apply)
 *   --local               Target local Miniflare D1 database
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { searchMovies } from '../src/movieSearch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'tmdb_cache.json');

// Parse CLI flags
const args = process.argv.slice(2);
function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return defaultValue;
}
const hasFlag = (flag) => args.includes(flag);

const inputFile = getArg('--input', path.join(__dirname, 'hdrezka.txt'));
const userId = parseInt(getArg('--user-id', '8705354226'), 10);
const partyId = parseInt(getArg('--party-id', '1'), 10);
const kind = getArg('--kind', 'personal');
const status = getArg('--status', 'watched');
const skipEnrich = hasFlag('--skip-enrich');
const isPreview = hasFlag('--preview');
const isSqlOnly = hasFlag('--sql-only');
const isApply = hasFlag('--apply');
const isRemote = hasFlag('--remote') || (!hasFlag('--local') && isApply);

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.warn('[WARN] Could not save cache:', e.message);
  }
}

function parseHdrezkaFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
  const rawItems = [];
  let currentItem = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line === 'Дата' ||
      line === 'Название' ||
      line === 'Последняя информация' ||
      line === 'Продолжить просмотр'
    ) {
      continue;
    }
    if (dateRegex.test(line)) {
      if (currentItem) rawItems.push(currentItem);
      currentItem = { date: line, titleLine: '', extraLines: [] };
    } else if (currentItem) {
      if (!currentItem.titleLine) {
        currentItem.titleLine = line;
      } else {
        currentItem.extraLines.push(line);
      }
    }
  }
  if (currentItem) rawItems.push(currentItem);

  const parsed = [];
  for (const item of rawItems) {
    let title = '';
    let url = '';
    let year = '';

    const mdMatch = item.titleLine.match(/^\[(.*?)\]\((.*?)\)\s*(?:\((.*?)\))?$/);
    if (mdMatch) {
      title = mdMatch[1].trim();
      url = mdMatch[2].trim();
      const rawYear = mdMatch[3] || '';
      const yearMatch = rawYear.match(/\b(19\d\d|20\d\d)\b/);
      year = yearMatch ? yearMatch[1] : '';
    } else {
      const plainMatch = item.titleLine.match(/^(.*?)\s*\((.*?)\)$/);
      if (plainMatch) {
        title = plainMatch[1].trim();
        const yearMatch = plainMatch[2].match(/\b(19\d\d|20\d\d)\b/);
        year = yearMatch ? yearMatch[1] : '';
      } else {
        title = item.titleLine;
      }
    }

    // Filter out footer links and button links
    const cleanExtra = item.extraLines.filter((l) => {
      if (l.startsWith('[смотреть ещё')) return false;
      if (l.includes('HDrezka')) return false;
      if (l.includes('vk.ru')) return false;
      if (l.includes('Правообладателям')) return false;
      if (l.includes('Поддержка')) return false;
      if (
        l.includes('Фильмы') ||
        l.includes('Мультфильмы') ||
        l.includes('Сериалы') ||
        l.includes('Передачи')
      ) {
        return false;
      }
      return true;
    });

    // Parse date: DD-MM-YYYY -> ISO 8601
    const [d, m, y] = item.date.split('-');
    const isoDate = `${y}-${m}-${d}T12:00:00.000Z`;

    parsed.push({
      originalTitleLine: item.titleLine,
      title,
      url,
      year: year || null,
      extra: cleanExtra.join(' · '),
      watchedAt: isoDate,
    });
  }

  return parsed;
}

async function fetchExistingMovies(pId, remote) {
  try {
    const flag = remote ? '--remote' : '--local';
    const cmd = `npx wrangler d1 execute cinema-party ${flag} --command "SELECT id, title, year FROM movies WHERE party_id = ${pId};" --json`;
    const out = execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const json = JSON.parse(out);
    if (Array.isArray(json) && json[0]?.results) {
      return json[0].results;
    }
  } catch (err) {
    console.warn(`[WARN] Could not fetch existing movies from D1 (${remote ? 'remote' : 'local'}):`, err.message);
  }
  return [];
}

async function enrichWithTmdb(item, cache) {
  const cacheKey = `${item.title}__${item.year || ''}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const searchTitle = item.title.includes('/') ? item.title.split('/')[0].trim() : item.title;

  let poster = null;
  let tags = '#hdrezka';

  try {
    const results = await searchMovies(searchTitle);
    if (results && results.length > 0) {
      let match = results[0];
      if (item.year) {
        const exactYear = results.find((r) => r.year === item.year);
        if (exactYear) match = exactYear;
      }
      poster = match.poster || null;
      tags = match.tags ? `#hdrezka ${match.tags}`.trim() : '#hdrezka';
    }
  } catch (e) {
    // Ignore and fallback
  }

  const result = { poster, tags };
  cache[cacheKey] = result;
  return result;
}

async function main() {
  console.log('====================================================');
  console.log('       HDrezka History Import for Cinema Party      ');
  console.log('====================================================');
  console.log(`Input file: ${inputFile}`);
  console.log(`Target Party ID: ${partyId}`);
  console.log(`Target User ID:  ${userId}`);
  console.log(`Movie Kind:      ${kind}`);
  console.log(`Movie Status:    ${status}`);
  console.log(`Mode:            ${isPreview ? 'PREVIEW' : isSqlOnly ? 'SQL ONLY' : isApply ? (isRemote ? 'APPLY (REMOTE D1)' : 'APPLY (LOCAL D1)') : 'PREVIEW'}`);
  console.log('----------------------------------------------------');

  const items = parseHdrezkaFile(inputFile);
  console.log(`Parsed ${items.length} total entries from HDrezka file.`);

  // Deduplicate against existing movies in D1
  console.log(`Fetching existing movies in party #${partyId}...`);
  const existing = await fetchExistingMovies(partyId, isRemote);
  console.log(`Found ${existing.length} existing movies in party #${partyId}.`);

  const existingMap = new Set();
  for (const m of existing) {
    existingMap.add(normalizeTitle(m.title));
  }

  const uniqueToImport = [];
  const duplicates = [];

  for (const item of items) {
    const norm = normalizeTitle(item.title);
    if (existingMap.has(norm)) {
      duplicates.push(item);
    } else {
      existingMap.add(norm); // Prevent internal duplicates in the file
      uniqueToImport.push(item);
    }
  }

  console.log(`Duplicates detected: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.log(`Sample duplicates:`, duplicates.slice(0, 5).map((d) => `${d.title} (${d.year})`).join(', '));
  }
  console.log(`New movies to import: ${uniqueToImport.length}`);
  console.log('----------------------------------------------------');

  if (isPreview || (!isSqlOnly && !isApply)) {
    console.log('\n[PREVIEW MODE] Showing first 10 items to be imported:');
    for (let i = 0; i < Math.min(10, uniqueToImport.length); i++) {
      const it = uniqueToImport[i];
      const note = it.extra ? `Импорт из HDrezka · ${it.extra}` : 'Импорт из HDrezka';
      console.log(`\n#${i + 1}: ${it.title} (${it.year || 'N/A'})`);
      console.log(`   Watched at: ${it.watchedAt.slice(0, 10)}`);
      console.log(`   Note:       ${note}`);
      console.log(`   URL:        ${it.url}`);
    }
    console.log('\n----------------------------------------------------');
    console.log('To generate SQL with posters and tags:');
    console.log('  node scripts/import-hdrezka.mjs --sql-only --remote');
    console.log('\nTo apply directly to Cloudflare D1:');
    console.log('  node scripts/import-hdrezka.mjs --apply --remote');
    console.log('====================================================');
    return;
  }

  // Enrichment with concurrency
  const cache = loadCache();
  const enrichedItems = [];

  if (skipEnrich) {
    console.log('Skipping TMDB enrichment (--skip-enrich specified).');
    for (const it of uniqueToImport) {
      enrichedItems.push({ ...it, poster: null, tags: '#hdrezka' });
    }
  } else {
    console.log(`Enriching ${uniqueToImport.length} movies with TMDB posters and genres (concurrent batches of 6)...`);
    const startTime = Date.now();
    const batchSize = 6;

    for (let i = 0; i < uniqueToImport.length; i += batchSize) {
      const chunk = uniqueToImport.slice(i, i + batchSize);
      const results = await Promise.all(chunk.map((item) => enrichWithTmdb(item, cache)));

      for (let j = 0; j < chunk.length; j++) {
        enrichedItems.push({
          ...chunk[j],
          poster: results[j].poster,
          tags: results[j].tags,
        });
      }

      saveCache(cache);
      const current = Math.min(i + batchSize, uniqueToImport.length);
      const pct = Math.round((current / uniqueToImport.length) * 100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`  [${pct}%] Enriched ${current}/${uniqueToImport.length} (${elapsed}s)\r`);
      
      // Short breath between batches
      await new Promise((r) => setTimeout(r, 80));
    }
    console.log('\nEnrichment complete!');
  }

  // Generate SQL file
  const sqlStatements = [
    '-- HDrezka Import generated for Cinema Party',
    `-- Generated: ${new Date().toISOString()}`,
    `-- Party ID: ${partyId}, Added by User: ${userId}`,
    `-- Total movies: ${enrichedItems.length}`,
    '',
  ];

  for (const it of enrichedItems) {
    const note = it.extra ? `Импорт из HDrezka · ${it.extra}` : 'Импорт из HDrezka';
    const posterVal = it.poster ? escapeSql(it.poster) : 'NULL';
    const yearVal = it.year ? escapeSql(it.year) : 'NULL';

    sqlStatements.push(
      `INSERT INTO movies (party_id, added_by, kind, status, title, year, poster, note, rating, created_at, watched_at, tags) ` +
        `VALUES (${partyId}, ${userId}, ${escapeSql(kind)}, ${escapeSql(status)}, ${escapeSql(it.title)}, ${yearVal}, ${posterVal}, ${escapeSql(note)}, NULL, ${escapeSql(it.watchedAt)}, ${escapeSql(it.watchedAt)}, ${escapeSql(it.tags)});`
    );
  }

  const sqlPath = path.join(__dirname, 'import_hdrezka.sql');
  fs.writeFileSync(sqlPath, sqlStatements.join('\n'), 'utf8');
  const sizeKb = (fs.statSync(sqlPath).size / 1024).toFixed(1);
  console.log(`\nGenerated SQL file: ${sqlPath} (${sizeKb} KB)`);

  const posterCount = enrichedItems.filter((it) => it.poster).length;
  console.log(`Movies with posters: ${posterCount}/${enrichedItems.length} (${Math.round((posterCount / enrichedItems.length) * 100)}%)`);

  if (isSqlOnly) {
    console.log('SQL generated successfully. To execute:');
    console.log(`  npx wrangler d1 execute cinema-party --remote --file="${sqlPath}"`);
    return;
  }

  if (isApply) {
    const flag = isRemote ? '--remote' : '--local';
    console.log(`\nExecuting SQL import on D1 (${flag})...`);
    const cmd = `npx wrangler d1 execute cinema-party ${flag} --file="${sqlPath}"`;
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
    console.log('\n[SUCCESS] Import finished successfully!');
  }
}

main().catch((err) => {
  console.error('\n[ERROR]', err);
  process.exit(1);
});
