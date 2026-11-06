'use strict';
/* Збирає з цієї папки автономний ../lyceum-n21.html: стилі, скрипти та
   зображення стають частиною одного файла, зовнішніх запитів не лишається. */

const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const OUT = path.join(__dirname, '..', 'lyceum-n21.html');

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const b64 = (f) => Buffer.from(read(f), 'utf8').toString('base64');

let html = read('index.html');
const css = read('style.css').replace('Lyceum N21: стилі порталу (style.css)', 'Lyceum N21: стилі порталу');
const data = read('data.js').replace('Lyceum N21: дані порталу (data.js)', 'Lyceum N21: дані порталу');
const app = read('app.js').replace(
  'Дані порталу лежать у data.js, оцінки, профілі, тема та\n   відмітки домашніх завдань зберігаються в цьому браузері.',
  'Оцінки, профілі, тема та відмітки домашніх завдань\n   зберігаються в цьому браузері.'
);

for (const [name, text] of [['style.css', css], ['data.js', data], ['app.js', app]]) {
  if (/<\/(script|style)/i.test(text)) throw new Error(name + ': містить закривальний тег');
}

const sub = (from, to) => {
  if (!html.includes(from)) throw new Error('Не знайдено: ' + from);
  html = html.replace(from, to);
};

/* Сервіс-воркер і маніфест потребують окремих файлів, тому в одному файлі їх немає. */
const swBlock = `
  if (location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн-кеш недоступний */ });
    });
  }`;
if (!app.includes(swBlock)) throw new Error('Не знайдено блок реєстрації sw.js');
const appSingle = app.replace(swBlock, '');

sub('<link rel="icon" type="image/svg+xml" href="assets/icon.svg">',
    '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,' + b64('assets/icon.svg') + '">');
sub('<meta property="og:image" content="assets/preview.svg">',
    '<meta property="og:image" content="data:image/svg+xml;base64,' + b64('assets/preview.svg') + '">');
sub('<link rel="manifest" href="manifest.webmanifest">\n', '');
sub('<link rel="stylesheet" href="style.css">', '<style>\n' + css.trimEnd() + '\n</style>');
sub('<script src="data.js"></script>', '<script>\n' + data.trimEnd() + '\n</script>');
sub('<script src="app.js"></script>', '<script>\n' + appSingle.trimEnd() + '\n</script>');

fs.writeFileSync(OUT, html, 'utf8');
console.log('OK', OUT, (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB');
