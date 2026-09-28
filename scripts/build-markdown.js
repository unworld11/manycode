'use strict';
const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'markdown-entry.js')],
  outfile: path.join(__dirname, '../lib/markdown-renderer.js'),
  bundle: true, minify: true, platform: 'browser', target: ['es2020'],
  legalComments: 'eof',
});

const fs = require('fs');
const packages = ['markdown-it', 'highlight.js', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro'];
const notices = packages.map(name => {
  const directory = path.join(__dirname, '../node_modules', name);
  const filename = fs.readdirSync(directory).find(file => /^license(?:[.-]|$)/i.test(file));
  if (!filename) throw new Error(`Missing license for ${name}`);
  return `${name}\n${fs.readFileSync(path.join(directory, filename), 'utf8')}`;
});
fs.writeFileSync(path.join(__dirname, '../lib/markdown-licenses.txt'), notices.join('\n\n'));
