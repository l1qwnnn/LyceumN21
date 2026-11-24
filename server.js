'use strict';

const http = require('node:http');
const { createReadStream, statSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { db, ready } = require('./db.js');
const { CLASSES, LEVELS, SOURCES, classSubjects, classGrade } = require('./data.js');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8000);
const origin = new URL(process.env.LYCEUM_ORIGIN || `http://localhost:${port}`).origin;
const secure = Boolean(process.env.VERCEL) || origin.startsWith('https:');
const day = 86_400_000;

const publicUser = 'id, phone, fullName, role, klass, created';
const token = () => randomBytes(24).toString('hex');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const phoneOf = (value) => {
  const raw = String(value ?? '').trim();
  if (!/^[+\d ().-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  if (/^380\d{9}$/.test(digits)) return '+' + digits;
  return /^0\d{9}$/.test(digits) ? '+38' + digits : '';
};
const validPassword = (value) => typeof value === 'string' && value.length >= 6 &&
  value.length <= 160 && /\p{L}/u.test(value) && /\d/.test(value);
const passwordHash = (password, salt = randomBytes(16).toString('hex')) =>
  salt + ':' + scryptSync(password, salt, 64).toString('hex');
const verifyPassword = (password, stored) => typeof password === 'string' && password.length <= 160 &&
  timingSafeEqual(Buffer.from(stored), Buffer.from(passwordHash(password, stored.split(':')[0])));
const dummyPassword = passwordHash(token());

async function initialize() {
  await ready;
  if (process.env.LYCEUM_ADMIN_PHONE && !await db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    const phone = phoneOf(process.env.LYCEUM_ADMIN_PHONE);
    const password = process.env.LYCEUM_ADMIN_PASSWORD;
    if (!phone || !validPassword(password) || password.length < 12) {
      throw new Error('Для першого запуску потрібні коректний LYCEUM_ADMIN_PHONE та LYCEUM_ADMIN_PASSWORD від 12 символів.');
    }
    await db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      token(), phone, 'Адміністратор ліцею', passwordHash(password), 'admin', '', new Date().toISOString()
    );
  }
}
const initialized = initialize();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Очікуються дані у форматі JSON.');
  }
  if (req.body !== undefined) {
    try {
      const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!data || typeof data !== 'object' || Array.isArray(data) ||
          Buffer.byteLength(JSON.stringify(data)) > 8192) throw new Error();
      return data;
    } catch {
      throw new HttpError(400, 'Неправильний формат запиту.');
    }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) {
      req.resume();
      throw new HttpError(413, 'Запит завеликий.');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'Неправильний формат запиту.');
  }
}

