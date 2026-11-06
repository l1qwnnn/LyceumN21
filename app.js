'use strict';
/* ============================================================
   Lyceum N21, логіка порталу.
   Дані порталу лежать у data.js, оцінки, профілі, тема та
   відмітки домашніх завдань зберігаються в цьому браузері.
   ============================================================ */

var LS_USERS = 'lyceum21_users';
var LS_SESSION = 'lyceum21_session';
var LS_MARKS = 'lyceum21_marks';
var LS_HOMEWORK = 'lyceum21_homework';
var LS_THEME = 'lyceum21_theme';

/* Стан інтерфейсу: фільтри, пошук, вибрані класи та день меню */
var navFilter = 'all';
var navQuery = '';
var teacherFilter = 'all';
var teacherQuery = '';
var scheduleClass = '';
var diningDay = 0;
var panelKlass = '7-В';
var panelSubject = 'Українська мова';
var panelQuery = '';
var panelOpenPupil = '';
var authMode = 'login';
var teacherAccess = false;
var notice = null;
var noticeKind = 'success';
var currentRoute = 'home';

/* ---------- базові допоміжні функції ---------- */
function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value === null || value === undefined ? '' : String(value)); } catch (e) { /* сховище недоступне */ }
}
function lsDel(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* сховище недоступне */ }
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ic(name, cls) {
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

function hash32(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function rng(seed) {
  var s = (seed || 1) >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function initials(fullName) {
  var parts = String(fullName || '').trim().split(/\s+/);
  return (parts[0] || '?').slice(0, 1).toUpperCase() + (parts[1] ? parts[1].slice(0, 1).toUpperCase() : '');
}

/* «Гаврилюк Оксана Степанівна» у «Гаврилюк О. С.» */
function shortTeacher(name) {
  var parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return name;
  return parts[0] + ' ' + parts[1].slice(0, 1) + '.' + (parts[2] ? ' ' + parts[2].slice(0, 1) + '.' : '');
}

function telHref(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

/* +380674123071 у +380 67 412-30-71 */
function fmtPhone(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.indexOf('380') === 0) d = d.slice(3);
  if (d.length !== 9) return String(raw || '');
  return '+380 ' + d.slice(0, 2) + ' ' + d.slice(2, 5) + '-' + d.slice(5, 7) + '-' + d.slice(7, 9);
}

function plural(n, forms) {
  var mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function toMinutes(hhmm) {
  var p = String(hhmm).split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function nowMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function todayLabel(date) {
  var wd = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п’ятниця', 'субота'];
  var mo = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  return wd[date.getDay()] + ', ' + date.getDate() + ' ' + mo[date.getMonth()] + ' ' + date.getFullYear();
}

/* ---------- класи, предмети, тижневий план ---------- */
function classGrade(klass) {
  return parseInt(String(klass || ''), 10) || 0;
}

function normClass(value) {
  var raw = String(value || '').trim().toUpperCase();
  for (var i = 0; i < CLASSES.length; i++) {
    if (CLASSES[i] === raw) return CLASSES[i];
  }
  return '';
}

function subjectOf(name) {
  for (var i = 0; i < SUBJECTS.length; i++) {
    if (SUBJECTS[i].name === name) return SUBJECTS[i];
  }
  return null;
}

function classSubjects(klass) {
  var names = GRADE_POOLS[classGrade(klass)] || [];
  var out = [];
  for (var i = 0; i < names.length; i++) {
    var s = subjectOf(names[i]);
    if (s) out.push(s);
  }
  return out;
}

/* 5 і 6 класи мають шість уроків, з 7 класу сім уроків щодня */
function lessonsPerDay(grade) {
  return grade >= 7 ? 7 : 6;
}

function buildWeek(klass) {
  var grade = classGrade(klass);
  var per = lessonsPerDay(grade);
  var pool = classSubjects(klass);
  if (!pool.length) return DAYS.map(function () { return []; });
  var flat = [];
  var need = per * DAYS.length;
  for (var i = 0; i < need; i++) flat.push(pool[i % pool.length]);
  var r = rng(hash32('week|' + klass));
  for (var j = flat.length - 1; j > 0; j--) {
    var k = Math.floor(r() * (j + 1));
    var tmp = flat[j]; flat[j] = flat[k]; flat[k] = tmp;
  }
  var out = [];
  for (var d = 0; d < DAYS.length; d++) {
    var day = flat.slice(d * per, d * per + per);
    day.sort(function (a, b) { return pool.indexOf(a) - pool.indexOf(b); });
    out.push(day);
  }
  return out;
}

function curatorFor(klass) {
  var names = [];
  classSubjects(klass).forEach(function (s) {
    if (names.indexOf(s.teacher) < 0) names.push(s.teacher);
  });
  if (!names.length) {
    var t = TEACHERS.filter(function (x) { return x.role === 'вчитель'; })[0];
    return t || TEACHERS[0];
  }
  var picked = names[hash32('curator|' + klass) % names.length];
  for (var i = 0; i < TEACHERS.length; i++) {
    if (TEACHERS[i].name === picked) return TEACHERS[i];
  }
  return TEACHERS[6];
}

function pupilsOfClass(klass) {
  var list = PUPILS.filter(function (p) { return p.klass === klass; });
  loadUsers().forEach(function (u) {
    if (u.role !== 'pupil' || u.klass !== klass) return;
    if (!list.some(function (p) { return p.name === u.fullName; })) {
      list.push({ name: u.fullName, klass: klass });
    }
  });
  return list;
}

/* ---------- профілі користувачів ---------- */
function loadUsers() {
  try {
    var arr = JSON.parse(lsGet(LS_USERS) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveUsers(users) {
  lsSet(LS_USERS, JSON.stringify(users));
}

function updateUser(id, patch) {
  saveUsers(loadUsers().map(function (u) {
    if (u.id === id) {
      for (var key in patch) if (Object.prototype.hasOwnProperty.call(patch, key)) u[key] = patch[key];
    }
    return u;
  }));
}

function currentUser() {
  var id = lsGet(LS_SESSION);
  if (!id) return null;
  var list = loadUsers().filter(function (u) { return u.id === id; });
  return list.length ? list[0] : null;
}

function passHash(phone, pass) {
  return hash32('a|' + phone + '|' + pass).toString(36) + hash32('b|' + pass + '|' + phone).toString(36);
}

/* ---------- оцінки ----------
   Бали вносить лише вчитель у панелі, вони лежать у сховищі браузера. */
function marksKey(klass, name, subject) {
  return klass + '|' + name + '|' + subject;
}

function loadMarks() {
  try {
    var obj = JSON.parse(lsGet(LS_MARKS) || 'null');
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) { return null; }
}

function saveMarks(map) {
  lsSet(LS_MARKS, JSON.stringify(map));
}

function getMarkEntry(klass, name, subject) {
  var map = loadMarks();
  var entry = map && map[marksKey(klass, name, subject)];
  return entry && Array.isArray(entry.list) ? entry : { list: [], updated: '' };
}

function setMarkEntry(klass, name, subject, list) {
  var map = loadMarks() || {};
  var clean = [];
  for (var i = 0; i < list.length; i++) {
    var v = Number(list[i]);
    if (v >= SCALE_MIN && v <= SCALE_MAX) clean.push(v);
  }
  map[marksKey(klass, name, subject)] = {
    list: clean,
    updated: new Date().toLocaleString('uk-UA')
  };
  saveMarks(map);
}

function clearPupilMarks(klass, name) {
  var map = loadMarks() || {};
  Object.keys(map).forEach(function (key) {
    var parts = key.split('|');
    if (parts[0] === klass && parts[1] === name) delete map[key];
  });
  saveMarks(map);
}

function markClass(value) {
  var v = Number(value);
  if (v <= 4) return 'mark-low';
  if (v <= 8) return 'mark-mid';
  return 'mark-top';
}

function markTone(value) {
  var raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '';
  var v = Number(raw);
  if (!isFinite(v) || v < SCALE_MIN || v > SCALE_MAX) return '';
  return v <= 4 ? 'low' : v <= 8 ? 'mid' : 'top';
}

function markHtml(value, extra) {
  var v = Number(value);
  if (!v) return '<span class="mark mark-empty">' + esc(String(value || '–')) + '</span>';
  return '<span class="mark ' + markClass(v) + (extra ? ' ' + extra : '') + '">' + v + '</span>';
}

function avgOf(list) {
  if (!list.length) return 0;
  var sum = 0;
  for (var i = 0; i < list.length; i++) sum += Number(list[i]);
  return sum / list.length;
}

/* Рядки щоденника: предмет, вчитель, поточні бали, середній */
function pupilRows(klass, name) {
  var rows = classSubjects(klass).map(function (s) {
    var entry = getMarkEntry(klass, name, s.name);
    return {
      name: s.name,
      teacher: s.teacher,
      room: s.room,
      icon: s.icon,
      list: entry.list,
      updated: entry.updated,
      average: avgOf(entry.list)
    };
  });
  return rows;
}

function diarySummary(rows) {
  var filled = rows.filter(function (r) { return r.list.length > 0; });
  var total = 0;
  var best = null;
  var marks = 0;
  filled.forEach(function (r) {
    total += r.average;
    marks += r.list.length;
    if (!best || r.average > best.average) best = r;
  });
  return {
    rows: rows,
    filled: filled.length,
    average: filled.length ? total / filled.length : 0,
    best: best,
    marks: marks
  };
}

function levelWord(average) {
  if (average >= 10.5) return 'достатній та високий рівень';
  if (average >= 7.5) return 'середній рівень';
  if (average > 0) return 'початковий рівень';
  return 'оцінок ще немає';
}

/* ---------- домашні завдання ----------
   Перелік будується з навчального плану класу, відмітки виконання
   зберігаються окремо для кожного профілю. */
function homeworkFor(user) {
  var klass = user.klass;
  if (!klass) return [];
  var pool = classSubjects(klass);
  var r = rng(hash32('hw|' + klass));
  var start = Math.floor(r() * pool.length);
  var tasks = [
    'опрацювати §{n}, скласти план відповіді',
    'виконати вправу {n} та виписати правила',
    'підготувати картку для повторення теми {n}',
    'робота на платформі ' + SCHOOL.platform + ', завдання {n}',
    'проєкт у парі, презентація до теми {n}'
  ];
  var out = [];
  var count = Math.min(5, pool.length);
  for (var i = 0; i < count; i++) {
    var s = pool[(start + i) % pool.length];
    var n = 5 + Math.floor(r() * 24);
    out.push({
      id: user.id + '|' + klass + '|' + s.name,
      subject: s.name,
      icon: s.icon,
      text: tasks[Math.floor(r() * tasks.length)].replace('{n}', n),
      due: BELL[3].end
    });
  }
  return out;
}

function loadHomeworkDone() {
  try {
    var obj = JSON.parse(lsGet(LS_HOMEWORK) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) { return {}; }
}

function toggleHomework(id, done) {
  var map = loadHomeworkDone();
  if (done) map[id] = true; else delete map[id];
  lsSet(LS_HOMEWORK, JSON.stringify(map));
}

/* ---------- тема оформлення ---------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  lsSet(LS_THEME, theme);
  var icon = document.getElementById('themeIcon');
  if (icon) icon.setAttribute('href', theme === 'light' ? '#i-moon' : '#i-sun');
  var button = document.getElementById('themeToggle');
  if (button) button.setAttribute('aria-label', theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему');
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  Array.prototype.forEach.call(metas, function (m) {
    var light = String(m.getAttribute('media') || '').indexOf('light') > -1;
    m.setAttribute('content', light ? '#f4f6f9' : '#050505');
  });
}

function toggleTheme() {
  applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
}

/* ---------- навігація ---------- */
var NAV_ITEMS = [
  { r: 'home', label: 'Головна' },
  { r: 'students', label: 'Учням' },
  { r: 'diary', label: 'Щоденник' },
  { r: 'teachers', label: 'Вчителі' },
  { r: 'schedule', label: 'Розклад' },
  { r: 'news', label: 'Новини' },
  { r: 'gallery', label: 'Вигляд ліцею' },
  { r: 'contacts', label: 'Контакти' }
];

var DRAWER_MAIN = [
  { r: 'home', label: 'Головна', icon: 'cap' },
  { r: 'history', label: 'Історія ліцею', icon: 'book' },
  { r: 'students', label: 'Учням', icon: 'users' },
  { r: 'teachers', label: 'Вчителі', icon: 'briefcase' },
  { r: 'schedule', label: 'Розклад дзвінків', icon: 'clock' },
  { r: 'news', label: 'Новини та події', icon: 'news' },
  { r: 'gallery', label: 'Вигляд ліцею', icon: 'palette' },
  { r: 'dining', label: 'Їдальня', icon: 'bowl' },
  { r: 'admissions', label: 'Зарахування', icon: 'door' },
  { r: 'contacts', label: 'Контакти', icon: 'pin' }
];

function drawerItems() {
  var user = currentUser();
  var out = [];
  if (user) {
    out.push({ r: 'diary', label: 'Щоденник', icon: 'star' });
    out.push({ r: 'profile', label: 'Профіль', icon: 'gear' });
    if (user.role === 'teacher') out.push({ r: 'teacher', label: 'Панель вчителя', icon: 'pen' });
  } else {
    out.push({ r: 'diary', label: 'Щоденник', icon: 'star' });
    out.push({ r: 'auth', label: 'Вхід і реєстрація', icon: 'login' });
  }
  return out;
}

function renderNav() {
  var user = currentUser();
  var links = NAV_ITEMS.map(function (item) {
    return '<a class="nav-link' + (currentRoute === item.r ? ' active' : '') + '" href="#/' + item.r + '">' + esc(item.label) + '</a>';
  }).join('');
  document.getElementById('navLinks').innerHTML = links;

  var userBox = document.getElementById('navUser');
  if (user) {
    userBox.innerHTML =
      '<a class="btn-nav-profile" href="#/profile"><span class="role-badge ' + (user.role === 'teacher' ? 'role-teacher' : 'role-curator') + '">' +
      (user.role === 'teacher' ? 'Вчитель' : 'Учень') + '</span><span class="nav-username">' + esc(shortTeacher(user.fullName)) + '</span></a>' +
      '<button class="btn-logout" type="button" data-action="logout">Вийти</button>';
  } else {
    userBox.innerHTML = '<a class="btn-nav-auth" href="#/auth">' + ic('login', 'ic-sm') + '<span>Увійти</span></a>';
  }

  var groups = '<p class="nav-drawer-head">Розділи порталу</p>' +
    DRAWER_MAIN.map(function (item) {
      return '<a class="nav-link' + (currentRoute === item.r ? ' active' : '') + '" href="#/' + item.r + '">' +
        ic(item.icon, 'ic-sm') + '<span>' + esc(item.label) + '</span></a>';
    }).join('') +
    '<p class="nav-drawer-head">Особистий кабінет</p>' +
    drawerItems().map(function (item) {
      return '<a class="nav-link' + (currentRoute === item.r ? ' active' : '') + '" href="#/' + item.r + '">' +
        ic(item.icon, 'ic-sm') + '<span>' + esc(item.label) + '</span></a>';
    }).join('');
  document.getElementById('navDrawer').innerHTML = groups;
}

function isDrawerOpen() {
  return document.body.classList.contains('nav-open');
}

function setDrawer(open) {
  document.body.classList.toggle('nav-open', !!open);
  var burger = document.getElementById('navBurger');
  if (burger) {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    var icon = burger.querySelector('use');
    if (icon) icon.setAttribute('href', open ? '#i-close' : '#i-menu');
  }
}

/* ---------- маршрутизація ---------- */
var PAGES = {};
var TITLES = {
  home: 'Головна', history: 'Історія ліцею', students: 'Учням', teachers: 'Вчителі',
  schedule: 'Розклад', news: 'Новини та події', dining: 'Їдальня', admissions: 'Зарахування',
  gallery: 'Вигляд ліцею', contacts: 'Контакти', auth: 'Вхід і реєстрація', profile: 'Профіль', diary: 'Щоденник',
  teacher: 'Панель вчителя', notfound: 'Сторінку не знайдено'
};

function parseHash() {
  var h = String(location.hash || '');
  if (!h || h === '#' || h === '#/') return { route: 'home', anchor: '' };
  if (h.charAt(0) !== '#' || h.charAt(1) !== '/') return { keep: true, anchor: h.slice(1) };
  var parts = h.slice(2).split(':');
  return { route: parts[0] || 'home', anchor: parts[1] || '' };
}

function scrollToAnchor(id) {
  var target = document.getElementById(id);
  if (!target) return;
  if (id === 'main') {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  var top = target.getBoundingClientRect().top + window.pageYOffset - 96;
  window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'smooth' });
}

function flashHtml() {
  if (!notice) return '';
  return '<div class="flash ' + esc(noticeKind) + '" role="status">' + esc(notice) + '</div>';
}

function breadcrumbHtml(route) {
  var label = TITLES[route] || 'Сторінка';
  if (route === 'home') return '';
  return '<nav class="breadcrumbs" aria-label="Шлях сторінки">' +
    '<a href="#/home">Головна</a><span aria-hidden="true">/</span><span>' + esc(label) + '</span></nav>';
}

function render() {
  var state = parseHash();
  if (state.keep) {
    scrollToAnchor(state.anchor);
    return;
  }
  var route = PAGES[state.route] ? state.route : 'notfound';
  if (route === 'auth' && currentRoute !== 'auth') {
    authMode = 'login';
    teacherAccess = false;
  }
  if (route === 'teachers' && state.anchor === 'admin') teacherFilter = 'admin';
  currentRoute = route;
  document.getElementById('app').innerHTML = PAGES[route]();
  renderNav();
  setDrawer(false);
  stopTicker();
  stopNow();
  if (route === 'home') {
    startTicker();
    startNow();
    bindSearch('navSearch');
  }
  if (route === 'teachers') bindSearch('teacherSearch');
  if (route === 'schedule' || route === 'diary') startNow();
  if (route === 'auth') { bindAuth(); moveAuthThumb(); }
  if (route === 'profile') bindPasswordForm();
  if (route === 'teacher') { bindPanelSearch(); }
  notice = null;
  if (state.anchor) {
    setTimeout(function () { scrollToAnchor(state.anchor); }, 60);
  } else {
    window.scrollTo(0, 0);
  }
  document.title = (TITLES[route] ? TITLES[route] + ' · ' : '') + 'Lyceum N21';
}

/* ---------- бігучий рядок новин ---------- */
var tickerTimer = null;

function reviewCardHtml(item) {
  return '<div class="review-card"><div class="review-top"><span class="review-nick">' +
    ic('news', 'ic-sm') + '<b>' + esc(item.title) + '</b></span>' +
    '<span class="review-date">' + esc(item.date) + '</span></div>' +
    '<p class="review-text">' + esc(item.text) + '</p></div>';
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function startTicker() {
  var track = document.getElementById('newsTrack');
  if (!track) return;
  var html = NEWS.map(reviewCardHtml).join('');
  track.innerHTML = reducedMotion() ? html : html + html;
  track.style.setProperty('--card-w', '320px');
  if (reducedMotion()) return;
  var total = NEWS.length * 334;
  var pos = 0;
  tickerTimer = setInterval(function () {
    pos += 0.5;
    if (pos >= total) pos -= total;
    track.style.transform = 'translateX(' + (-pos) + 'px)';
  }, 16);
}

function stopTicker() {
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
}

/* ---------- поточний урок і зворотний відлік ---------- */
var nowTimer = null;

function fmtMins(total) {
  if (total >= 60) {
    var h = Math.floor(total / 60);
    var m = total % 60;
    return h + ' ' + plural(h, ['година', 'години', 'годин']) + (m ? ' ' + m + ' ' + plural(m, ['хвилина', 'хвилини', 'хвилин']) : '');
  }
  return total + ' ' + plural(total, ['хвилина', 'хвилини', 'хвилин']);
}

function nowInfo(date) {
  var res = {
    clock: pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds()),
    state: '', note: '', lesson: 0, next: 0
  };
  var day = date.getDay();
  if (day === 0 || day === 6) {
    res.state = 'Сьогодні вихідний';
    res.note = 'Ліцей працює з понеділка по п’ятницю, гуртки не збираються';
    return res;
  }
  var m = nowMinutes(date);
  for (var i = 0; i < BELL.length; i++) {
    var lesson = BELL[i];
    var start = toMinutes(lesson.start);
    var end = toMinutes(lesson.end);
    if (m < start) {
      res.next = lesson.n;
      res.mins = start - m;
      res.state = i === 0 ? 'До першого дзвінка' : 'Перерва';
      res.note = i === 0
        ? 'Уроки почнуться о ' + lesson.start
        : lesson.n + '-й урок почнеться через ' + fmtMins(start - m) + ', о ' + lesson.start;
      return res;
    }
    if (m <= end) {
      res.lesson = lesson.n;
      res.state = lesson.n + '-й урок іде';
      res.note = 'До дзвінка ' + fmtMins(end - m);
      return res;
    }
  }
  res.state = 'Уроки закінчились';
  res.note = 'Гуртки та секції починаються о 15:00, приймальня працює до 18:00';
  return res;
}

function updateNow() {
  var info = nowInfo(new Date());
  var state = document.getElementById('nowState');
  var clock = document.getElementById('nowClock');
  if (state) state.innerHTML = ic('bell', 'ic-sm') + '<span>' + esc(info.state) + '</span>';
  if (clock) {
    clock.innerHTML = '<span>' + esc(info.note) + '</span><span>' + esc(info.clock) + '</span>';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-lesson]'), function (row) {
    var n = Number(row.getAttribute('data-lesson'));
    row.classList.toggle('current', n === info.lesson);
    row.classList.toggle('on', n === info.lesson || n === info.next);
  });
}

function startNow() {
  updateNow();
  nowTimer = setInterval(updateNow, 1000);
}

function stopNow() {
  if (nowTimer) { clearInterval(nowTimer); nowTimer = null; }
}

function nowStripHtml() {
  var info = nowInfo(new Date());
  return '<div class="now-strip"><div class="now-state" id="nowState">' + ic('bell', 'ic-sm') +
    '<span>' + esc(info.state) + '</span></div>' +
    '<div class="now-clock" id="nowClock"><span>' + esc(info.note) + '</span><span>' +
    esc(info.clock) + '</span></div></div>';
}

/* ---------- поля пошуку ---------- */
function bindSearch(inputId) {
  var input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', function () {
    if (inputId === 'navSearch') navQuery = input.value; else teacherQuery = input.value;
    render();
    var again = document.getElementById(inputId);
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  });
}

function bindPanelSearch() {
  var input = document.getElementById('panelSearch');
  if (!input) return;
  input.addEventListener('input', function () {
    panelQuery = input.value;
    render();
    var again = document.getElementById('panelSearch');
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  });
}

function moveAuthThumb() {
  var tabs = document.querySelectorAll('.auth-tab');
  var thumb = document.getElementById('authThumb');
  if (!tabs.length || !thumb) return;
  var active = null;
  Array.prototype.forEach.call(tabs, function (t) {
    if (t.className.indexOf('active') > -1) active = t;
  });
  if (!active) return;
  thumb.style.left = active.offsetLeft + 'px';
  thumb.style.width = active.offsetWidth + 'px';
}

/* ============================================================
   Сторінки порталу. Кожна функція повертає HTML секції.
   ============================================================ */

/* ---------- головна ---------- */
function navCardHtml(card) {
  return '<a class="card" href="' + esc(card.go) + '"><div class="card-cloud">' +
    '<span class="card-ico">' + ic(card.icon) + '</span>' +
    '<h3>' + esc(card.title) + '</h3><p>' + esc(card.desc) + '</p>' +
    '<span class="card-go">Перейти ' + ic('arrow', 'ic-sm') + '</span>' +
    '</div></a>';
}

function catCount(id) {
  if (id === 'all') return NAV_CARDS.length;
  return NAV_CARDS.filter(function (c) { return c.cat === id; }).length;
}

function homePage() {
  var query = navQuery.trim().toLowerCase();
  var cards = NAV_CARDS.filter(function (c) {
    if (navFilter !== 'all' && c.cat !== navFilter) return false;
    if (!query) return true;
    return (c.title + ' ' + c.desc).toLowerCase().indexOf(query) > -1;
  });
  var tabs = NAV_CATS.map(function (c) {
    return '<button class="ftab' + (navFilter === c.id ? ' active' : '') + '" type="button" data-nav-filter="' +
      esc(c.id) + '">' + esc(c.label) + '<span class="ftab-count">' + catCount(c.id) + '</span></button>';
  }).join('');
  var grid = cards.length
    ? '<div class="cards">' + cards.map(navCardHtml).join('') + '</div>'
    : '<p class="card-note">За запитом «' + esc(navQuery) + '» розділів не знайдено. Спробуйте інше слово, наприклад «розклад», «оцінки» або «контакти».</p>';
  var user = currentUser();
  var action = user
    ? '<a class="btn-dark" href="#/diary">' + ic('star') + '<span>Відкрити щоденник</span></a>' +
      '<a class="btn-dark btn-ghost-dark" href="#/schedule">' + ic('clock') + '<span>Розклад ' + esc(user.klass || 'ліцею') + '</span></a>'
    : '<a class="btn-dark" href="#/auth">' + ic('login') + '<span>Увійти до щоденника</span></a>' +
      '<a class="btn-dark btn-ghost-dark" href="#/schedule">' + ic('clock') + '<span>Розклад дзвінків</span></a>';
  var stats = [
    [SCHOOL.founded, 'рік заснування'],
    [SCHOOL.students, 'здобувачів освіти'],
    [SCHOOL.classes, 'класів'],
    [SCHOOL.staff, 'працівників'],
    [SCALE_MAX, 'максимальний бал']
  ].map(function (s) {
    return '<div class="stat-chip"><b>' + esc(String(s[0])) + '</b><span>' + esc(s[1]) + '</span></div>';
  }).join('');

  return '<section class="hero"><div class="hero-text-container">' + flashHtml() +
    '<h1>Lyceum N21</h1>' +
    '<p>' + esc(SCHOOL.full) + '. Портал ліцею: розклад, оцінки, вчителі та новини в одному вікні браузера.</p>' +
    '<div class="hero-actions">' + action +
    '<a class="btn-dark btn-ghost-dark" href="#/history">' + ic('book') + '<span>Історія ліцею</span></a></div>' +
    '</div></section>' +
    '<section class="promo-showcase"><h2>Навігація порталом: оберіть розділ або скористайтеся пошуком. ' +
    'Оцінки, домашні завдання та розклад зібрано в окремій вкладці «Щоденник».</h2></section>' +
    '<section class="nav-panel"><div class="nav-panel-head"><h3>' + ic('search') + '<span>Що вас цікавить?</span></h3>' +
    '<input class="cg-search" id="navSearch" type="search" placeholder="Пошук по розділах: оцінки, меню, вакансії" ' +
    'aria-label="Пошук по розділах порталу" value="' + esc(navQuery) + '" autocomplete="off"></div>' +
    '<div class="keys-filter-bar"><div class="filter-tabs" role="group" aria-label="Категорії розділів">' + tabs + '</div>' +
    '<span class="small muted">' + cards.length + ' з ' + NAV_CARDS.length + ' розділів</span></div>' + grid +
    '</section>' +
    '<section class="reviews-box"><div class="reviews-box-head">' + ic('news', 'ic-sm') +
    '<span>Новини та оголошення ліцею</span></div>' +
    '<div class="reviews-viewport"><div class="reviews-track" id="newsTrack"></div></div></section>' +
    '<section class="admin-stats">' + stats + '</section>';
}

/* ---------- історія ліцею ---------- */
function historyPage() {
  var timeline = DIRECTORS.map(function (d) {
    return '<div class="tl-item"><p class="tl-years">' + esc(d.years) + '</p>' +
      '<p class="tl-name">' + esc(d.name) + '</p><p class="tl-note">' + esc(d.note) + '</p></div>';
  }).join('');
  var facts = HISTORY_FACTS.map(function (f) {
    return '<div class="row-line"><dt>' + esc(f.year) + '</dt><dd>' + esc(f.text) + '</dd></div>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('history') +
    '<div class="legal-card"><h1>Біографія ліцею</h1>' +
    '<p class="legal-updated">Дані взято з офіційного сайту закладу та відкритого реєстру (ЄДРПОУ ' + esc(SCHOOL.edrpou) + ').</p>' +
    '<p>Ліцей відлік історії веде з 1962 року, коли наказом обласного відділу освіти було відкрито школу №21 у Житомирі. ' +
    'За десятиліття заклад змінив кілька назв і приміщень, у 2017 році отримав статус ліцею та сучасний корпус із гімназією.</p>' +
    '<h2>Директорський склад</h2>' +
    '<p>За весь час ліцей очолювали шестеро керівників. Кожен із них залишив слід у розвитку матеріальної бази та профільного навчання.</p>' +
    '<div class="timeline">' + timeline + '</div>' +
    '<h2>Хронологія подій</h2>' +
    '<dl class="row-list">' + facts + '</dl>' +
    '<h2>Сучасний ліцей</h2>' +
    '<div class="grid-2">' +
    '<div class="info-card"><h3>' + ic('cap') + '<span>Навчання</span></h3><ul>' +
    '<li>Базова середня освіта: паралелі 5–9 класів, усього ' + esc(SCHOOL.classes) + ' класів.</li>' +
    '<li>Навчальний план: шість уроків у 5–6 класах і сім уроків у 7–9 класах щодня.</li>' +
    '<li>Профіль закладу: ' + esc(SCHOOL.language) + '.</li>' +
    '<li>Оцінювання 12-бальне, семестрове з підсумком у кінці року.</li>' +
    '<li>Державна підсумкова атестація завершує базову освіту у 9 класі.</li></ul></div>' +
    '<div class="info-card"><h3>' + ic('users') + '<span>Людський склад</span></h3><ul>' +
    '<li>' + esc(SCHOOL.students) + ' здобувачів освіти та ' + esc(SCHOOL.staff) + ' працівників.</li>' +
    '<li>Директор: ' + esc(SCHOOL.director) + ', ' + esc(SCHOOL.directorNote) + '.</li>' +
    '<li>Педагоги вищої та першої категорії, окремі кабінети для кожного предмета.</li>' +
    '<li>Практичний психолог, соціальний педагог та медичний кабінет працюють щодня.</li></ul></div>' +
    '<div class="info-card"><h3>' + ic('spark') + '<span>Інфраструктура</span></h3><ul>' +
    '<li>Два навчальні корпуси, оновлена спортивна зала та харчоблок.</li>' +
    '<li>Медіатека, кабінети фізики, хімії, інформатики та робототехніки.</li>' +
    '<li>Гуртки: HK Unicorn Squad, мовний клуб, хор, медіацентр, спортивні секції.</li></ul></div>' +
    '<div class="info-card"><h3>' + ic('pin') + '<span>Адреса</span></h3><ul>' +
    '<li>' + esc(SCHOOL.address) + '.</li>' +
    '<li>' + esc(SCHOOL.district) + '.</li>' +
    '<li>Приймальня: ' + esc(SCHOOL.phone) + ', ' + esc(SCHOOL.email) + '.</li>' +
    '<li>Офіційний сайт закладу: ' + esc(SCHOOL.site) + '.</li></ul></div>' +
    '</div>' +
    '<div class="hero-actions"><a class="btn-dark" href="#/teachers">' + ic('users') + '<span>Педагогічний склад</span></a>' +
    '<a class="btn-dark btn-ghost-dark" href="#/news">' + ic('news') + '<span>Новини ліцею</span></a></div>' +
    '</div></section>';
}

/* ---------- учням ---------- */
/* Тривалість перерви після i-го урока рахується з графіка дзвінків */
function breakAfter(i) {
  var next = BELL[i + 1];
  return next ? toMinutes(next.start) - toMinutes(BELL[i].end) : 0;
}

function studentsPage() {
  var day = BELL.map(function (b, i) {
    var mins = breakAfter(i);
    return '<div class="row-line"><dt>' + b.n + '-й урок</dt><dd>' + esc(b.start) + ' до ' + esc(b.end) +
    '. ' + (mins ? 'Перерва ' + mins + ' хвилин.' : 'Останній дзвінок о ' + esc(b.end) + '.') + '</dd></div>';
  }).join('');
  var rules = [
    ['Правила для учнів', 'Приходити за десять хвилин до дзвінка, мати підручники та зошити з собою, бережно ставитися до майна закладу. Пропуск уроків повідомляється класному керівнику в перший день.'],
    ['Одяг та форма', 'Діловий стиль: светр або сорочка темного кольору, взуття на змінну підошву. Форму для фізичної культури видають у спортивній залі.'],
    ['Харчування', 'Гарячі сніданки о 10:35–10:55 та обід після п’ятого уроку о 12:45–13:05. Пільгове харчування оформлюється через класного керівника.'],
    ['Безпека під час тривоги', 'За сигналу повітряної тривоги учні йдуть до найближчого укриття з класним керівником, список присутніх звіряється на місці.'],
    ['Поведінка у мережі', 'Пароль від порталів ліцею не передається навіть однокласникам, особисті дані не публікуються у чатах.']
  ];
  var rulesHtml = rules.map(function (r, i) {
    return '<details class="row"><summary><span class="row-main"><b>' + esc(r[0]) + '</b></span>' +
      '<span class="row-sign">розгорнути ' + ic('arrow', 'ic-sm') + '</span></summary>' +
      '<div class="row-body"><p>' + esc(r[1]) + '</p></div></details>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('students') + flashHtml() +
    '<div class="heading-panel"><div><p class="kicker">' + ic('cap') + '<span>Базова середня освіта</span></p>' +
    '<h1 class="page-title">Учням ліцею</h1>' +
    '<p class="page-sub">Пам’ятки, режим дня, атестація, підтримка психолога та гуртки. Усі розділи зібрано списками, ' +
    'щоб швидко знайти потрібне.</p></div>' +
    '<div class="select-line"><a class="btn-dark" href="#/diary">' + ic('star') + '<span>Мій щоденник</span></a></div></div>' +

    '<div class="card-panel" id="schedule-note"><h2>' + ic('clock') + '<span>Режим навчального дня</span></h2>' +
    '<p>Уроки йдуть з 8:00 до 14:50. У 5–6 класів шість уроків, з 7 класу сім уроків щодня. ' +
    'Розклад дзвінків однаковий для всіх паралелей.</p>' +
    '<div class="row-list">' + day + '</div></div>' +

    '<div class="card-panel" id="safety"><h2>' + ic('shield') + '<span>Пам’ятки та правила</span></h2>' +
    '<div class="row-list">' + rulesHtml + '</div></div>' +

    '<div class="card-panel" id="dpa"><h2>' + ic('trophy') + '<span>Державна підсумкова атестація</span></h2>' +
    '<p>ДПА завершує базову середню освіту у 9 класі. Перелік предметів визначено навчальним планом, вибору немає.</p>' +
    '<div class="row-list">' + ATTEST[9].subjects.map(function (s) {
      return '<div class="row-line"><dt>' + esc(s) + '</dt><dd>оцінка за 12-бальною шкалою, разом із річною оцінкою з предмета.</dd></div>';
    }).join('') + '</div>' +
    '<div class="entry-actions"><a class="btn-dark btn-sm" href="#/students:help">' + ic('life') + '<span>Підтримка психолога перед атестацією</span></a>' +
    '<a class="btn-dark btn-sm btn-ghost-dark" href="#/schedule">' + ic('calendar') + '<span>Графік уроків</span></a></div></div>' +

    '<div class="card-panel" id="help"><h2>' + ic('life') + '<span>Психолог, медкабінет і соціальний педагог</span></h2>' +
    '<p>Фахівці працюють щодня, консультація безкоштовна та конфіденційна. Звернутися можна напряму або через класного керівника.</p>' +
    '<div class="row-list">' + TEACHERS.filter(function (t) { return t.dept === 'support'; }).map(function (t) {
      return '<div class="row-line"><dt>' + esc(t.role) + '</dt><dd>' + esc(t.name) + ', ' + esc(t.room) + '. ' + esc(t.duty) + '. ' +
        '<a class="abtn abtn-sm" href="tel:' + esc(telHref(t.phone)) + '">' + ic('phone', 'ic-sm') + '<span>' + esc(t.phone) + '</span></a></dd></div>';
    }).join('') +
    '<div class="row-line"><dt>Медичний кабінет</dt><dd>каб. 110, працює з 8:00 до 15:00, екстрена допомога викликається через приймальню.</dd></div>' +
    '</div></div>' +

    '<div class="card-panel" id="gurki"><h2>' + ic('spark') + '<span>Гуртки та секції</span></h2>' +
    '<p>Запис через класного керівника або керівника гуртка, заняття безкоштовні. Початок після останнього дзвінка.</p>' +
    '<div class="row-list">' + GURKIV.map(function (g) {
      return '<div class="row-line"><dt>' + esc(g.t) + '</dt><dd>' + esc(g.d) + '</dd></div>';
    }).join('') + '</div></div>' +

    '<div class="card-panel"><h2>' + ic('star') + '<span>Як користуватися щоденником</span></h2>' +
    '<ul><li>Зареєструйтеся у розділі «Вхід і реєстрація».</li>' +
    '<li>На вкладці «Щоденник» оберіть свій клас, без нього перелік предметів порожній.</li>' +
    '<li>Там само видно бали з кожного предмета, середній бал та домашні завдання.</li>' +
    '<li>Оцінки виставляє вчитель у власній панелі, зміна балів зберігається в цьому браузері.</li></ul>' +
    '<div class="entry-actions"><a class="btn-dark btn-sm" href="#/auth">' + ic('login') + '<span>Створити профіль</span></a>' +
    '<a class="btn-dark btn-sm btn-ghost-dark" href="#/diary">' + ic('star') + '<span>Відкрити щоденник</span></a></div></div>' +
    '</section>';
}

/* ---------- вчителі ---------- */
function teacherRow(t) {
  var duty = t.subject
    ? 'Посада: ' + t.role + '. Викладає предмет: ' + t.subject
    : 'Посадові обов’язки: ' + t.duty;
  return '<details class="row"><summary><span class="row-main">' +
    '<b>' + esc(t.name) + '</b>' +
    '<span class="cfg-title">' + esc(t.subject || t.role) + '</span></span>' +
    '<span class="row-sign">' + esc(t.room) + ' ' + ic('arrow', 'ic-sm') + '</span></summary>' +
    '<div class="row-body"><p>' + esc(duty) + '. Категорія: ' + esc(t.cat) + '. Кабінет: ' + esc(t.room) + '.</p>' +
    '<div class="entry-actions">' +
    '<a class="abtn abtn-sm" href="tel:' + esc(telHref(t.phone)) + '">' + ic('phone', 'ic-sm') +
    '<span>' + esc(t.phone) + '</span></a>' +
    '<a class="abtn abtn-sm" href="mailto:' + esc(SCHOOL.email) + '?subject=Питання%20до%20' + esc(encodeURIComponent(t.name)) + '">' +
    ic('mail', 'ic-sm') + '<span>Написати через приймальню</span></a></div></div></details>';
}

function teachersPage() {
  var query = teacherQuery.trim().toLowerCase();
  var list = TEACHERS.filter(function (t) {
    if (teacherFilter !== 'all' && t.dept !== teacherFilter) return false;
    if (!query) return true;
    return (t.name + ' ' + t.role + ' ' + (t.subject || '') + ' ' + (t.duty || '')).toLowerCase().indexOf(query) > -1;
  });
  var tabs = TEACHER_DEPTS.map(function (d) {
    var count = d.id === 'all' ? TEACHERS.length : TEACHERS.filter(function (t) { return t.dept === d.id; }).length;
    return '<button class="ftab' + (teacherFilter === d.id ? ' active' : '') + '" type="button" data-teacher-filter="' +
      esc(d.id) + '">' + esc(d.label) + '<span class="ftab-count">' + count + '</span></button>';
  }).join('');
  var rows = list.length
    ? '<div class="row-list">' + list.map(teacherRow).join('') + '</div>'
    : '<p class="card-note">Нікого не знайдено за запитом «' + esc(teacherQuery) + '». Оберіть іншу методичну комісію або спростіть пошук.</p>';
  var admin = TEACHERS.filter(function (t) { return t.dept === 'admin'; });

  return '<section class="page-wide">' + breadcrumbHtml('teachers') +
    '<div class="heading-panel"><div><p class="kicker">' + ic('users') + '<span>Педагогічна рада</span></p>' +
    '<h1 class="page-title">Вчителі та працівники ліцею</h1>' +
    '<p class="page-sub">' + TEACHERS.length + ' імен: адміністрація, вчителі-предметники та фахівці. ' +
    'Оцінки з предметів вносить лише вчитель-предметник, адміністрація навчальний журнал не веде.</p></div></div>' +
    '<div class="keys-filter-bar"><div class="filter-tabs" role="group" aria-label="Методичні комісії">' + tabs + '</div>' +
    '<input class="admin-search" id="teacherSearch" type="search" placeholder="Пошук: прізвище або предмет" ' +
    'aria-label="Пошук педагогів" value="' + esc(teacherQuery) + '" autocomplete="off"></div>' + rows +

    '<div class="card-panel" id="admin"><h2>' + ic('briefcase') + '<span>Адміністрація та графік прийому</span></h2>' +
    '<p>Звертатися до заступників можна за попереднім записом через приймальню. Графік прийому директора наведено нижче.</p>' +
    '<div class="row-list">' + admin.map(function (t) {
      return '<div class="row-line"><dt>' + esc(t.role) + '</dt><dd>' + esc(t.name) + '. ' + esc(t.duty) + '. ' + esc(t.room) + '.</dd></div>';
    }).join('') + '</div>' +
    '<div class="row-list">' +
    '<div class="row-line"><dt>Директор</dt><dd>' + esc(SCHOOL.director) + ', ' + esc(SCHOOL.directorNote) + '.</dd></div>' +
    '<div class="row-line"><dt>Прийом громадян</dt><dd>' + esc(SCHOOL.reception) + '.</dd></div>' +
    '<div class="row-line"><dt>Графік роботи</dt><dd>' + esc(SCHOOL.hours) + '.</dd></div>' +
    '<div class="row-line"><dt>Приймальня</dt><dd>' + esc(SCHOOL.phone) + ', ' + esc(SCHOOL.email) + '.</dd></div></div>' +
    '<div class="entry-actions"><a class="btn-dark btn-sm" href="#/contacts">' + ic('pin') + '<span>Усі контакти</span></a></div></div>' +

    '<div class="card-panel"><h2>' + ic('door') + '<span>Відкриті вакансії</span></h2>' +
    '<div class="row-list">' +
    [['Вчитель англійської мови', 'ставка 1,0: вища освіта за фахом, розмовний рівень не нижчий C1'],
     ['Вчитель інформатики та робототехніки', 'ставка 0,5: досвід роботи з Arduino та Scratch'],
     ['Практичний психолог', 'ставка 1,0: вища освіта з психології, бажана підготовка з кризової підтримки']]
      .map(function (v) {
        return '<div class="row-line"><dt>' + esc(v[0]) + '</dt><dd>' + esc(v[1]) + '. Резюме надсилайте на ' +
          '<a href="mailto:' + esc(SCHOOL.email) + '">' + esc(SCHOOL.email) + '</a>.</dd></div>';
      }).join('') + '</div></div></section>';
}

/* ---------- розклад ---------- */
function schedulePage() {
  var user = currentUser();
  var klass = scheduleClass || (user && user.klass) || CLASSES[2];
  var grade = classGrade(klass);
  var per = lessonsPerDay(grade);
  var week = buildWeek(klass);
  var chips = CLASSES.map(function (c) {
    return '<button class="abtn' + (c === klass ? ' on' : '') + '" type="button" data-class-chip="' + esc(c) + '">' +
      esc(c) + '<span class="ftab-count">' + lessonsPerDay(classGrade(c)) + ' уроків</span></button>';
  }).join('');
  var bell = BELL.slice(0, per).map(function (b, i) {
    var mins = breakAfter(i);
    return '<div class="cfg-row lesson-row" data-lesson="' + b.n + '"><div class="cfg-info">' +
      '<div class="cfg-top"><span class="cfg-author">' + b.n + '-й урок</span>' +
      '<span class="cfg-title">' + esc(b.start) + ' до ' + esc(b.end) + '</span></div></div></div>' +
      (i < per - 1 ? '<div class="break-row" role="img" aria-label="Перерва ' + mins + ' хвилин">' + mins + '</div>' : '');
  }).join('');
  var days = week.map(function (list, i) {
    var lessons = list.map(function (s, n) {
      return '<div class="row-line"><dt>' + (n + 1) + '-й урок, ' + esc(BELL[n].start) + '</dt><dd>' +
        '<b>' + esc(s.name) + '</b>. ' + esc(shortTeacher(s.teacher)) + ', каб. ' + esc(s.room) + '.</dd></div>';
    }).join('');
    return '<details class="row"' + (i === 0 ? ' open' : '') + '><summary><span class="row-main"><b>' + esc(DAYS[i]) +
      '</b><span class="cfg-title">' + list.length + ' уроків</span></span>' +
      '<span class="row-sign">розклад ' + ic('arrow', 'ic-sm') + '</span></summary>' +
      '<div class="row-body"><div class="row-list">' + lessons + '</div></div></details>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('schedule') +
    '<div class="heading-panel"><div><p class="kicker">' + ic('clock') + '<span>' + esc(klass) + ' клас</span></p>' +
    '<h1 class="page-title">Розклад дзвінків та уроків</h1>' +
    '<p class="page-sub">Дзвінки однакові для всіх: початок о 8:00, останній дзвінок о 14:50. ' +
    'У 5–6 класів шість уроків, з 7 класу сім уроків щодня.</p></div>' +
    '<div class="select-line">' + (user && user.klass ?
      '<a class="btn-dark btn-sm" href="#/diary">' + ic('star') + '<span>Мій щоденник</span></a>' :
      '<a class="btn-dark btn-sm" href="#/auth">' + ic('login') + '<span>Увійти</span></a>') + '</div></div>' +
    nowStripHtml() +
    '<div class="keys-filter-bar"><div class="filter-tabs" role="group" aria-label="Класи">' + chips + '</div>' +
    '<span class="small muted">Модельний тижневий план, побудований за навчальним планом ' + esc(klass) + ' класу.</span></div>' +
    '<div class="card-panel"><h2>' + ic('bell') + '<span>Розклад дзвінків ' + esc(klass) + ' класу</span></h2>' +
    '<p class="small muted">Урок триває 45 хвилин. Число між уроками це перерва у хвилинах.</p>' +
    '<div class="cfg-list">' + bell + '</div></div>' +
    '<div class="card-panel"><h2>' + ic('calendar') + '<span>Тиждневний план</span></h2>' +
    '<div class="row-list">' + days + '</div>' +
    '<p class="small muted">Точний розклад вашого класу видає адміністрація на початку семестру та у групі Human.ua.</p></div>' +
    '</section>';
}

/* ---------- новини та події ---------- */
function newsPage() {
  var items = NEWS.map(function (n) {
    return '<details class="row"><summary><span class="row-main">' +
      '<span class="pill pill-days">' + esc(n.tag) + '</span><b>' + esc(n.title) + '</b></span>' +
      '<span class="row-sign">' + esc(n.date) + ' ' + ic('arrow', 'ic-sm') + '</span></summary>' +
      '<div class="row-body"><p>' + esc(n.text) + '</p></div></details>';
  }).join('');
  var events = EVENTS.map(function (e) {
    return '<div class="row-line"><dt>' + esc(e.date) + '<br><span class="pill pill-audit">' + esc(e.kind) + '</span></dt>' +
      '<dd><b>' + esc(e.title) + '</b><br>' + esc(e.time) + '. ' + esc(e.note) + '</dd></div>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('news') + flashHtml() +
    '<div class="heading-panel"><div><p class="kicker">' + ic('news') + '<span>' + todayLabel(new Date()) + '</span></p>' +
    '<h1 class="page-title">Новини та календар подій</h1>' +
    '<p class="page-sub">Оголошення адміністрації, результати олімпіад, найближчі збори та заходи. ' +
    'Розгорніть потрібну новину, щоб прочитати повністю.</p></div>' +
    '<div class="select-line"><a class="btn-dark btn-sm" href="#/dining">' + ic('bowl') + '<span>Меню їдальні</span></a></div></div>' +
    '<div class="card-panel"><h2>' + ic('calendar') + '<span>Найближчі події</span></h2>' +
    '<div class="row-list">' + events + '</div>' +
    '<p class="small muted">Збори та заходи оголошуються через класних керівників, зміни з’являються тут першими.</p></div>' +
    '<div class="card-panel"><h2>' + ic('news') + '<span>Останні новини</span></h2>' +
    '<div class="row-list">' + items + '</div></div></section>';
}

/* ---------- вигляд ліцею ---------- */
var GALLERY = [
  { src: 'assets/photos/liceum-facade.jpg', title: 'Головний фасад', text: 'Чотириповерховий корпус ліцею з боку вулиці Святослава Ріхтера: центральний вхід і двір перед ним.' },
  { src: 'assets/photos/liceum-entrance.jpg', title: 'Вхід і подвір’я', text: 'Центральний вхід та алея до нього влітку: огорожа, дерева й майданчик перед дверима.' }
];

function galleryPage() {
  var tiles = GALLERY.map(function (photo) {
    return '<figure class="photo-card"><a class="photo-link" href="' + esc(photo.src) + '" target="_blank" rel="noopener">' +
      '<img src="' + esc(photo.src) + '" alt="' + esc(photo.title) + ' ліцею №21" loading="lazy" decoding="async"></a>' +
      '<figcaption><b>' + esc(photo.title) + '</b><span>' + esc(photo.text) + '</span></figcaption></figure>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('gallery') +
    '<div class="heading-panel"><div><p class="kicker">' + ic('palette') + '<span>Фотогалерея</span></p>' +
    '<h1 class="page-title">Вигляд ліцею</h1>' +
    '<p class="page-sub">Будівля, центральний вхід і подвір’я Житомирського міського ліцею №21. ' +
    'Натисніть на фото, щоб відкрити його повністю.</p></div>' +
    '<div class="select-line"><a class="btn-dark btn-sm" href="#/contacts">' + ic('pin') + '<span>Як дістатися</span></a></div></div>' +
    '<div class="photo-grid">' + tiles + '</div>' +
    '<div class="card-panel"><h2>' + ic('info') + '<span>Про фото</span></h2>' +
    '<p class="small muted">Світлини показують головний фасад та центральний вхід. Нові фотографії корпусів, ' +
    'спортивної зали й кабінетів додає адміністратор порталу.</p></div></section>';
}

/* ---------- їдальня ---------- */
var MENU_CATEGORIES = ['Закуска', 'Суп', 'Друга гаряча страва', 'Напій', 'Хліб або випічка'];

function diningPage() {
  var day = MENU[diningDay] || MENU[0];
  var tabs = MENU.map(function (m, i) {
    return '<button class="ftab' + (i === diningDay ? ' active' : '') + '" type="button" data-dining-day="' + i + '">' +
      esc(m.day) + '</button>';
  }).join('');
  var rows = day.items.map(function (item, i) {
    return '<div class="row-line"><dt>' + esc(MENU_CATEGORIES[i] || 'Страва') + '</dt>' +
      '<dd><b>' + esc(item[0]) + '</b><br>' + esc(item[1]) + ' за порцію.</dd></div>';
  }).join('');
  var total = day.items.reduce(function (sum, item) {
    return sum + Number(String(item[1]).replace(/\D/g, ''));
  }, 0);

  return '<section class="page-wide">' + breadcrumbHtml('dining') +
    '<div class="heading-panel"><div><p class="kicker">' + ic('bowl') + '<span>Харчоблок ліцею</span></p>' +
    '<h1 class="page-title">Меню їдальні на тиждень</h1>' +
    '<p class="page-sub">Сніданок о 10:35–10:55, гарячий обід після п’ятого уроку о 12:45–13:05. ' +
    'Ціни вказано за порцію, оплата готівкою або через класного керівника.</p></div></div>' +
    '<div class="keys-filter-bar"><div class="filter-tabs" role="group" aria-label="Дні тижня">' + tabs + '</div>' +
    '<span class="small muted">' + esc(day.day) + ': ' + day.items.length + ' позицій, повний обід ' + total + ' ₴</span></div>' +
    '<div class="card-panel"><h2>' + ic('bowl') + '<span>' + esc(day.day) + '</span></h2>' +
    '<div class="row-list">' + rows + '</div></div>' +
    '<div class="panel-cols">' +
    '<div class="card-panel"><h3>' + ic('shield') + '<span>Пільгове харчування</span></h3><ul>' +
    '<li>Учні з багатодітних сімей та внутрішньо переміщених осіб.</li>' +
    '<li>Діти військовослужбовців та учні, які перебувають на опіці.</li>' +
    '<li>Документи подаються класному керівнику, наказ видається на чверть.</li>' +
    '<li>Гарячий сніданок для 5–6 класів безкоштовний за проєктом «Сніданок у школі».</li></ul></div>' +
    '<div class="card-panel"><h3>' + ic('life') + '<span>Поради щодо здорового харчування</span></h3><ul>' +
    '<li>Повноцінний сніданок удома за 30 хвилин до уроків.</li>' +
    '<li>Вода замість солодкої газованої води, фрукти замість чипсів.</li>' +
    '<li>Овочі або фрукти щодня, риба двічі на тиждень.</li>' +
    '<li>Їсти повільно, не перекушувати на перерві цукерками.</li></ul></div>' +
    '<div class="card-panel"><h3>' + ic('phone') + '<span>Як замовити та скасувати</span></h3><ul>' +
    '<li>Заява на тиждень через класного керівника до п’ятниці.</li>' +
    '<li>Скасування не пізніше доби, інакше страва списується.</li>' +
    '<li>Алергії та дієти узгоджуються із медичним кабінетом, каб. 110.</li></ul></div>' +
    '</div></section>';
}

/* ---------- зарахування ---------- */
function admissionsPage() {
  var docs = [
    ['Заява батьків або самих учнів', 'заповнюється у приймальні або за зразком нижче'],
    ['Копія свідоцтва про народження', 'двох сторінок достатньо'],
    ['Медична довідка форми 063/о', 'щеплення та група стану здоров’я'],
    ['Довідка про навчання в попередній школі', 'виписка з додатком та оцінками'],
    ['Дві фотографії 3×4', 'для перепустки та учнівського квитка'],
    ['Копія ідентифікаційного коду', 'за наявності']
  ];
  var forms = [
    ['Оочна форма', 'Навчання у корпусі ліцею за розкладом, факультативи та гуртки після уроків.'],
    ['Індивідуальна форма', 'За заявою батьків, індивідуальний графік, контрольні роботи разом із класом.'],
    ['Сімейна освіта', 'Родина бере навчання на себе, ліцей надає проміжне та підсумкове оцінювання.'],
    ['Дистанційна форма', 'Призначається наказом під час воєнного стану або через тривалу хворобу учня, уроки на платформі ' + SCHOOL.platform + '.']
  ];

  return '<section class="page-wide">' + breadcrumbHtml('admissions') +
    '<div class="heading-panel"><div><p class="kicker">' + ic('door') + '<span>Прийом учнів</span></p>' +
    '<h1 class="page-title">Зарахування до ліцею</h1>' +
    '<p class="page-sub">Ліцей приймає учнів до 5–9 класів на базову середню освіту. Вступних іспитів немає, ' +
    'вибір предметів або профілів навчальний план не передбачає.</p></div>' +
    '<div class="select-line"><a class="btn-dark btn-sm" href="#/contacts">' + ic('phone') + '<span>Зателефонувати до приймальні</span></a></div></div>' +

    '<div class="card-panel"><h2>' + ic('check') + '<span>Перелік документів</span></h2>' +
    '<div class="row-list">' + docs.map(function (d) {
      return '<div class="row-line"><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>';
    }).join('') + '</div>' +
    '<p class="small muted">Наказ про зарахування видається протягом п’яти робочих днів після подання всіх документів.</p></div>' +

    '<div class="card-panel"><h2>' + ic('cap') + '<span>Форми навчання</span></h2>' +
    '<div class="row-list">' + forms.map(function (f) {
      return '<div class="row-line"><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
    }).join('') + '</div></div>' +

    '<div class="card-panel"><h2>' + ic('pen') + '<span>Заява: зразок тексту</span></h2>' +
    '<div class="row-body"><p>Директору Житомирського міського ліцею №21<br>Реминець С. О.<br>від ' +
    'Коваленко Ірини Миколаївни, мешканки м. Житомир<br>тел. +380 67 000-00-00</p>' +
    '<p><b>ЗАЯВА</b></p>' +
    '<p>Прошу зарахувати мою доньку, Коваленко Софію Іванівну, 2013 року народження, до 5 класу ' +
    'Житомирського міського ліцею №21 у 2026/2027 навчальному році, денна форма здобуття освіти.</p>' +
    '<p>Додатки: копія свідоцтва про народження, медична довідка форми 063/о, довідка про навчання, дві фотографії 3×4.</p>' +
    '<p class="muted">Дата ____________ Підпис ____________</p></div></div>' +

    '<div class="card-panel"><h2>' + ic('info') + '<span>Строки та питання</span></h2>' +
    '<div class="row-list">' +
    '<div class="row-line"><dt>Прийом документів</dt><dd>з 2 червня по 31 серпня, понеділок і середа з 9:00 до 16:00.</dd></div>' +
    '<div class="row-line"><dt>Наказ про зарахування</dt><dd>протягом п’яти робочих днів після подання всіх документів.</dd></div>' +
    '<div class="row-line"><dt>Місця</dt><dd>кількість учнів у класі обмежено 30 особами, резервний список ведуть щотижня.</dd></div>' +
    '<div class="row-line"><dt>Гаряча лінія освіти</dt><dd>0 800 500 142, дзвінок безкоштовний.</dd></div>' +
    '</div></div></section>';
}

/* ---------- контакти ---------- */
function contactsPage() {
  var rows = [
    ['Адреса', SCHOOL.address],
    ['Район', SCHOOL.district],
    ['Приймальня', SCHOOL.phone],
    ['Електронна пошта', SCHOOL.email],
    ['Офіційний сайт', SCHOOL.site],
    ['ЄДРПОУ', SCHOOL.edrpou],
    ['Графік роботи', SCHOOL.hours],
    ['Прийом громадян', SCHOOL.reception],
    ['Директор', SCHOOL.director]
  ].map(function (r) {
    return '<div class="row-line"><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
  }).join('');

  return '<section class="page-wide">' + breadcrumbHtml('contacts') + flashHtml() +
    '<div class="heading-panel"><div><p class="kicker">' + ic('pin') + '<span>Як нас знайти</span></p>' +
    '<h1 class="page-title">Контакти ліцею</h1>' +
    '<p class="page-sub">Напишіть або зателефонуйте у приймальню, питання конкретного класу краще адресувати ' +
    'класному керівнику. Перелік телефонів педагогів є у розділі «Вчителі».</p></div></div>' +

    '<div class="card-panel"><h2>' + ic('phone') + '<span>Реквізити та зв’язок</span></h2>' +
    '<div class="row-list">' + rows + '</div>' +
    '<div class="entry-actions">' +
    '<a class="btn-dark btn-sm" href="tel:' + esc(SCHOOL.phoneRaw) + '">' + ic('phone', 'ic-sm') + '<span>Подзвонити ' + esc(SCHOOL.phone) + '</span></a>' +
    '<a class="btn-dark btn-sm" href="mailto:' + esc(SCHOOL.email) + '">' + ic('mail', 'ic-sm') + '<span>Написати листа</span></a>' +
    '<button class="btn-dark btn-sm btn-ghost-dark" type="button" data-action="copy-contacts">' +
    ic('check', 'ic-sm') + '<span>Скопіювати реквізити</span></button></div></div>' +

    '<div class="panel-cols">' +
    '<div class="card-panel"><h3>' + ic('pin') + '<span>Як дістатися</span></h3><ul>' +
    '<li>Автобуси 3, 7 та 14 до зупинки «Ліцей №21», три хвилини пішки.</li>' +
    '<li>Тролейбус 2, вихід до вулиці Святослава Ріхтера.</li>' +
    '<li>Власний автомобіль: паркування з боку спортивної зали, в’їд з вулиці.</li>' +
    '<li>Вхід для відвідувачів через центральний тамбур, перепустка не потрібна до 15:00.</li></ul></div>' +
    '<div class="card-panel"><h3>' + ic('shield') + '<span>Куди звертатися далі</span></h3><ul>' +
    '<li>Гаряча лінія Житомирської міської ради: 15-82.</li>' +
    '<li>Гаряча лінія освіти: 0 800 500 142.</li>' +
    '<li>Служба підтримки платформи Human.ua: у особистому кабінеті.</li>' +
    '<li>Екстрені ситуації: 101, 102, 103, 104.</li></ul></div>' +
    '<div class="card-panel"><h3>' + ic('users') + '<span>Класні керівники</span></h3><ul>' +
    CLASSES.map(function (c) {
      var t = curatorFor(c);
      return '<li>' + esc(c) + ' клас: ' + esc(t.name) + ', ' + esc(t.room) + '.</li>';
    }).join('') +
    '<li>Повний перелік телефонів у розділі <a href="#/teachers">Вчителі</a>.</li></ul></div>' +
    '</div></section>';
}

/* ---------- вхід і реєстрація ---------- */
function authPage() {
  var active = currentUser();
  if (active) {
    return '<section class="workspace">' + breadcrumbHtml('auth') + flashHtml() +
      '<div class="card-panel"><h2>' + ic('check') + '<span>Профіль уже активний</span></h2>' +
      '<p>' + esc(active.fullName) + ' (' + (active.role === 'teacher' ? 'вчитель' : 'учень') + ') увійшов у цьому браузері. ' +
      'Ще один профіль можна створити лише після виходу.</p>' +
      '<div class="entry-actions">' +
      '<a class="btn-dark btn-sm" href="#/diary">' + ic('star', 'ic-sm') + '<span>Щоденник</span></a>' +
      '<a class="btn-dark btn-sm btn-ghost-dark" href="#/profile">' + ic('gear', 'ic-sm') + '<span>Профіль</span></a>' +
      (active.role === 'teacher'
        ? '<a class="btn-dark btn-sm btn-ghost-dark" href="#/teacher">' + ic('pen', 'ic-sm') + '<span>Панель вчителя</span></a>' : '') +
      '<button class="btn-dark btn-sm btn-danger" type="button" data-action="logout">' + ic('logout', 'ic-sm') +
      '<span>Вийти та створити інший профіль</span></button></div></div></section>';
  }
  var isReg = authMode === 'register';
  var teacherFields = teacherAccess
    ? '<div class="auth-field"><label for="fCode">Код доступу педагога <span class="auth-field-hint">видає адміністрація</span></label>' +
      '<input id="fCode" name="code" type="password" placeholder="код доступу" required autocomplete="off"></div>'
    : '';
  var fields = isReg
    ? '<div class="auth-field"><label for="fName">ПІБ <span class="auth-field-hint">прізвище, ім’я, по батькові</span></label>' +
      '<input id="fName" name="fullName" type="text" placeholder="Коваленко Андрій Ігорович" required minlength="5" autocomplete="name"></div>' +
      '<div class="auth-field"><label for="fPhone">Номер телефону</label>' +
      '<input id="fPhone" name="phone" type="tel" placeholder="+380 67 123-45-67" required autocomplete="tel"></div>' +
      '<div class="auth-field"><label for="fPass">Пароль <span class="auth-field-hint">щонайменше 6 символів, літери та цифри</span></label>' +
      '<input id="fPass" name="password" type="password" placeholder="••••••••" required minlength="6" autocomplete="new-password"></div>' +
      '<div class="auth-field"><label for="fPass2">Повторіть пароль</label>' +
      '<input id="fPass2" name="password2" type="password" placeholder="••••••••" required minlength="6" autocomplete="new-password"></div>' +
      '<button class="auth-teacher-link" type="button" data-teacher-access>' +
      (teacherAccess ? 'Звичайна реєстрація учня' : 'Реєстрація для педагога ліцею') + '</button>' +
      teacherFields
    : '<div class="auth-field"><label for="fPhone">Номер телефону</label>' +
      '<input id="fPhone" name="phone" type="tel" placeholder="+380 67 123-45-67" required autocomplete="tel"></div>' +
      '<div class="auth-field"><label for="fPass">Пароль</label>' +
      '<input id="fPass" name="password" type="password" placeholder="••••••••" required autocomplete="current-password"></div>';

  return '<section class="auth-wrap"><div class="auth-cloud">' + flashHtml() +
    '<div class="auth-tabs"><span class="auth-thumb" id="authThumb"></span>' +
      '<button class="auth-tab' + (isReg ? '' : ' active') + '" type="button" data-auth-tab="login">Вхід</button>' +
      '<button class="auth-tab' + (isReg ? ' active' : '') + '" type="button" data-auth-tab="register">Реєстрація</button>' +
    '</div>' +
    '<div class="auth-error" id="authError" role="alert"></div>' +
    '<form class="auth-form" id="authForm">' + fields +
      '<button class="btn-auth" type="submit">' + ic(isReg ? 'cap' : 'login') +
      '<span>' + (isReg ? 'Створити профіль' : 'Увійти') + '</span></button>' +
    '</form>' +
    '<p class="auth-hint">' + (isReg
      ? (teacherAccess
        ? 'Реєстрація педагога відкриває панель оцінювання, код доступу видає адміністрація ліцею.'
        : 'Профіль учня відкриває щоденник. Клас оберете вже у вкладці «Щоденник», дані зберігаються лише в цьому браузері.')
      : 'Увійти можна за номером телефону та паролем, вказаними під час реєстрації.') + '</p>' +
    '</div></section>';
}

/* ---------- профіль і налаштування ---------- */
function loginNeededHtml(title, text) {
  return '<section class="auth-wrap"><div class="auth-cloud" style="text-align:center">' +
    ic('lock', 'ic-lg') +
    '<h2 style="margin:12px 0 6px;font-size:1.25rem">' + esc(title) + '</h2>' +
    '<p class="small muted">' + esc(text) + '</p>' +
    '<a class="dashboard-button btn-link" href="#/auth">' + ic('login', 'ic-sm') + '<span>Увійти або створити профіль</span></a>' +
    '</div></section>';
}

function profilePage() {
  var user = currentUser();
  if (!user) return loginNeededHtml('Профіль доступний після входу', 'У профілі видно ваш клас і роль, тут змінюється пароль.');
  var isTeacher = user.role === 'teacher';

  return '<section class="workspace">' + breadcrumbHtml('profile') + flashHtml() +
    '<div class="card-panel"><div class="account-head"><div class="account-avatar" aria-hidden="true">' +
    esc(initials(user.fullName)) + '</div><div class="account-copy">' +
    '<strong>' + esc(user.fullName) + '</strong>' +
    '<span><span class="role-badge ' + (isTeacher ? 'role-teacher' : 'role-curator') + '">' + (isTeacher ? 'Вчитель' : 'Учень') + '</span>' +
    esc(user.klass ? user.klass + ' клас' : 'Клас не вибрано') + '</span>' +
    '<span class="muted">' + esc(fmtPhone(user.phone)) + ', профіль створено ' + esc(user.created) + '</span></div></div>' +
    '<div class="entry-actions">' +
    (isTeacher
      ? '<a class="btn-dark btn-sm" href="#/teacher">' + ic('pen') + '<span>Панель вчителя</span></a>'
      : '<a class="btn-dark btn-sm" href="#/diary">' + ic('star') + '<span>Мій щоденник</span></a>') +
    '<a class="btn-dark btn-sm btn-ghost-dark" href="#/schedule">' + ic('calendar') + '<span>Розклад</span></a></div></div>' +

    '<div class="card-panel"><h2>' + ic('lock') + '<span>Зміна пароля</span></h2>' +
    '<form id="passForm"><div class="panel-cols">' +
    '<div class="auth-field"><label for="fOld">Поточний пароль</label>' +
    '<input id="fOld" name="old" type="password" required autocomplete="current-password" placeholder="••••••••"></div>' +
    '<div class="auth-field"><label for="fNew">Новий пароль <span class="auth-field-hint">літери та цифри, від 6 символів</span></label>' +
    '<input id="fNew" name="new" type="password" required minlength="6" autocomplete="new-password" placeholder="••••••••"></div>' +
    '</div><div class="entry-actions"><button class="btn-dark btn-sm" type="submit">' + ic('check', 'ic-sm') +
    '<span>Зберегти пароль</span></button></div>' +
    '<div class="auth-error" id="passError" role="alert"></div></form></div>' +

    '<div class="card-panel"><h2>' + ic('info') + '<span>Безпека та дані</span></h2>' +
    '<ul><li>Пароль зберігається як незворотний відбиток, у сховищі браузера лежить лише він.</li>' +
    '<li>Оцінки, відмітки домашніх завдань та тема також не виходять за межі цього пристрою.</li>' +
    '<li>На спільному комп’ютері виходьте з профілю кнопкою «Вийти».</li>' +
    '<li>Видалення профілю прибирає його з цього браузера, виставлені оцінки залишаються в журналі класу.</li></ul>' +
    '<div class="entry-actions">' +
    '<button class="btn-dark btn-sm btn-ghost-dark" type="button" data-action="logout">' + ic('logout', 'ic-sm') + '<span>Вийти з профілю</span></button>' +
    '<button class="btn-dark btn-sm btn-danger" type="button" data-action="delete-account">' + ic('close', 'ic-sm') +
    '<span>Видалити профіль</span></button></div></div>' +
    '</section>';
}

/* ---------- щоденник ---------- */
function diaryRowHtml(row, klass) {
  var marks = row.list.length
    ? row.list.map(function (v) { return markHtml(v); }).join('')
    : '<span class="mark mark-empty">балів ще немає</span>';
  var avg = row.list.length ? markHtml(Math.round(row.average), 'mark-year') : '<span class="mark mark-empty">–</span>';
  return '<details class="row"><summary><span class="row-main"><b>' + esc(row.name) + '</b>' +
    '<span class="cfg-title">' + esc(shortTeacher(row.teacher)) + ', каб. ' + esc(row.room) + '</span></span>' +
    '<span class="row-sign">' + ic(row.icon, 'ic-sm') + ' ' + row.list.length + '</span></summary>' +
    '<div class="row-body"><div class="marks">' + marks + '</div>' +
    '<div class="row-list" style="margin-top:10px">' +
    '<div class="row-line"><dt>Середній бал</dt><dd>' + avg + ' з ' + row.list.length + ' ' +
    plural(row.list.length, ['оцінки', 'оцінок', 'оцінок']) + ' за 12-бальною шкалою.</dd></div>' +
    '<div class="row-line"><dt>Як виставлено</dt><dd>' + (row.updated
      ? 'внесені вчителем, ' + esc(row.updated)
      : 'оцінок з цього предмета ще немає, їх вносить ' + esc(shortTeacher(row.teacher)) + ' у панелі вчителя.') + '</dd></div>' +
    '</div></div></details>';
}

function homeworkHtml(user) {
  var done = loadHomeworkDone();
  var list = homeworkFor(user);
  if (!list.length) return '<p class="card-note">Домашні завдання з’являться, щойно буде вибрано клас у щоденнику.</p>';
  return '<div class="cfg-list">' + list.map(function (h) {
    var isDone = !!done[h.id];
    return '<div class="cfg-row' + (isDone ? ' done' : '') + '">' +
      '<div class="cfg-info"><div class="cfg-top"><span class="cfg-author">' + esc(h.subject) + '</span>' +
      '<span class="cfg-title">здоати до ' + esc(h.due) + '</span></div>' +
      '<div class="cfg-desc">' + esc(h.text) + '</div></div>' +
      '<div class="cfg-actions"><label class="check"><input type="checkbox" data-hw="' + esc(h.id) + '"' +
      (isDone ? ' checked' : '') + '><span>виконано</span></label></div></div>';
  }).join('') + '</div>';
}

function diaryPage() {
  var user = currentUser();
  if (!user) return loginNeededHtml('Щоденник доступний після входу', 'Оцінки бачить лише учень, який увійшов у свій профіль.');
  if (user.role === 'teacher') {
    return '<section class="workspace">' + breadcrumbHtml('diary') +
      '<div class="card-panel"><h2>' + ic('star') + '<span>Щоденник для вчителя</span></h2>' +
      '<p>Ваш профіль ' + esc(user.fullName) + '. ' +
      'Оцінки переглядаються та редагуються в панелі вчителя, там само можна додати бал учню.</p>' +
      '<div class="entry-actions"><a class="btn-dark btn-sm" href="#/teacher">' + ic('pen') + '<span>Панель вчителя</span></a>' +
      '<a class="btn-dark btn-sm btn-ghost-dark" href="#/schedule">' + ic('calendar') + '<span>Розклад</span></a></div></div></section>';
  }
  var klass = user.klass;
  if (!klass) {
    return '<section class="workspace">' + breadcrumbHtml('diary') + flashHtml() +
      '<div class="card-panel"><h2>' + ic('star') + '<span>Клас ще не вибрано</span></h2>' +
      '<p>Щоденник показує предмети саме вашого класу. Оберіть його тут, у профіль можна зазирнути пізніше.</p>' +
      '<div class="select-line" style="margin-top:12px"><label class="small muted" for="diaryKlass">Мій клас</label>' +
      '<select id="diaryKlass" data-select="diary-klass"><option value="">Не обрано</option>' +
      CLASSES.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + ' клас</option>'; }).join('') +
      '</select></div></div></section>';
  }
  var rows = pupilRows(klass, user.fullName);
  var sum = diarySummary(rows);
  var att = ATTEST[classGrade(klass)];
  var known = pupilsOfClass(klass).some(function (p) { return p.name === user.fullName; });
  var curator = curatorFor(klass);
  var meterWidth = Math.round((sum.average / SCALE_MAX) * 100);

  return '<section class="workspace">' + breadcrumbHtml('diary') + flashHtml() + nowStripHtml() +
    '<div class="heading-panel"><div><p class="kicker">' + ic('star') + '<span>Електронний щоденник, ' + esc(klass) + ' клас</span></p>' +
    '<h1 class="page-title">' + esc(user.fullName) + '</h1>' +
    '<p class="page-sub">Оцінки, які вніс вчитель у панелі, та поточні домашні завдання. ' +
    'Річна оцінка формується в кінці навчального року за підсумками двох семестрів.</p></div>' +
    '<div class="select-line"><label class="small muted" for="diaryKlass">Мій клас</label>' +
    '<select id="diaryKlass" data-select="diary-klass"><option value="">Не обрано</option>' +
    CLASSES.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === klass ? ' selected' : '') + '>' + esc(c) + ' клас</option>';
    }).join('') + '</select>' +
    '<a class="btn-dark btn-sm btn-ghost-dark" href="#/schedule">' + ic('calendar') + '<span>Розклад</span></a></div></div>' +

    '<div class="panel-cols">' +
    '<div class="card-panel"><h2>' + ic('trophy') + '<span>Середній бал</span></h2>' +
    '<div class="summary-value">' + (sum.average ? sum.average.toFixed(1) + ' з ' + SCALE_MAX : 'балів ще немає') + '</div>' +
    '<div class="meter" title="Середній бал у відсотках від максимального"><i style="width:' + meterWidth + '%"></i></div>' +
    '<p class="small muted">' + (sum.marks ? esc(levelWord(sum.average)) + '. ' : '') +
    'Предметів у плані: ' + rows.length +
    ', з оцінками: ' + sum.filled + '. Всього виставлено ' + sum.marks + ' балів.</p></div>' +
    '<div class="card-panel"><h2>' + ic('book') + '<span>' + (sum.best ? 'Найкращий предмет' : 'Оцінювання') + '</span></h2>' +
    (sum.best
      ? '<div class="summary-value">' + esc(sum.best.name) + ', ' + sum.best.average.toFixed(1) + ' з ' + SCALE_MAX + '</div>' +
        '<p class="small muted">Його веде ' + esc(shortTeacher(sum.best.teacher)) + ', кабінет ' + esc(sum.best.room) + '.</p>'
      : '<p class="small muted">Балів поки що немає. Щойно вчитель внесе перший запис, він з’явиться в цьому розділі.</p>') + '</div>' +
    '<div class="card-panel"><h2>' + ic('pen') + '<span>' + (att ? 'Державна атестація' : 'Підсумкове оцінювання') + '</span></h2>' +
    (att
      ? '<ul>' + att.subjects.map(function (s) {
          var r = rows.filter(function (x) { return x.name === s; })[0];
          return '<li>' + esc(s) + ': ' + (r && r.list.length ? markHtml(Math.round(r.average)) : 'оцінка не виставлена') + '</li>';
        }).join('') + '</ul><p class="small muted">Перелік предметів визначено навчальним планом, вибору немає.</p>'
      : '<p class="small muted">Державна атестація завершує базову освіту у 9 класі. У ' + esc(klass) +
        ' класі рік закінчується підсумковим оцінюванням з кожного предмета.</p>') + '</div>' +
    '</div>' +

    '<div class="card-panel"><h2>' + ic('star') + '<span>Оцінки з предметів ' + esc(klass) + ' класу</span></h2>' +
    (known ? '' : '<p class="small muted">Вашого прізвища поки немає в переліку учнів ' + esc(klass) +
      ' класу, тому бали порожні. Вчитель внесе їх через панель, і вони з’являться тут.</p>') +
    '<div class="row-list">' + rows.map(function (r) { return diaryRowHtml(r, klass); }).join('') + '</div></div>' +

    '<div class="card-panel"><h2>' + ic('bell') + '<span>Домашні завдання</span></h2>' +
    '<p>Відмітка «виконано» зберігається для вашого профілю в цьому браузері.</p>' +
    homeworkHtml(user) + '</div>' +

    '<div class="card-panel"><h2>' + ic('phone') + '<span>Хто може відповісти на питання</span></h2>' +
    '<div class="row-list">' +
    '<div class="row-line"><dt>Класний керівник</dt><dd>' + esc(curator.name) + ', ' + esc(curator.room) + '. ' +
    '<a class="abtn abtn-sm" href="tel:' + esc(telHref(curator.phone)) + '">' + ic('phone', 'ic-sm') + '<span>' + esc(curator.phone) + '</span></a></dd></div>' +
    '<div class="row-line"><dt>Заступник директора з НВР</dt><dd>Андрущенко Людмила Петрівна, каб. 302.</dd></div>' +
    '<div class="row-line"><dt>Практичний психолог</dt><dd>Кобасенко Ірина Юріївна, каб. 116, консультація за бажанням.</dd></div>' +
    '</div></div></section>';
}

/* ---------- панель вчителя ---------- */
function markInputsHtml(key, list, label) {
  var html = list.map(function (v) {
    return '<input class="mark-input ' + markTone(v) + '" type="number" min="' + SCALE_MIN + '" max="' + SCALE_MAX +
      '" step="1" value="' + esc(v) + '" data-entry="' + esc(key) + '" aria-label="' + esc(label) + '">';
  }).join('');
  if (!list.length) {
    html = '<input class="mark-input" type="number" min="' + SCALE_MIN + '" max="' + SCALE_MAX + '" step="1" value="" ' +
      'placeholder="–" data-entry="' + esc(key) + '" aria-label="' + esc(label) + '">';
  }
  return html;
}

/* Один учень у списку: розгортається у поле, де вчитель ставить бал */
function panelPupilRow(klass, pupil, subject) {
  var key = marksKey(klass, pupil.name, subject);
  var entry = getMarkEntry(klass, pupil.name, subject);
  var avg = avgOf(entry.list);
  var count = entry.list.length;
  return '<details class="row"' + (panelOpenPupil === pupil.name ? ' open' : '') + '><summary><span class="row-main">' +
    '<b>' + esc(pupil.name) + '</b>' +
    '<span class="cfg-title">' + (count
      ? count + ' ' + plural(count, ['бал', 'бали', 'балів']) + ' з предмета ' + esc(subject)
      : 'балів з предмета ' + esc(subject) + ' ще немає') + '</span></span>' +
    '<span class="row-sign">' + (count
      ? markHtml(Math.round(avg)) + ' середній'
      : ic('pen', 'ic-sm') + ' поставити бал') + '</span></summary>' +
    '<div class="row-body">' +
    (count ? '<div class="marks">' + entry.list.map(function (v) { return markHtml(v); }).join('') + '</div>' : '') +
    '<div class="entry-row" style="margin-top:10px"><label>Бали</label>' +
    markInputsHtml(key, entry.list, 'Бал учня ' + pupil.name + ' з предмета ' + subject) +
    '<button class="abtn abtn-sm" type="button" data-action="add-mark" data-entry="' + esc(key) + '">+ бал</button>' +
    '</div><div class="entry-actions">' +
    '<button class="btn-dark btn-sm" type="button" data-action="save-entry" data-entry="' + esc(key) + '" data-name="' +
    esc(pupil.name) + '" data-subject="' + esc(subject) + '">' + ic('check', 'ic-sm') + '<span>Зберегти оцінку</span></button>' +
    '<button class="btn-dark btn-sm btn-ghost-dark" type="button" data-action="clear-entry" data-entry="' + esc(key) + '" data-name="' +
    esc(pupil.name) + '">' + ic('close', 'ic-sm') + '<span>Очистити</span></button></div></div></details>';
}

function teacherPage() {
  var user = currentUser();
  if (!user) return loginNeededHtml('Панель вчителя доступна після входу', 'Увійдіть у профіль педагога або створіть його у розділі «Вхід і реєстрація» з кодом доступу.');
  if (user.role !== 'teacher') {
    return '<section class="workspace">' + breadcrumbHtml('teacher') +
      '<div class="card-panel"><h2>' + ic('lock') + '<span>Панель доступна лише вчителям</span></h2>' +
      '<p>Ваш профіль ' + esc(user.fullName) + ' створено як учнівський. Оцінки виставляє педагог, ' +
      'а учень бачить результат у щоденнику.</p>' +
      '<div class="entry-actions"><a class="btn-dark btn-sm" href="#/diary">' + ic('star') + '<span>Мій щоденник</span></a></div></div></section>';
  }
  var klass = panelKlass;
  var subjects = [];
  classSubjects(klass).forEach(function (s) {
    if (subjects.indexOf(s.name) < 0) subjects.push(s.name);
  });
  if (subjects.indexOf(panelSubject) < 0) panelSubject = subjects[0];
  var query = panelQuery.trim().toLowerCase();
  var pupils = pupilsOfClass(klass).filter(function (p) {
    return !query || p.name.toLowerCase().indexOf(query) > -1;
  });
  var filled = pupils.filter(function (p) { return getMarkEntry(klass, p.name, panelSubject).list.length > 0; }).length;

  var classList = CLASSES.map(function (c) {
    var count = pupilsOfClass(c).length;
    return '<button class="class-row' + (c === klass ? ' on' : '') + '" type="button" data-panel-class="' + esc(c) + '">' +
      '<span class="class-row-name">' + esc(c) + ' клас</span>' +
      '<span class="class-row-meta">' + count + ' ' + plural(count, ['учень', 'учні', 'учнів']) + '</span>' +
      ic('arrow', 'ic-sm') + '</button>';
  }).join('');

  return '<section class="workspace wide">' + breadcrumbHtml('teacher') + flashHtml() +
    '<div class="heading-panel"><div><p class="kicker">' + ic('pen') + '<span>' + esc(user.fullName) + '</span></p>' +
    '<h1 class="page-title">Панель вчителя</h1>' +
    '<p class="page-sub">Спочатку оберіть клас, потім учня зі списку та впишіть йому бали від 1 до 12. ' +
    'Записи залишаються в цьому браузері та одразу з’являються в щоденнику учня з таким самим прізвищем і класом.</p></div>' +
    '<div class="select-line"><a class="btn-dark btn-sm" href="#/diary">' + ic('star') + '<span>Щоденник</span></a></div></div>' +

    '<div class="card-panel"><h2>' + ic('users') + '<span>Класи ліцею</span></h2>' +
    '<p class="small muted">Оберіть клас — нижче з’явиться список його учнів.</p>' +
    '<div class="class-list" role="group" aria-label="Класи">' + classList + '</div></div>' +

    '<div class="card-panel"><h2>' + ic('pen') + '<span>Учні ' + esc(klass) + ' класу</span></h2>' +
    '<div class="select-line">' +
    '<label class="small muted" for="panelSubject">Предмет</label>' +
    '<select id="panelSubject" data-select="panel-subject">' +
    subjects.map(function (s) { return '<option value="' + esc(s) + '"' + (s === panelSubject ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
    '</select>' +
    '<input class="admin-search" id="panelSearch" type="search" placeholder="Пошук учня за прізвищем" ' +
    'aria-label="Пошук учня" value="' + esc(panelQuery) + '" autocomplete="off"></div>' +
    '<p class="small muted">' + esc(klass) + ' клас, ' + esc(panelSubject) + ': ' + pupils.length + ' ' +
    plural(pupils.length, ['учень', 'учні', 'учнів']) + ' у переліку, оцінки мають ' + filled + '.</p>' +
    '<div class="entry-actions">' +
    '<button class="btn-dark btn-sm" type="button" data-action="save-all" data-klass="' + esc(klass) + '" data-subject="' + esc(panelSubject) + '">' +
    ic('check', 'ic-sm') + '<span>Зберегти всі оцінки</span></button>' +
    '<button class="btn-dark btn-sm btn-danger" type="button" data-action="clear-subject" data-klass="' + esc(klass) + '" data-subject="' + esc(panelSubject) + '">' +
    ic('close', 'ic-sm') + '<span>Прибрати бали цього предмета</span></button></div>' +

    (pupils.length
      ? '<div class="row-list">' + pupils.map(function (p) { return panelPupilRow(klass, p, panelSubject); }).join('') + '</div>'
      : '<p class="card-note">' + (query
        ? 'У переліку ' + esc(klass) + ' класу немає учня з таким прізвищем.'
        : 'У переліку ' + esc(klass) + ' класу поки нікого немає. Учень з’явиться тут, коли зареєструється ' +
          'і обере цей клас у щоденнику.') + '</p>') + '</div>' +

    '</section>';
}

/* ---------- 404 ---------- */
function notFoundPage() {
  return '<section class="auth-wrap"><div class="auth-cloud" style="text-align:center">' +
    ic('info', 'ic-lg') +
    '<h2 style="margin:12px 0 6px;font-size:1.3rem">Сторінку не знайдено</h2>' +
    '<p class="small muted">За адресою ' + esc(location.hash || '#/') + ' на порталі ліцею нічого немає. ' +
    'Можливо, розділ перейменовано або посилання втрачено.</p>' +
    '<a class="dashboard-button btn-link" href="#/home">' + ic('cap', 'ic-sm') + '<span>На головну портал</span></a>' +
    '<div class="row-list" style="margin-top:14px;text-align:left">' +
    DRAWER_MAIN.slice(0, 5).map(function (item) {
      return '<div class="row-line"><dt>' + ic(item.icon, 'ic-sm') + '</dt><dd>' +
        '<a href="#/' + item.r + '">' + esc(item.label) + '</a></dd></div>';
    }).join('') + '</div></div></section>';
}

/* ---------- робота з полями балів ---------- */
function keyParts(key) {
  var parts = String(key).split('|');
  return { klass: parts[0], name: parts[1], subject: parts.slice(2).join('|') };
}

function setMarkByKey(key, list) {
  var p = keyParts(key);
  setMarkEntry(p.klass, p.name, p.subject, list);
}

function readMarkInputs(key) {
  var out = [];
  var bad = 0;
  Array.prototype.forEach.call(document.querySelectorAll('.mark-input'), function (input) {
    if (key && input.getAttribute('data-entry') !== key) return;
    var raw = String(input.value).trim();
    if (!raw) { input.classList.remove('bad'); return; }
    var v = Number(raw);
    if (!isFinite(v) || Math.floor(v) !== v || v < SCALE_MIN || v > SCALE_MAX) {
      input.classList.add('bad');
      bad++;
      return;
    }
    input.classList.remove('bad');
    out.push(v);
  });
  return { list: out, bad: bad };
}

function readAllEntries() {
  var groups = {};
  Array.prototype.forEach.call(document.querySelectorAll('.mark-input'), function (input) {
    var key = input.getAttribute('data-entry');
    if (!key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(input);
  });
  return groups;
}

function removeSubjectMarks(klass, subject) {
  var map = loadMarks() || {};
  Object.keys(map).forEach(function (key) {
    var p = keyParts(key);
    if (p.klass === klass && p.subject === subject) delete map[key];
  });
  saveMarks(map);
}

/* ---------- форми ---------- */
function formError(id, msg) {
  var box = document.getElementById(id);
  if (box) box.textContent = msg || '';
}

function bindAuth() {
  var form = document.getElementById('authForm');
  if (!form) return;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var data = new FormData(form);
    var phone = String(data.get('phone') || '').replace(/[^\d+]/g, '');
    var pass = String(data.get('password') || '');
    var users = loadUsers();

    if (authMode === 'register') {
      var fullName = String(data.get('fullName') || '').trim().replace(/\s+/g, ' ');
      var isTeacher = teacherAccess;
      if (fullName.split(' ').length < 2) return formError('authError', 'Вкажіть ПІБ повністю: прізвище та ім’я, бажано по батькові.');
      if (isTeacher && String(data.get('code') || '') !== TEACHER_CODE) return formError('authError', 'Код доступу не підходить, його видає адміністрація ліцею.');
      if (!/^(\+380|380|0)\d{9}$/.test(phone)) return formError('authError', 'Введіть номер у форматі +380 XXX XXX-XX-XX.');
      if (pass.length < 6 || !/\d/.test(pass) || !/[a-zа-яєіїґ]/i.test(pass)) return formError('authError', 'Пароль: щонайменше 6 символів, літери та цифри.');
      if (pass !== String(data.get('password2') || '')) return formError('authError', 'Паролі не збігаються.');
      if (users.some(function (u) { return u.phone === phone; })) return formError('authError', 'Такий номер уже зареєстровано, увійдіть у профіль.');
      var id = 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      var user = {
        id: id,
        fullName: fullName,
        phone: phone,
        pass: passHash(phone, pass),
        role: isTeacher ? 'teacher' : 'pupil',
        teacherName: '',
        klass: '',
        created: new Date().toLocaleString('uk-UA')
      };
      users.push(user);
      saveUsers(users);
      lsSet(LS_SESSION, id);
      if (isTeacher) {
        teacherAccess = false;
        notice = 'Профіль педагога створено, панель оцінювання відкрита.';
        noticeKind = 'success';
        location.hash = '#/teacher';
      } else {
        notice = 'Профіль створено. Оберіть свій клас у щоденнику, і з’явиться перелік предметів.';
        noticeKind = 'success';
        location.hash = '#/diary';
      }
      return;
    }

    var found = users.filter(function (u) { return u.phone === phone; })[0];
    if (!found) return formError('authError', 'Профіль з таким номером не знайдено, пройдіть реєстрацію.');
    if (found.pass !== passHash(phone, pass)) return formError('authError', 'Невірний пароль, спробуйте ще раз.');
    lsSet(LS_SESSION, found.id);
    scheduleClass = found.klass || '';
    if (found.klass) panelKlass = found.klass;
    notice = 'Ви увійшли як ' + found.fullName + '.';
    noticeKind = 'success';
    location.hash = found.role === 'teacher' ? '#/teacher' : '#/diary';
  });
}

function bindPasswordForm() {
  var form = document.getElementById('passForm');
  if (!form) return;
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var user = currentUser();
    if (!user) return;
    var data = new FormData(form);
    var oldPass = String(data.get('old') || '');
    var newPass = String(data.get('new') || '');
    if (passHash(user.phone, oldPass) !== user.pass) return formError('passError', 'Поточний пароль не підходить.');
    if (newPass.length < 6 || !/\d/.test(newPass) || !/[a-zа-яєіїґ]/i.test(newPass)) {
      return formError('passError', 'Новий пароль: від 6 символів, літери та цифри.');
    }
    updateUser(user.id, { pass: passHash(user.phone, newPass) });
    form.reset();
    formError('passError', '');
    notice = 'Пароль оновлено.';
    noticeKind = 'success';
    render();
  });
}

/* ---------- вибір класу, теми та предметів ---------- */
function chooseKlass(user, klass) {
  var value = normClass(klass);
  if (!value) {
    notice = 'Клас не вибрано, перелік предметів лишився порожнім.';
    noticeKind = 'info';
    return;
  }
  updateUser(user.id, { klass: value });
  scheduleClass = value;
  panelKlass = value;
  notice = 'Збережено: ' + value + ' клас. Щоденник показує ' + classSubjects(value).length + ' предметів.';
  noticeKind = 'success';
}

/* ---------- реєстрація сторінок ---------- */
PAGES.home = homePage;
PAGES.history = historyPage;
PAGES.students = studentsPage;
PAGES.teachers = teachersPage;
PAGES.schedule = schedulePage;
PAGES.news = newsPage;
PAGES.gallery = galleryPage;
PAGES.dining = diningPage;
PAGES.admissions = admissionsPage;
PAGES.contacts = contactsPage;
PAGES.auth = authPage;
PAGES.profile = profilePage;
PAGES.diary = diaryPage;
PAGES.teacher = teacherPage;
PAGES.notfound = notFoundPage;

function appendMarkInput(key) {
  var own = Array.prototype.filter.call(document.querySelectorAll('.mark-input'), function (input) {
    return input.getAttribute('data-entry') === key;
  });
  if (!own.length) return;
  var field = document.createElement('input');
  field.className = 'mark-input';
  field.type = 'number';
  field.min = String(SCALE_MIN);
  field.max = String(SCALE_MAX);
  field.step = '1';
  field.placeholder = '–';
  field.setAttribute('data-entry', key);
  field.setAttribute('aria-label', 'Додатковий бал');
  own[own.length - 1].insertAdjacentElement('afterend', field);
  field.focus();
}

function saveEntry(key, label, subject) {
  var res = readMarkInputs(key);
  if (res.bad) {
    notice = 'Перевірте підсвічені поля: бал цілий, від ' + SCALE_MIN + ' до ' + SCALE_MAX + '.';
    noticeKind = 'info';
    render();
    return;
  }
  setMarkByKey(key, res.list);
  panelOpenPupil = label;
  notice = res.list.length
    ? 'Збережено ' + res.list.length + ' ' + plural(res.list.length, ['бал', 'бали', 'балів']) + ' для ' + label + ' (' + subject + ').'
    : 'Оцінки для ' + label + ' (' + subject + ') прибрано.';
  noticeKind = 'success';
  render();
}

function saveAllEntries() {
  var groups = readAllEntries();
  var bad = document.querySelectorAll('.mark-input.bad').length;
  if (bad) {
    notice = 'Деякі поля підсвічено: бал має бути цілим числом від ' + SCALE_MIN + ' до ' + SCALE_MAX + '.';
    noticeKind = 'info';
    render();
    return;
  }
  var keys = Object.keys(groups);
  var total = 0;
  var filled = 0;
  keys.forEach(function (key) {
    var list = [];
    groups[key].forEach(function (input) {
      var raw = String(input.value).trim();
      if (!raw) return;
      var v = Number(raw);
      if (v >= SCALE_MIN && v <= SCALE_MAX) list.push(v);
    });
    setMarkByKey(key, list);
    if (list.length) filled++;
    total += list.length;
  });
  notice = 'Журнал оновлено: ' + filled + ' ' + plural(filled, ['учень', 'учні', 'учнів']) +
    ', виставлено ' + total + ' ' + plural(total, ['бал', 'бали', 'балів']) + '.';
  noticeKind = 'success';
  render();
}

function copyContacts() {
  var text = SCHOOL.full + ', ' + SCHOOL.address + '. Приймальня ' + SCHOOL.phone + ', ' + SCHOOL.email +
    ', ЄДРПОУ ' + SCHOOL.edrpou + '.';
  var done = function () {
    notice = 'Реквізити ліцею скопійовано в буфер обміну.';
    noticeKind = 'success';
    render();
  };
  var failed = function () {
    notice = 'Браузер не дав доступ до буфера обміну, скопіюйте текст зі сторінки вручну.';
    noticeKind = 'info';
    render();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, failed);
  } else {
    failed();
  }
}

function doLogout() {
  lsSet(LS_SESSION, '');
  scheduleClass = '';
  notice = 'Ви вийшли з профілю, дані лишилися в цьому браузері.';
  noticeKind = 'info';
  if (location.hash === '#/profile' || location.hash === '#/diary' || location.hash === '#/teacher') {
    location.hash = '#/home';
  } else {
    render();
  }
}

function deleteAccount() {
  var user = currentUser();
  if (!user) return;
  if (!window.confirm('Видалити профіль ' + user.fullName + ' з цього браузера? Оцінки вчителя залишаться, але акаунт повернути не можна.')) return;
  saveUsers(loadUsers().filter(function (u) { return u.id !== user.id; }));
  lsSet(LS_SESSION, '');
  scheduleClass = '';
  notice = 'Профіль ' + user.fullName + ' видалено з цього браузера.';
  noticeKind = 'info';
  location.hash = '#/home';
}

/* ---------- обробники подій ---------- */
document.addEventListener('click', function (ev) {
  var target = ev.target;
  var el = target && target.closest
    ? target.closest('[data-auth-tab],[data-teacher-access],[data-nav-filter],[data-teacher-filter],[data-class-chip],[data-panel-class],[data-dining-day],[data-action]')
    : null;
  if (!el) return;

  if (el.hasAttribute('data-auth-tab')) {
    authMode = el.getAttribute('data-auth-tab');
    if (authMode === 'login') teacherAccess = false;
    render();
    return;
  }
  if (el.hasAttribute('data-teacher-access')) {
    teacherAccess = !teacherAccess;
    render();
    return;
  }
  if (el.hasAttribute('data-nav-filter')) {
    navFilter = el.getAttribute('data-nav-filter');
    render();
    return;
  }
  if (el.hasAttribute('data-teacher-filter')) {
    teacherFilter = el.getAttribute('data-teacher-filter');
    render();
    return;
  }
  if (el.hasAttribute('data-class-chip')) {
    scheduleClass = el.getAttribute('data-class-chip');
    render();
    return;
  }
  if (el.hasAttribute('data-panel-class')) {
    panelKlass = el.getAttribute('data-panel-class');
    panelOpenPupil = '';
    render();
    return;
  }
  if (el.hasAttribute('data-dining-day')) {
    diningDay = Number(el.getAttribute('data-dining-day')) || 0;
    render();
    return;
  }
  var action = el.getAttribute('data-action');
  var key = el.getAttribute('data-entry') || '';
  var klass = el.getAttribute('data-klass') || panelKlass;
  var subject = el.getAttribute('data-subject') || panelSubject;

  if (action === 'logout') { doLogout(); return; }
  if (action === 'delete-account') { deleteAccount(); return; }
  if (action === 'copy-contacts') { copyContacts(); return; }
  if (action === 'close-nav') { setDrawer(false); return; }
  if (action === 'add-mark') { appendMarkInput(key); return; }
  if (action === 'save-entry') { saveEntry(key, el.getAttribute('data-name') || 'учня', el.getAttribute('data-subject') || subject); return; }
  if (action === 'clear-entry') {
    setMarkByKey(key, []);
    panelOpenPupil = el.getAttribute('data-name') || '';
    notice = 'Оцінки прибрано, учень залишився без балів з цього предмета.';
    noticeKind = 'info';
    render();
    return;
  }
  if (action === 'save-all') { saveAllEntries(); return; }
  if (action === 'clear-subject') {
    if (!window.confirm('Прибрати всі бали з предмета «' + subject + '» для ' + klass + ' класу?')) return;
    removeSubjectMarks(klass, subject);
    notice = 'Бали предмета «' + subject + '» для ' + klass + ' класу прибрано.';
    noticeKind = 'info';
    render();
  }
});

document.addEventListener('change', function (ev) {
  var el = ev.target;
  if (!el || !el.getAttribute) return;
  var which = el.getAttribute('data-select');
  if (which) {
    var user = currentUser();
    if (which === 'diary-klass') {
      if (user) chooseKlass(user, el.value);
      render();
      return;
    }
    if (which === 'panel-subject') { panelSubject = el.value; panelOpenPupil = ''; render(); return; }
  }
  if (el.type === 'checkbox' && el.hasAttribute('data-hw')) {
    toggleHomework(el.getAttribute('data-hw'), el.checked);
    var row = el.closest ? el.closest('.cfg-row') : null;
    if (row) row.classList.toggle('done', el.checked);
    return;
  }
  if (el.className && el.className.indexOf('mark-input') > -1) {
    var raw = String(el.value).trim();
    if (!raw) {
      el.classList.remove('bad');
      el.classList.remove('low', 'mid', 'top');
      return;
    }
    var v = Number(raw);
    var wrong = !(isFinite(v) && Math.floor(v) === v && v >= SCALE_MIN && v <= SCALE_MAX);
    el.classList.toggle('bad', wrong);
    el.classList.remove('low', 'mid', 'top');
    if (!wrong) el.classList.add(markTone(v));
  }
});

document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && isDrawerOpen()) {
    setDrawer(false);
    var burger = document.getElementById('navBurger');
    if (burger) burger.focus();
  }
});

/* ---------- запуск ---------- */
function boot() {
  var user = currentUser();
  if (user) {
    scheduleClass = user.klass || '';
    if (user.klass) panelKlass = user.klass;
  } else if (!lsGet(LS_SESSION)) {
    panelKlass = '7-В';
  }
  applyTheme(currentTheme());

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('navBurger').addEventListener('click', function () {
    setDrawer(!isDrawerOpen());
  });

  window.addEventListener('hashchange', render);
  window.addEventListener('resize', moveAuthThumb);

  render();

  if (location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн-кеш недоступний */ });
    });
  }
}

boot();
