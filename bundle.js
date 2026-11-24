'use strict';

const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const inline = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(__dirname, file)).toString('base64')}`;
const output = path.resolve(process.argv[2] || path.join(__dirname, '..', 'lyceum-n21.html'));
const videoPath = 'assets/background.mp4';
const logo = inline('assets/logo.jpg', 'image/jpeg');

let html = read('index.html');
const css = read('style.css');
const data = read('data.js');
let app = read('app.js').replace(/\nif \(location\.protocol\.indexOf\('http'\) === 0 && 'serviceWorker' in navigator\) \{[\s\S]*?\n\}/, '');

for (const file of fs.readdirSync(path.join(__dirname, 'assets', 'photos'))) {
  const relative = 'assets/photos/' + file;
  if (app.includes(relative)) app = app.replaceAll(relative, inline(relative, 'image/jpeg'));
}
for (const source of [css, data, app]) {
  if (/<\/(script|style)/i.test(source)) throw new Error('Не можна вбудувати закривальний HTML-тег.');
}

html = html.replaceAll('assets/logo.jpg', logo)
  .replace('assets/preview.svg', inline('assets/preview.svg', 'image/svg+xml'))
  .replace(/<link rel="manifest"[^>]*>\r?\n/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '</style>')
  .replace('<script src="data.js"></script>', () => '<script>\n' + data + '</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + app + '</script>')
  .replace(' data-src="' + videoPath + '"', fs.existsSync(path.join(__dirname, videoPath)) ? ' data-src="' + inline(videoPath, 'video/mp4') + '"' : '');

fs.writeFileSync(output, html);
console.log(output);
