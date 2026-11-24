'use strict';

var app = document.getElementById('app');
var user = null;
var accountStatus = 'loading';
var sessionRevision = 0;
var route = '';
var revision = 0;
var pageData = null;
var pageError = '';
var authMode = 'login';
var teacherAccess = false;
var navFilter = 'all';
var schoolDate = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'long' });
var clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
var civilDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
var scheduleClass = '5-А';
var scheduleDay = Math.min(4, Math.max(0, schoolDay() - 1));
var journalClass = '5-А';
var journalSubject = 'Українська мова';
var journalQuery = '';
var newsPosts = [];
var newsAt = 0;
var newsRequest;
var ROLE_NAMES = { pupil: 'Учень', teacher: 'Учитель', admin: 'Адміністрація' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function ic(name) {
  return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

function link(href, title) {
  return '<a class="abtn" href="' + esc(href) + '">' + esc(title) + '</a>';
}

function card(title, content, id) {
  return '<section class="card-panel"' + (id ? ' id="' + id + '"' : '') + '><h2>' + esc(title) + '</h2>' + content + '</section>';
}

function heading(title, summary) {
  return '<div class="heading-panel"><div><h1 class="page-title">' + esc(title) + '</h1>' +
    (summary ? '<p class="page-sub">' + esc(summary) + '</p>' : '') + '</div></div>';
}

function rows(items) {
  return '<dl class="row-list">' + items.map(function (item) {
    return '<div class="row-line"><dt>' + esc(item[0]) + '</dt><dd>' + esc(item[1]) + '</dd></div>';
  }).join('') + '</dl>';
}

function actions(links) {
  return '<div class="entry-actions">' + links.map(function (item) { return link(item[0], item[1]); }).join('') + '</div>';
}

function classesHtml(selected, prompt) {
  return (prompt ? '<option value="">Оберіть клас</option>' : '') + CLASSES.map(function (klass) {
    return '<option' + (klass === selected ? ' selected' : '') + '>' + esc(klass) + '</option>';
  }).join('');
}

function shortName(name) {
  var parts = name.split(' ');
  return [parts[0]].concat(parts.slice(1).map(function (part) { return part.charAt(0) + '.'; })).join(' ');
}

function schoolDay() {
  var iso = civilDate.format(new Date());
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

function minutes(time) {
  var parts = time.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

function timeString(value) {
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
}

async function api(path, method, body) {
  if (!/^https?:$/.test(location.protocol)) throw new Error('Особистий кабінет доступний через сервер порталу.');
  var response = await fetch('/api/' + path, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Сервер особистого кабінету недоступний.');
  var data = await response.json();
  if (!response.ok) {
    var error = new Error(data.error || 'Не вдалося виконати дію.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeColor').content = theme === 'dark' ? '#050505' : '#f4f6f9';
  document.getElementById('themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
  document.getElementById('themeToggle').setAttribute('aria-label', theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему');
}

function initBackground() {
  var video = document.getElementById('siteVideo');
  if (!video?.dataset.src) return;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var allowed = !motion.matches && !navigator.connection?.saveData;
  function update() {
    if (!allowed || document.hidden) video.pause();
    else video.play().catch(function () {});
  }
  video.addEventListener('playing', function () {
    document.documentElement.classList.add('video-playing');
  });
  video.addEventListener('error', function () {
    document.documentElement.classList.remove('video-playing');
  });
  motion.addEventListener('change', function () {
    allowed = !motion.matches && !navigator.connection?.saveData;
    if (allowed && !video.getAttribute('src')) video.src = video.dataset.src;
    if (!allowed) document.documentElement.classList.remove('video-playing');
    update();
  });
  document.addEventListener('visibilitychange', update);
  if (allowed) {
    video.src = video.dataset.src;
    update();
  }
}

function normalizeNews(post) {
  var url;
  try { url = new URL(post?.link); } catch { return null; }
  if (url.origin !== new URL(OFFICIAL).origin) return null;
  var date = post.date?.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  var decode = function (html) {
    var fragment = document.createElement('template');
    fragment.innerHTML = String(html || '');
    return fragment.content.textContent.replace(/\s+/g, ' ').trim();
  };
  var text = decode(post.excerpt?.rendered);
  var title = decode(post.title?.rendered);
  var known = NEWS.find(function (item) { return item.url === url.href; });
  return { url: url.href, date: date, tag: known?.tag, title: known?.title || title || text.split(/[.!?…]/)[0].slice(0, 90) || 'Оголошення ліцею', text: known?.text || text };
}

function recentNews() {
  var today = civilDate.format(new Date());
  var end = new Date(today + 'T12:00:00Z');
  var target = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  var last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(end.getUTCDate(), last));
  var cutoff = target.toISOString().slice(0, 10);
  var merged = new Map(NEWS.concat(newsPosts).map(function (post) { return [post.id || post.url, post]; }));
  return Array.from(merged.values()).filter(function (post) {
    return (NEWS.includes(post) || post.date >= cutoff) && post.date <= today;
  }).sort(function (a, b) { return b.date.localeCompare(a.date); });
}

function loadNews() {
  if (newsRequest || Date.now() - newsAt < 30 * 60_000 || !navigator.onLine) return;
  if (!/^https?:$/.test(location.protocol)) return;
  newsAt = Date.now();
  newsRequest = api('news').catch(function () {
    return fetch(SOURCES.newsApi, { signal: AbortSignal.timeout(5000) }).then(function (response) {
      if (!response.ok) throw new Error();
      return response.json();
    }).then(function (posts) { return { posts: posts }; });
  }).then(function (data) {
    if (!Array.isArray(data.posts)) return;
    if (!data.posts.length) newsAt = Date.now() - 29 * 60_000;
    newsPosts = data.posts.map(normalizeNews).filter(Boolean);
    if (route === 'home' || route === 'news') renderNews();
  }).catch(function () { newsAt = Date.now() - 29 * 60_000; }).finally(function () { newsRequest = null; });
}

function renderNews() {
  var target = document.getElementById('newsList');
  if (!target) return;
  var posts = recentNews();
  var home = route === 'home';
  var content = posts.map(function (post) {
    var date = post.date.split('-').reverse().join('.');
    var time = '<time datetime="' + esc(post.date) + '">' + date + '</time>';
    if (home) return '<article class="news-item"><header><h3>' + ic('news') + esc(post.title) + '</h3>' + time +
      '</header><p>' + esc(post.text) + '</p></article>';
    return '<details class="row news-story"><summary><span class="row-main"><span class="news-tag">' +
      esc(post.tag || 'Ліцей') + '</span><strong>' + esc(post.title) + '</strong></span>' +
      '<span class="row-sign">' + time + ic('arrow') + '</span></summary><div class="row-body"><p>' + esc(post.text) + '</p></div></details>';
  }).join('');
  if (target.renderedNews === content) return;
  target.renderedNews = content;
  if (!posts.length) {
    target.innerHTML = '<p class="muted">За останній місяць немає опублікованих новин.</p>';
  } else if (home && posts.length > 1) {
    // Друга копія забезпечує безперервний перехід через кінець стрічки.
    target.innerHTML = '<div class="news-window"><div class="news-track"><div>' + content +
      '</div><div aria-hidden="true" inert>' + content + '</div></div></div>';
    target.style.setProperty('--ticker-duration', posts.length * 10.7 + 's');
  } else {
    target.innerHTML = '<div class="row-list">' + content + '</div>';
  }
}

var NAV = [
  ['home', 'Головна', 'cap'], ['schedule', 'Розклад', 'clock'], ['diary', 'Щоденник', 'star'],
  ['teachers', 'Вчителі', 'users'], ['news', 'Новини', 'news'], ['students', 'Учням', 'book'],
  ['contacts', 'Контакти', 'pin']
];

function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
  var burger = document.getElementById('navBurger');
  burger.setAttribute('aria-expanded', String(open));
  burger.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
}

function navItem(item, icons) {
  return '<a class="nav-link' + (route === item[0] ? ' active' : '') + '" href="#/' + item[0] + '"' +
    (route === item[0] ? ' aria-current="page"' : '') + '>' + (icons ? ic(item[2]) : '') + '<span>' + esc(item[1]) + '</span></a>';
}

function renderNav() {
  var extra = [['history', 'Історія ліцею', 'book'], ['admissions', 'Зарахування', 'door'], ['dining', 'Харчування', 'bowl'], ['gallery', 'Вигляд ліцею', 'palette']];
  var account = user ? [['profile', 'Профіль', 'gear']] : [['auth', 'Вхід і реєстрація', 'login']];
  if (user?.role === 'teacher') account.push(['teacher', 'Панель учителя', 'pen']);
  if (user?.role === 'admin') account.push(['admin', 'Адміністрування', 'lock']);
  document.getElementById('navLinks').innerHTML = NAV.map(function (item) { return navItem(item, false); }).join('');
  document.getElementById('navDrawer').innerHTML = NAV.concat(extra, account).map(function (item) { return navItem(item, true); }).join('') +
    (user ? '<button type="button" class="abtn" data-action="logout">Вийти</button>' : '');
  document.getElementById('navUser').innerHTML = user ?
    '<a class="btn-nav-profile" href="#/profile" aria-label="Профіль ' + esc(user.fullName) + '">' + ic('users') +
    '<span class="nav-username">' + esc(shortName(user.fullName)) + '</span></a>' :
    '<a class="btn-nav-auth" href="#/auth">' + ic('login') + '<span>Увійти</span></a>';
}

function homePage() {
  var items = NAV_CARDS.map(function (entry) {
    return '<a class="card" data-category="' + entry[0] + '" data-search="' + esc((entry[2] + ' ' + entry[3]).toLowerCase()) +
      '" href="#/' + entry[4] + '"><div class="card-cloud"><span class="card-ico">' + ic(entry[1]) +
      '</span><h3>' + esc(entry[2]) + '</h3><p>' + esc(entry[3]) + '</p></div></a>';
  }).join('');
  var destination = user?.role === 'admin' ? ['admin', 'Адміністрування'] :
    user?.role === 'teacher' ? ['teacher', 'Панель учителя'] : ['diary', 'Мій щоденник'];
  return '<section class="hero"><div class="hero-text-container"><h1>Lyceum N21</h1><p>Житомирський міський ліцей №21. Портал ліцею: розклад, оцінки, вчителі та новини в одному вікні браузера.</p>' +
    '<div class="hero-actions">' + link(user ? '#/' + destination[0] : '#/auth', user ? destination[1] : 'Увійти до щоденника') +
    link('#/schedule', 'Розклад дзвінків') + link('#/history', 'Історія ліцею') + '</div></div></section>' +
    '<p class="promo-showcase">Навігація порталом: оберіть розділ або скористайтеся пошуком. Оцінки, домашні завдання та розклад зібрано в окремій вкладці «Щоденник».</p>' +
    '<section class="nav-panel"><div class="nav-panel-head"><h2>Що вас цікавить?</h2>' +
    '<input class="cg-search" id="navSearch" type="search" placeholder="Пошук за розділами: оцінки, меню, вакансії" aria-label="Пошук за розділами порталу"></div>' +
    '<div class="filter-tabs" role="group" aria-label="Категорії розділів">' +
    Object.keys(NAV_CATS).map(function (key) { return '<button class="ftab" type="button" data-category-filter="' + key + '">' + esc(NAV_CATS[key]) + '</button>'; }).join('') +
    '</div><div class="cards" id="portalCards">' + items + '</div><p id="emptyCards" class="muted" hidden>Розділів не знайдено.</p></section>' +
    card('Новини та оголошення ліцею', '<div id="newsList"></div>' + actions([['#/news', 'Усі актуальні новини']])) +
    card('Ліцей у цифрах', rows([['Рік заснування', SCHOOL.founded], ['Учителів за даними АІКОМ', SCHOOL.teachers], ['Максимальний бал у 5–9 класах', 12]]));
}

function filterCards() {
  var search = document.getElementById('navSearch');
  if (!search) return;
  var query = search.value.trim().toLowerCase();
  var visible = 0;
  document.querySelectorAll('[data-category-filter]').forEach(function (button) {
    var active = button.dataset.categoryFilter === navFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('#portalCards .card').forEach(function (item) {
    item.hidden = (navFilter !== 'all' && item.dataset.category !== navFilter) || !item.dataset.search.includes(query);
    if (!item.hidden) visible++;
  });
  document.getElementById('emptyCards').hidden = visible > 0;
}

function historyPage() {
  return heading('Біографія ліцею', 'Школу № 21 у Житомирі відкрито у 1962 році. Сьогодні це комунальний ліцей із початковою школою та гімназією.') +
    card('Директорський склад', '<div class="timeline">' + DIRECTORS.map(function (director) {
      return '<div class="tl-item"><p class="tl-years">' + esc(director[0]) + '</p><p class="tl-name">' + esc(director[1]) +
        '</p><p class="tl-note">' + esc(director[2]) + '</p></div>';
    }).join('') + '</div>') +
    card('Сучасний ліцей', rows([['Тип закладу', 'Ліцей з початковою школою та гімназією'],
      ['Підпорядкування', 'Департамент освіти Житомирської міської ради'], ['Мова навчання', 'Українська'],
      ['ЄДРПОУ', SCHOOL.edrpou], ['Учителів за даними АІКОМ', SCHOOL.teachers], ['Адреса', SCHOOL.address], ['Директор', SCHOOL.director]]));
}

function curatorsCard() {
  return card('Класні керівники', '<ul class="curator-list" tabindex="0" aria-label="Класні керівники за класами">' + CLASSES.map(function (klass) {
      return '<li><strong>' + esc(klass) + '</strong><span>' + esc(CLASS_CURATORS[klass]) + '</span></li>';
    }).join('') + '</ul>', 'curators');
}

function teachersPage() {
  return heading('Вчителі та працівники ліцею', 'Педагогічний склад і графік прийому адміністрації.') +
    card('Адміністрація та графік прийому', rows(ADMINISTRATION.map(function (entry) { return [entry[1], entry[0]]; })) +
      rows([['Прийом громадян', SCHOOL.reception], ['Графік роботи', SCHOOL.hours], ['Приймальня', SCHOOL.phone + ', ' + SCHOOL.email]]), 'admin') +
    card('Відкриті вакансії', '<p>Щоб дізнатися про наявні вакансії або подати резюме, напишіть до приймальні на ' + esc(SCHOOL.email) + '.</p>') + curatorsCard();
}

function contactsPage() {
  var contacts = [['Адреса', SCHOOL.address], ['Район', 'Корольовський район, м. Житомир'], ['Приймальня', SCHOOL.phone],
    ['Електронна пошта', SCHOOL.email], ['ЄДРПОУ', SCHOOL.edrpou],
    ['Графік роботи', SCHOOL.hours], ['Прийом громадян', SCHOOL.reception], ['Директор', SCHOOL.director]];
  return heading('Контакти ліцею', 'Напишіть або зателефонуйте до приймальні. З питаннями свого класу звертайтеся до класного керівника.') +
    card('Реквізити та зв’язок', rows(contacts) + '<div class="contact-actions">' +
      actions([['tel:' + SCHOOL.phoneRaw, 'Зателефонувати'], ['mailto:' + SCHOOL.email, 'Написати листа']]) +
      '<button class="abtn" type="button" data-action="copy-contacts">Скопіювати реквізити</button></div><p role="status" id="copyStatus"></p>') +
    card('Як дістатися', '<p>Ліцей розташований на вулиці Святослава Ріхтера, 6-а, у Житомирі.</p>' +
      actions([['https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(SCHOOL.address), 'Прокласти маршрут']])) +
    card('Куди звертатися далі', rows([['Департамент освіти Житомирської міської ради', '(0412) 47-03-94'],
      ['Гаряча лінія міста', '15-80 або (0412) 48-14-81'],
      ['Питання щодо HUMAN', 'Служба підтримки в особистому кабінеті платформи.']])) + curatorsCard();
}

function studentsPage() {
  var rules = [
    ['Правила для учнів', 'Якщо перший урок о 8:00, приходьте до 7:50. Беріть із собою підручники й зошити та бережіть майно ліцею. Про заплановану відсутність завчасно повідомте класного керівника.'],
    ['Одяг та форма', 'Ліцей рекомендує охайний повсякденний одяг. Перед фізкультурою переодягніться у спортивну форму та перевзуйтеся у спортивне взуття.'],
    ['Харчування', 'Меню на день та умови пільгового харчування можна уточнити у класного керівника або в приймальні.'],
    ['Безпека під час тривоги', 'Під час повітряної тривоги прямуйте до укриття разом з учителем і залишайтеся зі своїм класом.'],
    ['Поведінка в мережі', 'Зберігайте пароль у таємниці. Перш ніж поширювати особисті дані або фото однокласників, запитайте їхньої згоди.']
  ];
  return heading('Учням ліцею', 'Пам’ятки, режим дня, атестація, підтримка психолога та гуртки. Усі розділи зібрано списками, щоб швидко знайти потрібне.') +
    card('Режим навчального дня', '<p>Перша зміна починається о 8:00, заняття четвертих класів — о 13:05. Між шостим і сьомим уроками першої зміни перерва триває 15 хвилин, з 13:50 до 14:05.</p>' +
      actions([['#/schedule', 'Розклад уроків і дзвінків']]), 'schedule-note') +
    card('Пам’ятки та правила', '<div class="row-list">' + rules.map(function (item) {
      return '<details class="row"><summary><b class="row-main">' + esc(item[0]) + '</b></summary><p class="row-body">' + esc(item[1]) + '</p></details>';
    }).join('') + '</div>', 'safety') +
    card('Державна підсумкова атестація', '<p>Умови проведення ДПА у випускних класах залежать від навчального року. Предмети, строки й порядок підготовки уточнюйте у класного керівника.</p>', 'dpa') +
    card('Психолог, медкабінет і соціальний педагог', rows([
      ['Практичний психолог', 'Зверніться, якщо вас турбують стосунки з однолітками, тривога або труднощі в навчанні.'],
      ['Соціальний педагог', 'Допомагає учням і родинам із питаннями підтримки та адаптації.'],
      ['Медичний кабінет', 'Якщо під час уроку погіршилося самопочуття, повідомте вчителя.']
    ]) + '<p>Як зв’язатися з фахівцем, підкаже приймальня за номером ' + esc(SCHOOL.phone) + '.</p>', 'help') +
    card('Гуртки та секції', '<p>На заняттях HK Unicorn Squad дівчата віком 8–11 років збирають моделі й випробовують їх у команді. Заняття в ліцеї заплановано на четвер з 16:00 до 17:30. Запис та наявність місць уточнюйте у керівника гуртка.</p>', 'gurki') +
    card('Як користуватися щоденником', '<ol><li>Зареєструйтеся у розділі «Вхід і реєстрація» та оберіть свій клас.</li>' +
      '<li>Відкрийте «Щоденник», щоб переглянути оцінки з кожного предмета, середній бал і домашні завдання.</li>' +
      '<li>Оцінки виставляє вчитель у власній панелі. У розділі «Розклад» ви побачите уроки свого класу.</li></ol>' +
      actions([['#/auth', 'Створити профіль'], ['#/diary', 'Відкрити щоденник']]));
}

function admissionsPage() {
  return heading('Зарахування до ліцею', 'Прийом учнів, документи та форми навчання.') +
    card('Перелік документів', '<p>Подайте заяву до приймальні. Підготуйте свідоцтво про народження дитини або інший документ, що посвідчує її особу. Для підтвердження проживання на території обслуговування закладу підготуйте відповідний документ.</p>') +
    card('Форми навчання', rows([['Очна форма', 'Навчання у корпусі ліцею за розкладом.'], ['Сімейна освіта', 'Родина організовує навчання, ліцей проводить оцінювання.'],
      ['Індивідуальна форма', 'Умови переходу та графік консультацій родина узгоджує із закладом.']])) +
    card('Заява: зразок тексту', '<p>Директору Ліцею № 21 міста Житомира<br>від ____________________</p><p>Прошу зарахувати мою дитину ____________________ до ____ класу на __________ навчальний рік.</p><p>Дата ____________ Підпис ____________</p>') +
    card('Строки та питання', '<p>Кількість вільних місць і строки подання документів уточнюйте у приймальні. Телефон ' + esc(SCHOOL.phone) + '.</p>');
}

function diningPage() {
  return heading('Меню їдальні на тиждень', 'Зразок меню з попередньої версії порталу. Страви та ціни на сьогодні уточнюйте в їдальні.') +
    MENU.map(function (day) { return card(day.day, rows(day.items)); }).join('') +
    card('Пільгове харчування', '<p>З питаннями про пільги й документи звертайтеся до класного керівника або в приймальню.</p>') +
    card('Поради щодо здорового харчування', '<p>Обирайте воду, додавайте до раціону овочі та фрукти. Питання щодо алергій і спеціального харчування завчасно обговоріть із працівниками закладу.</p>');
}

function galleryPage() {
  return heading('Вигляд ліцею', 'Будівля, центральний вхід і подвір’я Ліцею № 21 міста Житомира. Натисніть на фото, щоб відкрити його повністю.') +
    '<div class="gallery-grid">' + [
      ['assets/photos/liceum-facade.jpg', 'Головний фасад', 'Чотириповерховий корпус ліцею з боку вулиці Святослава Ріхтера: центральний вхід і двір перед ним.'],
      ['assets/photos/liceum-entrance.jpg', 'Вхід і подвір’я', 'Центральний вхід та алея до нього влітку: огорожа, дерева й майданчик перед дверима.']
    ].map(function (photo) {
      return '<figure class="gallery-card"><a href="' + photo[0] + '" target="_blank" rel="noopener"><img src="' + photo[0] +
        '" alt="' + photo[1] + '" loading="lazy"></a><figcaption><strong>' + photo[1] + '</strong><p>' + photo[2] + '</p></figcaption></figure>';
    }).join('') + '</div>' + actions([['#/contacts', 'Як дістатися']]);
}

function newsPage() {
  return heading('Новини ліцею', 'Розгорніть потрібну новину, щоб прочитати більше.') +
    card('Останні новини', '<div id="newsList"></div>');
}

// Предмети розподіляються на п’ять днів за орієнтовним тижневим навантаженням.
function sampleWeek(klass) {
  var hours = GRADE_HOURS[classGrade(klass)];
  var week = DAYS.map(function () { return []; });
  var offset = klass.charCodeAt(klass.length - 1) % DAYS.length;
  Object.entries(hours).sort(function (a, b) { return b[1] - a[1]; }).forEach(function (entry) {
    for (var count = 0; count < entry[1]; count++) {
      var candidates = week.map(function (lessons, index) {
        var copies = lessons.filter(function (name) { return name === entry[0]; }).length;
        return { index: index, weight: copies * 100 + lessons.length * 10 + (index + DAYS.length - offset) % DAYS.length };
      }).sort(function (a, b) { return a.weight - b.weight; });
      var index = candidates[0].index;
      week[index].push(entry[0]);
      offset = (index + 1) % DAYS.length;
    }
  });
  return week.map(function (lessons) {
    return lessons.sort(function (a, b) { return Number(a === 'Фізична культура') - Number(b === 'Фізична культура'); });
  });
}

function scheduleSlots(klass) {
  return classGrade(klass) === 4 ? BELL.slice(5) : BELL;
}

function timeline(slots, names) {
  return '<ol class="schedule-timeline">' + slots.map(function (slot, index) {
    var next = slots[index + 1];
    var length = minutes(slot[1]) - minutes(slot[0]);
    var label = names ? names[index] || 'Вільне вікно' : (index + 1) + '-й урок';
    var item = '<li class="schedule-lesson" data-start="' + slot[0] + '" data-end="' + slot[1] + '"><span class="schedule-time">' +
      slot[0] + '–' + slot[1] + '</span><div><strong>' + esc(label) + '</strong><span>' + length + ' хв</span></div></li>';
    if (next && minutes(next[0]) > minutes(slot[1])) {
      item += '<li class="schedule-break" data-start="' + slot[1] + '" data-end="' + next[0] + '"><span class="schedule-time">' +
        slot[1] + '–' + next[0] + '</span><div><strong>Перерва</strong><span>' + (minutes(next[0]) - minutes(slot[1])) + ' хв</span></div></li>';
    }
    return item;
  }).join('') + '</ol>';
}

function schedulePage() {
  var pupil = user?.role === 'pupil';
  var klass = pupil ? user.klass : scheduleClass;
  var grade = classGrade(klass);
  var posted = CLASS_SCHEDULES[klass];
  var week = posted || sampleWeek(klass);
  var lessons = week[scheduleDay];
  var bell = scheduleSlots(klass);
  var duration = grade === 1 ? 35 : grade <= 4 ? 40 : 45;
  var slots = bell.slice(0, lessons.length).map(function (slot) {
    return [slot[0], timeString(minutes(slot[0]) + duration)];
  });
  return heading('Розклад', posted ? klass + ' клас' : klass + ' клас · Орієнтовний тижневий план') +
    '<div class="schedule-layout"><section class="card-panel schedule-main"><div class="schedule-head">' +
    '<div><h2>Уроки</h2><p class="muted">' + (posted ? 'Навчальний план класу' : 'Зразок за типовою програмою МОН') + '</p></div>' +
    (pupil ? '<span class="schedule-class">' + esc(klass) + ' клас</span>' :
      '<label class="select-line">Клас <select id="scheduleClass">' + classesHtml(klass) + '</select></label>') +
    '</div><div class="schedule-days" role="group" aria-label="Дні навчального тижня">' + DAYS.map(function (name, index) {
      return '<button type="button" data-day="' + index + '" aria-pressed="' + (index === scheduleDay) +
        '" aria-label="' + esc(name) + '"><span class="day-full">' + esc(name) + '</span><span class="day-short" aria-hidden="true">' +
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'][index] + '</span></button>';
    }).join('') + '</div><h3 class="schedule-day-title">' + esc(DAYS[scheduleDay]) + '</h3>' +
    (lessons.length ? timeline(slots, lessons) : '<p class="muted">У цей день уроків немає.</p>') +
    (posted ? '' : '<p class="schedule-note muted">Фактичний порядок уроків перевіряйте в HUMAN або в класного керівника.</p>' +
      actions([[SOURCES.humanLogin, 'Увійти в HUMAN']])) +
    '</section><aside class="card-panel schedule-bells"><h2>Розклад дзвінків</h2><p class="muted">2026/2027 · ' +
    (grade === 4 ? 'Підзмінок' : 'Перша зміна') + '</p>' + timeline(bell) +
    (grade <= 4 ? '<p class="schedule-note muted">Офіційна сітка показує час дзвінків. Тривалість занять для цієї паралелі — ' + duration + ' хв.</p>' : '') +
    '</aside></div>';
}

function highlightTime() {
  if (route !== 'schedule') return;
  var weekday = schoolDay();
  var now = clock.format(new Date());
  document.querySelectorAll('.schedule-timeline [data-start]').forEach(function (slot) {
    var today = slot.closest('.schedule-bells') || weekday === scheduleDay + 1;
    slot.classList.toggle('is-current', Boolean(today && weekday >= 1 && weekday <= 5 && now >= slot.dataset.start && now < slot.dataset.end));
  });
}

function loadingCard() {
  if (pageError) return card('Дані недоступні', '<p role="alert">' + esc(pageError) +
    '</p><button class="abtn" type="button" data-action="retry">Повторити</button>');
  return '<p class="card-panel" role="status">Завантаження…</p>';
}

function restricted(title) {
  if (accountStatus === 'loading') return loadingCard();
  return heading(title) + card(user ? 'Потрібна інша роль' : 'Потрібно увійти',
    '<p>' + esc(user ? 'Цей розділ недоступний для вашої ролі.' : 'Увійдіть до профілю, щоб відкрити цей розділ.') +
    '</p>' + actions([[user ? '#/profile' : '#/auth', user ? 'Мій профіль' : 'Вхід і реєстрація']]));
}

function field(label, name, attributes) {
  return '<label class="auth-field"><span>' + esc(label) + '</span><input name="' + name + '" ' + attributes + '></label>';
}

function submit(label) {
  return '<button class="btn-dark" type="submit">' + esc(label) + '</button><p class="form-message" role="status"></p>';
}

var phoneAttrs = 'type="tel" autocomplete="tel" placeholder="+380 67 123-45-67" required';
var passwordAttrs = 'type="password" autocomplete="current-password" required';
var newPasswordAttrs = 'type="password" autocomplete="new-password" minlength="6" maxlength="160" required';

function authPage() {
  if (user) {
    var cabinet = { pupil: ['#/diary', 'Щоденник'], teacher: ['#/teacher', 'Панель учителя'], admin: ['#/admin', 'Адміністрування'] }[user.role];
    return heading('Вхід і реєстрація') + card('Профіль уже активний',
      '<p>' + esc(user.fullName) + ' · ' + esc(ROLE_NAMES[user.role]) + '. Ще один профіль можна створити лише після виходу.</p>' +
      actions([cabinet, ['#/profile', 'Профіль']]) + '<button class="abtn" type="button" data-action="logout">Вийти та створити інший профіль</button>');
  }
  var register = authMode === 'register';
  var legacy = false;
  try { legacy = Boolean(localStorage.getItem('lyceum21_users')); } catch {}
  return '<section class="auth-wrap"><div class="auth-cloud"><h1>' + (register ? 'Реєстрація' : 'Вхід до порталу') +
    '</h1><div class="auth-tabs" role="group" aria-label="Вхід або реєстрація">' +
    '<button class="auth-tab' + (register ? '' : ' active') + '" type="button" data-auth-mode="login" aria-pressed="' + !register + '">Вхід</button>' +
    '<button class="auth-tab' + (register ? ' active' : '') + '" type="button" data-auth-mode="register" aria-pressed="' + register + '">Реєстрація</button></div>' +
    (legacy ? '<p class="muted">Профілі попередньої версії зберігалися в браузері. Для спільного кабінету створіть новий профіль.</p>' : '') +
    '<form class="auth-form" data-form="' + authMode + '">' +
    (register ? field('ПІБ · прізвище, ім’я, по батькові', 'fullName', 'autocomplete="name" placeholder="Коваленко Андрій Ігорович" minlength="5" maxlength="120" required') : '') +
    field('Номер телефону', 'phone', phoneAttrs) +
    field('Пароль', 'password', register ? newPasswordAttrs : passwordAttrs) +
    (register ? '<p class="small muted">Щонайменше 6 символів, літери та цифри.</p>' +
      field('Повторіть пароль', 'password2', newPasswordAttrs) +
      '<button class="auth-teacher-link" type="button" data-action="teacher-access" aria-pressed="' + teacherAccess + '">' +
      (teacherAccess ? 'Звичайна реєстрація учня' : 'Реєстрація для педагога ліцею') + '</button>' +
      (teacherAccess ? field('Код доступу педагога · видає адміністрація', 'code', 'type="password" placeholder="Код доступу" autocomplete="off" maxlength="24" required') :
        '<label class="auth-field"><span>Ваш клас</span><select name="klass" required>' + classesHtml('', true) + '</select></label>') : '') +
    submit(register ? 'Створити профіль' : 'Увійти') + '</form><p class="small muted">' +
    (register ? (teacherAccess ? 'Реєстрація педагога відкриває панель оцінювання, код доступу видає адміністрація ліцею.' :
      'Профіль учня відкриває щоденник. Оберіть свій клас під час реєстрації. Надалі клас може змінити адміністрація.') :
      'Увійти можна за номером телефону та паролем, вказаними під час реєстрації.') + '</p></div></section>';
}

function profilePage() {
  if (!user) return restricted('Мій профіль');
  var destination = { pupil: ['#/diary', 'Мій щоденник'], teacher: ['#/teacher', 'Панель учителя'], admin: ['#/admin', 'Адміністрування'] }[user.role];
  return heading('Мій профіль', user.fullName) +
    card('Обліковий запис', rows([['Роль', ROLE_NAMES[user.role]], ['Телефон', user.phone]].concat(user.klass ? [['Клас', user.klass]] : [])) +
      (user.klass ? '<p class="muted">Щоб змінити клас, зверніться до адміністрації.</p>' : '') +
      actions([destination, ['#/schedule', 'Розклад']]) + '<button class="abtn" type="button" data-action="logout">Вийти</button>') +
    card('Зміна пароля', '<form class="compact-form" data-form="password">' + field('Поточний пароль', 'oldPassword', passwordAttrs) +
      field('Новий пароль', 'password', newPasswordAttrs) + submit('Оновити пароль') + '</form>') +
    (user.role === 'admin' ? '' : '<details class="card-panel"><summary>Видалити профіль</summary><form class="compact-form" data-form="delete-account">' +
      '<p>Видалення профілю учня також видаляє його оцінки.</p>' + field('Підтвердьте паролем', 'password', passwordAttrs) +
      submit('Видалити профіль') + '</form></details>');
}

function markHtml(mark, controls) {
  var score = mark.score;
  var tone = score ? (score <= 4 ? 'mark-low' : score <= 8 ? 'mark-mid' : 'mark-top') : 'mark-empty';
  return '<li class="mark-record"><div>' +
    (score || mark.level ? '<span title="' + esc(LEVELS[mark.level]) + '" class="mark ' + tone + '">' + esc(score || mark.level) + '</span>' : '') +
    '<time datetime="' + esc(mark.created) + '">' + esc(schoolDate.format(new Date(mark.created))) + '</time>' +
    (mark.klass && mark.klass !== user.klass ? '<span class="muted small">' + esc(mark.klass) + ' клас</span>' : '') +
    (mark.comment ? '<p>' + esc(mark.comment) + '</p>' : '') + '</div>' +
    (controls && mark.editable ? '<div class="entry-actions"><button class="abtn" type="button" data-edit-mark="' + mark.id +
      '">Редагувати</button><button class="abtn" type="button" data-delete-mark="' + mark.id + '">Видалити</button></div>' : '') + '</li>';
}

function diaryPage() {
  if (user?.role !== 'pupil') return restricted('Електронний щоденник');
  var title = heading('Електронний щоденник', user.fullName + ' · ' + user.klass + ' клас');
  if (!pageData) return title + loadingCard();
  var grades = pageData.marks;
  var subjects = Array.from(new Set(classSubjects(user.klass).concat(grades.map(function (mark) { return mark.subject; }))));
  var numeric = grades.filter(function (mark) { return mark.klass === user.klass && mark.score; });
  var average = numeric.length ? (numeric.reduce(function (sum, mark) { return sum + mark.score; }, 0) / numeric.length).toLocaleString('uk-UA', { maximumFractionDigits: 1 }) : '—';
  var diaryRows = subjects.map(function (subject) {
    var marks = grades.filter(function (mark) { return mark.subject === subject; });
    return '<details class="row"><summary><span class="row-main"><strong>' + esc(subject) + '</strong></span>' +
      '<span class="row-sign">' + (marks.length ? marks.length + ' зап.' : 'Записів немає') + '</span></summary>' +
      '<div class="row-body">' + (marks.length ? '<ul class="mark-records">' + marks.map(function (mark) { return markHtml(mark, false); }).join('') +
        '</ul>' : '<p class="muted">Учитель ще не додав записів.</p>') + '</div></details>';
  }).join('');
  return title + actions([['#/schedule', 'Розклад мого класу']]) +
    card('Оцінки та відгуки', (classGrade(user.klass) >= 5 ? '<p class="muted">Середній бал у поточному класі <strong>' + esc(average) + '</strong></p>' : '') +
      '<div class="row-list">' + diaryRows + '</div>') +
    card('Домашні завдання', homeworkHtml(pageData.homework, false));
}

function gradeForm(pupil, mark) {
  var grade = classGrade(journalClass);
  var choices = grade >= 5 ? Array.from({ length: 12 }, function (_, index) { return index + 1; }) : Object.keys(LEVELS);
  var label = grade >= 5 ? 'Бал' : 'Рівень';
  var current = mark?.score || mark?.level || '';
  var select = grade === 1 || grade === 2 ? '' : '<label><select aria-label="' + label + '" name="' + (grade >= 5 ? 'score' : 'level') +
    '"' + (grade >= 5 ? ' required' : '') + '><option value="">' + (grade >= 5 ? 'Бал 1–12' : 'Рівень') + '</option>' +
    choices.map(function (option) {
      return '<option value="' + option + '"' + (option === current ? ' selected' : '') + '>' + esc(LEVELS[option] || option) + '</option>';
    }).join('') + '</select></label>';
  return '<form class="grade-form" data-form="mark" data-pupil="' + esc(pupil.id) + '"' + (mark ? ' data-mark="' + mark.id + '"' : '') + '>' +
    '<label class="grade-comment' + (grade >= 5 && !mark ? ' optional-comment' : '') + '"><span class="sr-only">Відгук</span>' +
    '<input name="comment" maxlength="500" placeholder="' + (grade < 3 ? 'Відгук' : 'Відгук за потреби') + '" value="' +
    esc(mark?.comment) + '"' + (grade < 3 ? ' required' : '') + '></label>' + select +
    '<button class="btn-dark" type="submit">' + (mark ? 'Зберегти' : 'Додати') + '</button><p class="form-message" role="status"></p></form>';
}

function journalPage() {
  if (user?.role !== 'teacher') return restricted('Панель учителя');
  var subjects = classSubjects(journalClass);
  if (!subjects.includes(journalSubject)) journalSubject = subjects[0];
  var filters = '<div class="journal-filters"><label>Клас<select id="journalClass">' + classesHtml(journalClass) + '</select></label>' +
    '<label>Предмет<select id="journalSubject">' + subjects.map(function (subject) {
      return '<option' + (subject === journalSubject ? ' selected' : '') + '>' + esc(subject) + '</option>';
    }).join('') + '</select></label><label>Пошук учня<input id="journalQuery" type="search" value="' + esc(journalQuery) + '"></label></div>';
  var result = heading('Панель учителя', user.fullName) + card('Журнал', filters);
  if (!pageData) return result + loadingCard();
  var pupils = pageData.pupils.slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'uk'); });
  var roster = pupils.map(function (pupil) { return journalPupil(pupil, false); }).join('');
  return result + card('Учні ' + journalClass + ' класу', '<div id="journalPupils">' + roster + '</div><p id="emptyJournal" class="muted" hidden>' +
    (pupils.length ? 'За цим запитом учнів не знайдено.' : 'У цьому класі ще немає зареєстрованих учнів.') + '</p>') +
    card('Домашні завдання', '<form class="compact-form" data-form="homework">' +
      field('Завдання', 'text', 'required maxlength="500"') + field('До якої дати', 'due', 'type="date" required') +
      submit('Додати завдання') + '</form>' + homeworkHtml(pageData.homework, true));
}

function journalPupil(pupil, open) {
  var grades = pageData.marks.filter(function (mark) { return mark.pupilId === pupil.id; });
  return '<article class="journal-pupil" data-pupil-name="' + esc(pupil.fullName.toLowerCase()) + '"><div class="journal-line">' +
    '<div><h3>' + esc(pupil.fullName) + '</h3><p class="small muted">' + (grades.length ? grades.length + ' зап.' : 'Записів немає') + '</p></div>' +
    gradeForm(pupil) + '</div>' + (grades.length ? '<details' + (open ? ' open' : '') + '><summary>Попередні записи</summary><ul class="mark-records">' +
      grades.map(function (mark) { return markHtml(mark, true); }).join('') + '</ul></details>' : '') + '</article>';
}

function refreshPupil(pupilId) {
  var pupil = pageData.pupils.find(function (entry) { return entry.id === pupilId; });
  var form = document.querySelector('.journal-line [data-pupil="' + pupilId + '"]');
  if (!pupil || !form) return;
  var row = form.closest('.journal-pupil');
  row.outerHTML = journalPupil(pupil, Boolean(row.querySelector('details[open]')));
  filterPupils();
  var next = document.querySelector('.journal-line [data-pupil="' + pupilId + '"]');
  (next?.querySelector('select') || next?.querySelector('input'))?.focus({ preventScroll: true });
}

function homeworkHtml(homework, teacher) {
  return homework?.length ? '<ul class="mark-records">' + homework.map(function (task) {
    return '<li class="mark-record"><div><strong>' + esc(task.subject) + '</strong> <time datetime="' + esc(task.due) + '">до ' +
      esc(schoolDate.format(new Date(task.due + 'T12:00:00Z'))) + '</time><p>' + esc(task.text) + '</p></div>' +
      (teacher ? (task.editable ? '<button class="abtn" type="button" data-delete-homework="' + task.id + '">Видалити</button>' : '') :
        '<label class="homework-check"><input type="checkbox" data-homework-done="' + task.id + '"' + (task.done ? ' checked' : '') + '> Виконано</label>') + '</li>';
  }).join('') + '</ul>' : '<p class="muted">Завдань поки немає.</p>';
}

function filterPupils() {
  var empty = document.getElementById('emptyJournal');
  if (!empty) return;
  var visible = 0;
  document.querySelectorAll('[data-pupil-name]').forEach(function (pupil) {
    pupil.hidden = !pupil.dataset.pupilName.includes(journalQuery.trim().toLowerCase());
    if (!pupil.hidden) visible++;
  });
  empty.hidden = visible > 0;
}

function adminPage() {
  if (user?.role !== 'admin') return restricted('Адміністрування');
  return heading('Адміністрування') +
    card('Запрошення вчителя', '<p>Код діє 24 години й підходить для однієї реєстрації на вказаний номер.</p>' +
      '<form class="compact-form" data-form="invite">' + field('Номер телефону вчителя', 'phone', phoneAttrs) +
      submit('Згенерувати код') + '<label class="auth-field" id="inviteResult" hidden><span>Код запрошення</span>' +
      '<input id="inviteCode" readonly></label></form>') +
    card('Зміна класу учня', '<form class="compact-form" data-form="class">' + field('Номер телефону учня', 'phone', phoneAttrs) +
      '<label class="auth-field"><span>Новий клас</span><select name="klass" required>' + classesHtml('', true) + '</select></label>' +
      submit('Змінити клас') + '</form>');
}

var PAGES = {
  home: ['Головна', homePage], history: ['Історія ліцею', historyPage], students: ['Учням', studentsPage],
  teachers: ['Вчителі', teachersPage], schedule: ['Розклад', schedulePage], news: ['Новини', newsPage],
  dining: ['Харчування', diningPage], admissions: ['Зарахування', admissionsPage], gallery: ['Вигляд ліцею', galleryPage],
  contacts: ['Контакти', contactsPage], auth: ['Вхід і реєстрація', authPage], profile: ['Профіль', profilePage],
  diary: ['Щоденник', diaryPage], teacher: ['Панель учителя', journalPage], admin: ['Адміністрування', adminPage],
  notfound: ['Сторінку не знайдено', function () { return heading('Сторінку не знайдено') + actions([['#/home', 'На головну']]); }]
};

function redraw() {
  var page = PAGES[route];
  app.className = ['home', 'auth'].includes(route) ? '' : 'page-wide';
  app.innerHTML = page[1]();
  document.title = page[0] + ' · Lyceum N21';
  renderNav();
  filterCards();
  filterPupils();
  renderNews();
  highlightTime();
}

async function loadPage() {
  var request = ++revision;
  pageData = null;
  pageError = '';
  redraw();
  if (route === 'home' || route === 'news') loadNews();
  var endpoint;
  if (route === 'diary' && user?.role === 'pupil') endpoint = 'diary';
  if (route === 'teacher' && user?.role === 'teacher') {
    endpoint = 'journal?' + new URLSearchParams({ klass: journalClass, subject: journalSubject });
  }
  if (!endpoint) return;
  try {
    var data = await api(endpoint);
    if (request !== revision) return;
    pageData = data;
  } catch (error) {
    if (request !== revision) return;
    if (error.status === 401) user = null;
    else pageError = error.message;
  }
  redraw();
}

function navigate() {
  var hash = location.hash;
  if (hash === '#main') {
    document.getElementById('main').focus();
    return;
  }
  var parts = hash.replace(/^#\/?/, '').split(':');
  route = Object.hasOwn(PAGES, parts[0]) ? parts[0] : (parts[0] ? 'notfound' : 'home');
  setDrawer(false);
  loadPage();
  if (user && ['schedule', 'diary', 'profile'].includes(route)) syncSession();
  if (parts[1]) requestAnimationFrame(function () { document.getElementById(parts[1])?.scrollIntoView(); });
  else window.scrollTo(0, 0);
}

async function syncSession() {
  var request = ++sessionRevision;
  var previous = user?.id + ':' + user?.klass;
  var status = accountStatus;
  try {
    var session = await api('session');
    if (request !== sessionRevision) return;
    user = session.user;
    accountStatus = 'ready';
  } catch {
    if (request !== sessionRevision) return;
    accountStatus = 'offline';
  }
  var changed = previous !== user?.id + ':' + user?.klass;
  if (changed || status !== accountStatus) loadPage();
  else if (route === 'home' || route === 'news') loadNews();
}

document.addEventListener('click', async function (event) {
  var button = event.target.closest('button');
  if (!button) {
    if (event.target.closest('#navDrawer a')) setDrawer(false);
    return;
  }
  var data = button.dataset;
  if (data.authMode) {
    authMode = data.authMode;
    if (authMode === 'login') teacherAccess = false;
    redraw();
  }
  if (data.action === 'teacher-access') {
    var previous = new FormData(button.form);
    teacherAccess = !teacherAccess;
    redraw();
    var form = app.querySelector('.auth-form');
    ['fullName', 'phone', 'password', 'password2'].forEach(function (name) { form.elements[name].value = previous.get(name) || ''; });
    form.querySelector('[data-action="teacher-access"]').focus();
  }
  if (data.action === 'copy-contacts') {
    var status = document.getElementById('copyStatus');
    var content = [SCHOOL.full, SCHOOL.address, SCHOOL.phone, SCHOOL.email, 'ЄДРПОУ ' + SCHOOL.edrpou].join(', ');
    try {
      await navigator.clipboard.writeText(content);
      status.textContent = 'Реквізити скопійовано.';
    } catch { status.textContent = content; }
  }
  if (data.categoryFilter) { navFilter = data.categoryFilter; filterCards(); }
  if (data.day !== undefined) {
    scheduleDay = Number(data.day);
    redraw();
    document.querySelector('[data-day="' + scheduleDay + '"]')?.focus({ preventScroll: true });
  }
  if (data.action === 'retry') loadPage();
  if (data.action === 'logout') {
    button.disabled = true;
    try {
      await api('logout', 'POST', {});
      sessionRevision++;
      user = null;
      authMode = 'login';
      teacherAccess = false;
      if (route === 'home') loadPage();
      else location.hash = '#/home';
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }
  if (data.editMark) {
    var mark = pageData.marks.find(function (item) { return item.id === Number(data.editMark); });
    if (!mark) return;
    var container = button.closest('.mark-record');
    if (!container.querySelector('form')) {
      container.insertAdjacentHTML('beforeend', gradeForm({ id: mark.pupilId }, mark));
      container.querySelector('form :is(select,input)')?.focus();
    }
  }
  if (data.deleteMark || data.deleteHomework) {
    if (!window.confirm(data.deleteMark ? 'Видалити цю оцінку або відгук?' : 'Видалити це завдання?')) return;
    button.disabled = true;
    var view = revision;
    try {
      await api(data.deleteMark ? 'mark' : 'homework', 'DELETE', {
        id: Number(data.deleteMark || data.deleteHomework), klass: journalClass, subject: journalSubject
      });
      if (view === revision && data.deleteMark) {
        var removed = pageData.marks.find(function (mark) { return mark.id === Number(data.deleteMark); });
        if (removed) {
          pageData.marks = pageData.marks.filter(function (mark) { return mark.id !== removed.id; });
          refreshPupil(removed.pupilId);
        }
      } else if (view === revision) loadPage();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  }
});

document.addEventListener('input', function (event) {
  if (event.target.id === 'navSearch') filterCards();
  if (event.target.id === 'journalQuery') {
    journalQuery = event.target.value;
    filterPupils();
  }
});

document.addEventListener('change', async function (event) {
  var element = event.target;
  if (element.id === 'scheduleClass' && user?.role !== 'pupil' && CLASSES.includes(element.value)) {
    scheduleClass = element.value;
    redraw();
    document.getElementById('scheduleClass').focus();
  }
  if (element.id === 'journalClass' || element.id === 'journalSubject') {
    if (element.id === 'journalClass') journalClass = element.value;
    else journalSubject = element.value;
    loadPage();
  }
  if (element.dataset.homeworkDone) {
    element.disabled = true;
    try {
      await api('homework/done', 'POST', { id: Number(element.dataset.homeworkDone), done: element.checked });
    } catch (error) {
      element.checked = !element.checked;
      window.alert(error.message);
    } finally {
      element.disabled = false;
    }
  }
});

document.addEventListener('submit', async function (event) {
  var form = event.target;
  var kind = form.dataset.form;
  if (!kind) return;
  event.preventDefault();
  var button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  var message = form.querySelector('.form-message');
  var values = Object.fromEntries(new FormData(form));
  var request = revision;
  button.disabled = true;
  message.textContent = '';
  try {
    if (kind === 'register' || kind === 'login') {
      if (kind === 'register') {
        if (values.password !== values.password2) throw new Error('Паролі не збігаються.');
        delete values.password2;
        values.role = teacherAccess ? 'teacher' : 'pupil';
      }
      var account = (await api(kind, 'POST', values)).user;
      sessionRevision++;
      user = account;
      accountStatus = 'ready';
      location.hash = '#/' + ({ pupil: 'diary', teacher: 'teacher', admin: 'admin' }[user.role]);
    } else if (kind === 'password') {
      await api('password', 'POST', values);
      form.reset();
      message.textContent = 'Пароль оновлено.';
    } else if (kind === 'delete-account') {
      if (!window.confirm('Видалити ваш профіль?')) return;
      await api('account', 'DELETE', values);
      sessionRevision++;
      user = null;
      location.hash = '#/home';
    } else if (kind === 'invite' || kind === 'class') {
      var result = await api('admin/' + kind, 'POST', values);
      if (kind === 'invite') {
        form.querySelector('#inviteResult').hidden = false;
        var code = form.querySelector('#inviteCode');
        code.value = result.code;
        message.textContent = 'Код дійсний протягом 24 годин.';
        code.focus();
        code.select();
      } else {
        message.textContent = result.user.fullName + ' · Новий клас ' + result.user.klass;
      }
    } else if (kind === 'mark' || kind === 'homework') {
      values.klass = journalClass;
      values.subject = journalSubject;
      if (kind === 'mark') {
        values.pupilId = form.dataset.pupil;
        if (values.score) values.score = Number(values.score);
        if (form.dataset.mark) values.id = Number(form.dataset.mark);
      }
      var saved = await api(kind, form.dataset.mark ? 'PATCH' : 'POST', values);
      if (request === revision && kind === 'mark') {
        var index = pageData.marks.findIndex(function (mark) { return mark.id === saved.mark.id; });
        if (index === -1) pageData.marks.unshift(saved.mark);
        else pageData.marks[index] = saved.mark;
        refreshPupil(saved.mark.pupilId);
      } else if (request === revision) loadPage();
    }
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('navBurger').addEventListener('click', function () {
  setDrawer(!document.body.classList.contains('nav-open'));
});
document.querySelector('.skip-link').addEventListener('click', function (event) {
  event.preventDefault();
  document.getElementById('main').focus();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setDrawer(false);
    document.getElementById('navBurger').focus();
  }
});
document.getElementById('themeToggle').addEventListener('click', function () {
  var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('lyceum21_theme', next); } catch {}
  setTheme(next);
});
window.addEventListener('hashchange', navigate);
window.addEventListener('online', syncSession);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) syncSession();
});
window.setInterval(function () {
  highlightTime();
  if (route === 'home' || route === 'news') { renderNews(); loadNews(); }
}, 60_000);

setTheme(document.documentElement.dataset.theme || 'dark');
initBackground();
navigate();
syncSession();

if (location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
