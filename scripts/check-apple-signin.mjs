/**
 * Проверка конфигурации «Вход через Apple» БЕЗ похода в браузер.
 *
 * Apple не даёт внятных ошибок: неверный Team ID или сломанный перенос строк в
 * .p8 выглядят одинаково — invalid_client на token endpoint. Здесь мы делаем
 * ровно то же, что делает lib/auth/oauth/flow.ts (подписываем client_secret
 * ES256-ключом), и сразу видим, где ломается.
 *
 * Режимы:
 *   node scripts/check-apple-signin.mjs
 *       — проверить APPLE_* из .env.local / .env
 *   node scripts/check-apple-signin.mjs ~/Downloads/AuthKey_ABC1234567.p8
 *       — превратить .p8 в строку для .env.local (печатает)
 *   node scripts/check-apple-signin.mjs ~/Downloads/AuthKey_ABC1234567.p8 --write
 *       — то же, но дописать прямо в .env.local (ключ не попадёт в историю терминала)
 */
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const ENV_FILES = ['.env.local', '.env'];

function readEnvFile() {
  for (const file of ENV_FILES) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) return { path, text: readFileSync(path, 'utf8') };
  }
  return null;
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  const env = readEnvFile();
  if (!env) return null;
  const line = env.text.split('\n').find((l) => l.trim().startsWith(`${name}=`));
  if (!line) return null;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
}