function sessionToken(req) {
  return /(?:^|;\s*)lyceum_session=([a-f\d]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}

async function sessionUser(req) {
  const value = sessionToken(req);
  if (!value) return null;
  return await db.prepare(`SELECT u.id, u.phone, u.fullName, u.role, u.klass, u.created FROM users u
    JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires > ?`).get(digest(value), Date.now()) || null;
}

function cookie(res, value, seconds) {
  res.setHeader('Set-Cookie', `lyceum_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
}

async function signIn(req, res, user) {
  const old = sessionToken(req);
  if (old) await db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(old));
  const value = token();
  const lifetime = user.role === 'admin' ? day : 7 * day;
  await db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  await db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(value), user.id, Date.now() + lifetime);
  cookie(res, value, lifetime / 1000);
}

function access(user, role) {
  if (!user) throw new HttpError(401, 'Увійдіть до профілю.');
  if (role && user.role !== role) throw new HttpError(403, 'У вас немає доступу до цієї дії.');
}

const attempts = new Map();
const windowMs = 15 * 60_000;
function throttle(key, limit) {
  const now = Date.now();
  for (const [entry, record] of attempts) {
    if (record.until <= now) attempts.delete(entry);
  }
  const record = attempts.get(key) || { count: 0, until: now + windowMs };
  if (record.count >= limit) throw new HttpError(429, 'Забагато спроб. Повторіть пізніше.');
  record.count++;
  attempts.set(key, record);
}

async function register(body) {
  const phone = phoneOf(body.phone);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
  const teacher = body.role === 'teacher';
  const klass = teacher ? '' : body.klass;
  if (!phone) throw new HttpError(400, 'Вкажіть український номер телефону.');
  if (fullName.length < 5 || fullName.length > 120 || fullName.split(' ').length < 2) {
    throw new HttpError(400, 'Вкажіть прізвище та ім’я.');
  }
  if (!validPassword(body.password)) throw new HttpError(400, 'Пароль має містити від 6 до 160 символів, літери й цифри.');
  if (!teacher && !CLASSES.includes(klass)) throw new HttpError(400, 'Оберіть свій клас.');
  const code = String(body.code ?? '').trim().toUpperCase();
  if (teacher && !/^[A-F0-9]{24}$/.test(code)) throw new HttpError(400, 'Вкажіть код, який видала адміністрація.');
  const password = passwordHash(body.password);
  const id = token();

  await db.transaction(async () => {
    if (await db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Цей номер уже зареєстровано.');
    if (teacher && !(await db.prepare('DELETE FROM invites WHERE code = ? AND phone = ? AND expires > ?')
      .run(digest(code), phone, Date.now())).changes) {
      throw new HttpError(403, 'Код недійсний, прострочений або виданий на інший номер.');
    }
    await db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, phone, fullName, password, teacher ? 'teacher' : 'pupil', klass, new Date().toISOString()
    );
  });
  return await db.prepare(`SELECT ${publicUser} FROM users WHERE id = ?`).get(id);
}

let newsCache;
let newsPending;
async function officialNews() {
  if (newsCache?.expires > Date.now()) return newsCache.posts;
  if (!newsPending) {
    newsPending = (async () => {
      try {
        const response = await fetch(SOURCES.newsApi, { signal: AbortSignal.timeout(4500) });
        if (!response.ok) throw new Error('News feed unavailable');
        const posts = await response.json();
        if (!Array.isArray(posts)) throw new Error('Unexpected news feed format');
        newsCache = { posts, expires: Date.now() + 30 * 60_000 };
        return posts;
      } catch {
        const posts = newsCache?.posts || [];
        newsCache = { posts, expires: Date.now() + 60_000 };
        return posts;
      } finally {
        newsPending = null;
      }
    })();
  }
  return newsPending;
}

function checkedSubject(klass, subject) {
  if (!CLASSES.includes(klass) || !classSubjects(klass).includes(subject)) {
    throw new HttpError(400, 'Оберіть клас і предмет із переліку.');
  }
}

function checkedMark(klass, body) {
  const grade = classGrade(klass);
  const level = typeof body.level === 'string' ? body.level : '';
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (comment.length > 500) throw new HttpError(400, 'Відгук має містити до 500 символів.');
  if (grade >= 5) {
    if (!Number.isInteger(body.score) || body.score < 1 || body.score > 12) {
      throw new HttpError(400, 'Бал має бути цілим числом від 1 до 12.');
    }
    return { score: body.score, comment };
  }
  if ((level && (grade < 3 || !Object.hasOwn(LEVELS, level))) || (!level && !comment)) {
    throw new HttpError(400, 'Вкажіть відгук або рівень відповідно до класу.');
  }
  return { level, comment };
}

function marksFor(rows) {
  return rows.map(({ value, ...mark }) => ({ ...mark, ...JSON.parse(value) }));
}

async function journalMark(id) {
  const row = await db.prepare('SELECT id, pupil_id AS pupilId, value, created, 1 AS editable FROM marks WHERE id = ?').get(id);
  return marksFor([row])[0];
}

async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  await initialized;
  const user = await sessionUser(req);
  if (req.method !== 'GET') {
    const requestOrigin = req.headers.origin;
    const allowedOrigin = process.env.VERCEL
      ? `https://${req.headers.host}`
      : origin;
    const localTest = !secure && requestOrigin === `http://127.0.0.1:${port}`;
    if ((requestOrigin && requestOrigin !== allowedOrigin && !localTest) || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'Запит з іншого сайту відхилено.');
    }
  }

  if (route === 'GET /api/news') return send(res, 200, { posts: await officialNews() });
  if (route === 'GET /api/session') return send(res, 200, { user });
  if (route === 'POST /api/register' || route === 'POST /api/login') {
    if (user) throw new HttpError(409, 'Спочатку вийдіть з поточного профілю.');
    throttle(req.socket.remoteAddress + route, 50);
    const body = await readJson(req);
    const registration = route.endsWith('register');
    const phone = phoneOf(body.phone);
    if (!registration && !phone) throw new HttpError(400, 'Вкажіть український номер телефону.');
    if (!registration) throttle('login:' + phone, 10);
    let account = registration ? await register(body) : await db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    if (!registration) {
      if (!verifyPassword(body.password, account?.password || dummyPassword) || !account) {
        throw new HttpError(401, 'Перевірте номер телефону та пароль.');
      }
      attempts.delete('login:' + phone);
      delete account.password;
    }
    await signIn(req, res, account);
    return send(res, registration ? 201 : 200, { user: account });
  }
  if (route === 'POST /api/logout') {
    await readJson(req);
    const value = sessionToken(req);
    if (value) await db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(value));
    cookie(res, '', 0);
    return send(res, 200, {});
  }

  access(user);
  if (route === 'POST /api/password') {
    throttle('password:' + user.id, 12);
    const { oldPassword, password } = await readJson(req);
    const stored = (await db.prepare('SELECT password FROM users WHERE id = ?').get(user.id)).password;
    if (!verifyPassword(oldPassword, stored)) throw new HttpError(403, 'Поточний пароль неправильний.');
    if (!validPassword(password) || (user.role === 'admin' && password.length < 12)) {
      throw new HttpError(400, 'Новий пароль має містити літери та цифри й бути достатньої довжини.');
    }
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash(password), user.id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    await signIn(req, res, user);
    return send(res, 200, {});
  }
  if (route === 'DELETE /api/account') {
    if (user.role === 'admin') throw new HttpError(403, 'Обліковий запис адміністратора захищений.');
    throttle('password:' + user.id, 12);
    const { password } = await readJson(req);
    const stored = (await db.prepare('SELECT password FROM users WHERE id = ?').get(user.id)).password;
    if (!verifyPassword(password, stored)) throw new HttpError(403, 'Пароль неправильний.');
    await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    cookie(res, '', 0);
    return send(res, 200, {});
  }
  if (route === 'POST /api/admin/invite') {
    access(user, 'admin');
    const phone = phoneOf((await readJson(req)).phone);
    if (!phone) throw new HttpError(400, 'Вкажіть номер телефону вчителя.');
    if (await db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Цей номер уже зареєстровано.');
    const code = randomBytes(12).toString('hex').toUpperCase();
    const expires = Date.now() + day;
    await db.prepare('DELETE FROM invites WHERE phone = ? OR expires <= ?').run(phone, Date.now());
    await db.prepare('INSERT INTO invites VALUES (?, ?, ?)').run(digest(code), phone, expires);
    return send(res, 201, { code, expires: new Date(expires).toISOString() });
  }
  if (route === 'POST /api/admin/class') {
    access(user, 'admin');
    const body = await readJson(req);
    const phone = phoneOf(body.phone);
    if (!phone || !CLASSES.includes(body.klass)) throw new HttpError(400, 'Вкажіть номер телефону учня та новий клас.');
    const updated = await db.prepare("UPDATE users SET klass = ? WHERE phone = ? AND role = 'pupil' RETURNING fullName, klass")
      .get(body.klass, phone);
    if (!updated) throw new HttpError(404, 'Учня з таким номером не знайдено.');
    return send(res, 200, { user: updated });
  }
  if (route === 'GET /api/diary') {
    access(user, 'pupil');
    const rows = await db.prepare('SELECT id, klass, subject, value, created FROM marks WHERE pupil_id = ? ORDER BY id DESC').all(user.id);
    const homework = await db.prepare(`SELECT h.id, h.subject, h.text, h.due, d.task_id IS NOT NULL AS done
      FROM homework h LEFT JOIN homework_done d ON h.id = d.task_id AND d.pupil_id = ?
      WHERE h.klass = ? ORDER BY h.due DESC, h.id DESC`).all(user.id, user.klass);
    return send(res, 200, { marks: marksFor(rows), homework });
  }
  if (route === 'GET /api/journal') {
    access(user, 'teacher');
    const klass = url.searchParams.get('klass');
    const subject = url.searchParams.get('subject');
    checkedSubject(klass, subject);
    const pupils = await db.prepare("SELECT id, fullName FROM users WHERE klass = ? AND role = 'pupil'").all(klass);
    const marks = await db.prepare(`SELECT m.id, m.pupil_id AS pupilId, m.value, m.created, m.teacher_id = ? AS editable
      FROM marks m JOIN users u ON u.id = m.pupil_id WHERE m.klass = ? AND m.subject = ? AND u.klass = ? ORDER BY m.id DESC`)
      .all(user.id, klass, subject, klass);
    const homework = await db.prepare(`SELECT id, subject, text, due, teacher_id = ? AS editable
      FROM homework WHERE klass = ? AND subject = ? ORDER BY due DESC, id DESC`).all(user.id, klass, subject);
    return send(res, 200, { pupils, marks: marksFor(marks), homework });
  }
  if (route === 'POST /api/mark' || route === 'PATCH /api/mark') {
    access(user, 'teacher');
    const body = await readJson(req);
    const { klass, subject, pupilId } = body;
    checkedSubject(klass, subject);
    const pupil = typeof pupilId === 'string' && await db.prepare("SELECT 1 FROM users WHERE id = ? AND klass = ? AND role = 'pupil'").get(pupilId, klass);
    if (!pupil) throw new HttpError(404, 'Учень більше не належить до цього класу.');
    const value = JSON.stringify(checkedMark(klass, body));
    if (req.method === 'PATCH') {
      if (!Number.isSafeInteger(body.id) || !(await db.prepare(`UPDATE marks SET value = ?
        WHERE id = ? AND teacher_id = ? AND klass = ? AND subject = ? AND pupil_id = ?`)
        .run(value, body.id, user.id, klass, subject, pupilId)).changes) throw new HttpError(404, 'Вашу оцінку не знайдено.');
      return send(res, 200, { mark: await journalMark(body.id) });
    }
    const inserted = await db.prepare('INSERT INTO marks (pupil_id, teacher_id, klass, subject, value, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(pupilId, user.id, klass, subject, value, new Date().toISOString());
    return send(res, 201, { mark: await journalMark(inserted.lastInsertRowid) });
  }
  if (route === 'DELETE /api/mark') {
    access(user, 'teacher');
    const { id, klass, subject } = await readJson(req);
    checkedSubject(klass, subject);
    if (!Number.isSafeInteger(id) || !(await db.prepare(`DELETE FROM marks WHERE id = ? AND teacher_id = ? AND klass = ? AND subject = ?
      AND pupil_id IN (SELECT id FROM users WHERE klass = ?)`).run(id, user.id, klass, subject, klass)).changes) {
      throw new HttpError(404, 'Вашу оцінку не знайдено.');
    }
    return send(res, 200, {});
  }
  if (route === 'POST /api/homework' || route === 'DELETE /api/homework') {
    access(user, 'teacher');
    const body = await readJson(req);
    const { id, klass, subject, due } = body;
    checkedSubject(klass, subject);
    if (req.method === 'DELETE') {
      if (!Number.isSafeInteger(id) || !(await db.prepare('DELETE FROM homework WHERE id = ? AND teacher_id = ? AND klass = ? AND subject = ?')
        .run(id, user.id, klass, subject)).changes) throw new HttpError(404, 'Ваше завдання не знайдено.');
      return send(res, 200, {});
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const date = typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(due) : new Date(NaN);
    if (!text || text.length > 500 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== due) {
      throw new HttpError(400, 'Вкажіть завдання та дійсну дату.');
    }
    await db.prepare('INSERT INTO homework (teacher_id, klass, subject, text, due) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, klass, subject, text, due);
    return send(res, 201, {});
  }
  if (route === 'POST /api/homework/done') {
    access(user, 'pupil');
    const { id, done } = await readJson(req);
    if (!Number.isSafeInteger(id) || typeof done !== 'boolean' ||
      !await db.prepare('SELECT 1 FROM homework WHERE id = ? AND klass = ?').get(id, user.klass)) {
      throw new HttpError(404, 'Завдання для вашого класу не знайдено.');
    }
    if (done) await db.prepare('INSERT OR IGNORE INTO homework_done VALUES (?, ?)').run(id, user.id);
    else await db.prepare('DELETE FROM homework_done WHERE task_id = ? AND pupil_id = ?').run(id, user.id);
    return send(res, 200, {});
  }
  throw new HttpError(404, 'Сторінку не знайдено.');
}

const types = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8', webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml', jpg: 'image/jpeg', mp4: 'video/mp4'
};
const files = new Set([
  'index.html', '404.html', 'style.css', 'data.js', 'app.js', 'sw.js', 'manifest.webmanifest',
  'assets/icon.svg', 'assets/preview.svg', 'assets/logo.jpg',
  'assets/photos/liceum-facade.jpg', 'assets/photos/liceum-entrance.jpg', 'assets/background.mp4'
]);

function staticFile(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Метод не підтримується.' });
  let name = url.pathname.slice(1) || 'index.html';
  let status = 200;
  if (!files.has(name)) { name = '404.html'; status = 404; }
  const path = resolve(__dirname, name);
  let size;
  try { size = statSync(path).size; } catch { return send(res, 404, { error: 'Файл не знайдено.' }); }
  const headers = { 'Content-Type': types[name.split('.').pop()], 'Content-Length': size, 'Cache-Control': 'no-cache' };
  let range;
  if (name.endsWith('.mp4')) {
    headers['Accept-Ranges'] = 'bytes';
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (!match || !(start >= 0 && start <= end && end < size)) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
        return;
      }
      range = { start, end };
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = end - start + 1;
      status = 206;
    }
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(path, range);
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(req, res, url);
  } catch (error) {
    if (!(error instanceof HttpError)) console.error(error);
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Помилка сервера. Спробуйте ще раз.' });
    else res.destroy();
  }
}
if (require.main === module) http.createServer(handler).listen(port, host, () => console.log(`Lyceum N21 · http://${host}:${port}`));
module.exports = handler;
