'use strict';
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/core');
for (const [name, language] of Object.entries({
  javascript: require('highlight.js/lib/languages/javascript'),
  typescript: require('highlight.js/lib/languages/typescript'),
  python: require('highlight.js/lib/languages/python'),
  bash: require('highlight.js/lib/languages/bash'),
  json: require('highlight.js/lib/languages/json'),
  css: require('highlight.js/lib/languages/css'),
  xml: require('highlight.js/lib/languages/xml'),
  sql: require('highlight.js/lib/languages/sql'),
  diff: require('highlight.js/lib/languages/diff'),
  yaml: require('highlight.js/lib/languages/yaml'),
  go: require('highlight.js/lib/languages/go'),
  rust: require('highlight.js/lib/languages/rust'),
  swift: require('highlight.js/lib/languages/swift'),
})) hljs.registerLanguage(name, language);

const md = new MarkdownIt({
  html: false, linkify: true, breaks: true,
  highlight(code, language) {
    if (code.length <= 100000 && language && hljs.getLanguage(language)) {
      try { return hljs.highlight(code, { language, ignoreIllegals: true }).value; } catch {}
    }
    return '';
  },
});
// Shared content can format text, but cannot execute HTML or fetch remote images.
md.validateLink = url => /^(https?:|mailto:)/i.test(url) && !/[\u0000-\u0020\u007f]/.test(url);
md.renderer.rules.image = (tokens, index) => `<span class="image-description">Image: ${md.utils.escapeHtml(tokens[index].content || 'attachment')}</span>`;
const linkOpen = md.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return linkOpen(tokens, index, options, env, renderer);
};

function renderMarkdown(container, text) {
  const scrollPositions = [...container.querySelectorAll('pre,.table-scroll')].map(el => el.scrollLeft);
  // All markup comes from the HTML-disabled parser and our fixed renderers above.
  container.innerHTML = md.render(text);
  for (const table of container.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll'; wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper); wrapper.append(table);
  }
  for (const pre of container.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    pre.tabIndex = 0;
    const block = document.createElement('div'); block.className = 'code-block';
    const header = document.createElement('div'); header.className = 'code-block-header';
    const label = document.createElement('span'); label.className = 'code-language';
    label.textContent = [...code.classList].find(name => name.startsWith('language-'))?.slice(9) || 'Code';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-code'; copy.textContent = 'Copy code';
    copy.setAttribute('aria-label', `Copy ${label.textContent} code`);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        copy.textContent = 'Copied';
      } catch { copy.textContent = 'Select code to copy'; }
      setTimeout(() => { copy.textContent = 'Copy code'; }, 2000);
    });
    header.append(label, copy); pre.before(block); block.append(header, pre);
  }
  for (const li of container.querySelectorAll('li')) {
    const content = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : li;
    const first = content.firstChild;
    if (first?.nodeType !== Node.TEXT_NODE) continue;
    const task = /^\[([ xX])\]\s+/.exec(first.textContent);
    if (!task) continue;
    li.classList.add('task-list-item');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.disabled = true;
    checkbox.checked = task[1].toLowerCase() === 'x'; checkbox.setAttribute('aria-label', checkbox.checked ? 'Completed task' : 'Incomplete task');
    first.textContent = first.textContent.slice(task[0].length); content.prepend(checkbox);
  }
  [...container.querySelectorAll('pre,.table-scroll')].forEach((el, index) => { el.scrollLeft = scrollPositions[index] || 0; });
}
window.ManycodeMarkdown = { render: renderMarkdown };