const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// Режим 1: .p8 → строка для .env.local
// ---------------------------------------------------------------------------
const fileArg = process.argv[2];
if (fileArg && !fileArg.startsWith('--')) {
  const path = resolve(process.cwd(), fileArg);
  if (!existsSync(path)) {
    bad(`Файл не найден: ${path}`);
    process.exit(1);
  }

  const pem = readFileSync(path, 'utf8').trim();
  try {
    crypto.createPrivateKey(pem);
  } catch (err) {
    bad(`Это не похоже на приватный ключ (.p8): ${err.message}`);
    process.exit(1);
  }

  const oneLine = pem.replace(/\r?\n/g, '\\n');
  const envLine = `APPLE_PRIVATE_KEY="${oneLine}"`;

  // Key ID Apple зашивает в имя файла: AuthKey_ABC1234567.p8
  const keyIdFromName = basename(path).match(/AuthKey_([A-Z0-9]{10})\.p8/i)?.[1];

  if (process.argv.includes('--write')) {
    const env = readEnvFile();
    const target = env?.path || resolve(process.cwd(), '.env.local');
    if (env?.text.includes('APPLE_PRIVATE_KEY=')) {
      bad(`APPLE_PRIVATE_KEY уже есть в ${target} — замените вручную, чтобы не задвоить`);
      process.exit(1);
    }
    appendFileSync(target, `\n${envLine}\n`);
    ok(`APPLE_PRIVATE_KEY дописан в ${target}`);
  } else {
    console.log('\nСтрока для .env.local (ключ секретный — не коммитить):\n');
    console.log(envLine);
    console.log('\nПодсказка: с флагом --write скрипт допишет её сам, минуя историю терминала.');
  }

  if (keyIdFromName) console.log(`\nAPPLE_KEY_ID=${keyIdFromName}   (из имени файла)`);
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------------------
// Режим 2: проверка текущей конфигурации
// ---------------------------------------------------------------------------
console.log('Проверка APPLE_* для «Вход через Apple»\n');

const clientId = envValue('APPLE_CLIENT_ID');
const teamId = envValue('APPLE_TEAM_ID');
const keyId = envValue('APPLE_KEY_ID');
const rawKey = envValue('APPLE_PRIVATE_KEY');
const siteUrl = (envValue('NEXT_PUBLIC_SITE_URL') || 'https://www.dumbospizza.de').replace(/\/$/, '');

let fatal = false;
for (const [name, value] of [
  ['APPLE_CLIENT_ID', clientId],
  ['APPLE_TEAM_ID', teamId],
  ['APPLE_KEY_ID', keyId],
  ['APPLE_PRIVATE_KEY', rawKey],
]) {
  if (!value) {
    bad(`${name} не задан`);
    fatal = true;
  }
}
if (fatal) {
  console.error('\nБез всех четырёх переменных кнопка Apple просто не появится на форме входа.');
  process.exit(1);
}

ok(`APPLE_CLIENT_ID = ${clientId}`);
if (clientId.includes('://') || clientId.endsWith('.p8')) {
  bad('APPLE_CLIENT_ID — это Services ID (напр. de.dumbospizza.web), не URL и не файл');
}

// Team ID и Key ID у Apple всегда ровно 10 символов [A-Z0-9].
if (/^[A-Z0-9]{10}$/.test(teamId)) ok(`APPLE_TEAM_ID = ${teamId}`);
else bad(`APPLE_TEAM_ID = "${teamId}" — ожидается 10 символов [A-Z0-9] (Membership details)`);

if (/^[A-Z0-9]{10}$/.test(keyId)) ok(`APPLE_KEY_ID = ${keyId}`);
else bad(`APPLE_KEY_ID = "${keyId}" — ожидается 10 символов [A-Z0-9] (из имени AuthKey_XXXXXXXXXX.p8)`);

// Ровно та же нормализация, что в lib/auth/oauth/flow.ts.
const privateKeyPem = String(rawKey).replace(/\\n/g, '\n').trim();

if (!privateKeyPem.includes('\n')) {
  bad('В APPLE_PRIVATE_KEY нет переносов строк — скорее всего потерялись \\n при вставке');
}

let privateKey;
try {
  privateKey = crypto.createPrivateKey(privateKeyPem);
  ok(`Приватный ключ разобран (${privateKey.asymmetricKeyType})`);
} catch (err) {
  bad(`Приватный ключ не парсится: ${err.message}`);
  console.error('\n  Починить: node scripts/check-apple-signin.mjs <путь к AuthKey_*.p8> --write');
  process.exit(1);
}

if (privateKey.asymmetricKeyType !== 'ec') {
  bad(`Ожидался EC-ключ (ES256), а не ${privateKey.asymmetricKeyType} — это не Apple .p8`);
}

// Главная проверка: подписываем client_secret ровно как в проде и проверяем обратно.
let clientSecret;
try {
  clientSecret = jwt.sign({}, privateKeyPem, {
    algorithm: 'ES256',
    keyid: keyId,
    issuer: teamId,
    audience: 'https://appleid.apple.com',
    subject: clientId,
    expiresIn: 60 * 60,
  });
  ok('client_secret подписан алгоритмом ES256');
} catch (err) {
  bad(`Не удалось подписать client_secret: ${err.message}`);
  process.exit(1);
}

try {
  const verified = jwt.verify(clientSecret, crypto.createPublicKey(privateKey), {
    algorithms: ['ES256'],
    audience: 'https://appleid.apple.com',
    issuer: teamId,
  });
  ok(`Подпись сходится: sub=${verified.sub}, exp через ${Math.round((verified.exp - verified.iat) / 60)} мин`);
} catch (err) {
  bad(`client_secret не проходит собственную проверку: ${err.message}`);
}

const header = JSON.parse(Buffer.from(clientSecret.split('.')[0], 'base64url').toString());
if (header.kid === keyId) ok(`kid в заголовке = ${header.kid}`);
else bad(`kid в заголовке (${header.kid}) не равен APPLE_KEY_ID (${keyId})`);

console.log('\nВ Apple Developer → Services ID должно быть прописано ТОЧНО:');
console.log(`  Domain:     ${new URL(siteUrl).host}`);
console.log(`  Return URL: ${siteUrl}/api/customer/auth/oauth/apple/callback`);

if (siteUrl.startsWith('http://') || siteUrl.includes('localhost')) {
  console.log(
    '\n⚠ Apple не принимает http и localhost — этот вход проверяется только на HTTPS-домене.'
  );
}

console.log(
  process.exitCode
    ? '\nЕсть замечания выше — Apple ответит invalid_client, пока они не устранены.'
    : '\nКонфигурация валидна. Осталось убедиться, что Return URL выше совпадает с Apple Developer.'
);
