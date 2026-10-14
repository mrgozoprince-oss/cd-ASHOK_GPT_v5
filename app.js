/* ASHOK GPT v5: ChatGPT-style chat, focused on coding, Minecraft mods and plugins.
   Everything runs on the device. Chats and the API key stay in local storage. */

const $ = (id) => document.getElementById(id);

// SETTINGS_KEY is the same key the previous version used, so a saved API key keeps working.
const SETTINGS_KEY = 'ashokgpt.settings.v1';
const CHATS_KEY = 'ashokgpt.chats.v2';
const OLD_HISTORY_KEY = 'ashokgpt.history.v1';
const LOGO = 'assets/ashok-gpt-logo.jpg';

const CONTEXT_CHAR_BUDGET = 60000;
const MAX_CONTEXT_MESSAGES = 30;
const MAX_FILE_BYTES = 300 * 1024;
const MAX_FILE_CHARS = 40000;
const MAX_ATTACHMENTS = 5;

const DEFAULT_SETTINGS = {
  provider: 'openrouter',
  apiKey: '',
  model: 'openai/gpt-4o-mini',
  baseUrl: 'https://openrouter.ai/api/v1',
  mcVersion: '1.21.11',
  creativity: 'default',
  streaming: true,
  answerStyle: 'balanced',
  customInstructions: '',
  defaultMode: 'general',
  enterToSend: false,
};

const MODES = {
  general: { label: 'General chat', icon: '◉', desc: 'Sawal, plan aur explanation', rules: 'Mode: General. Answer helpfully and clearly.' },
  coding: { label: 'Coding Lab', icon: '⌘', desc: 'Code likho, fix karo, review karo', rules: 'Mode: Coding Lab. Write clean, idiomatic code. For multi-file work, show the file tree first, then each file in its own code block with its path above it. Keep explanations short.' },
  mod: { label: 'Minecraft Mod', icon: '▦', desc: 'Fabric, Forge ya NeoForge', rules: 'Mode: Minecraft Mod. Target Minecraft version: {MC}. If the user does not name a loader, assume Fabric and say so in the first line. Provide: the project tree; build.gradle and settings.gradle; the loader metadata file (fabric.mod.json, META-INF/mods.toml or META-INF/neoforge.mods.toml); the Java source files; the exact build command and where the JAR appears. Dependency versions, mappings and APIs change between Minecraft versions, so say so, and tell the user to check the official template or docs for exact version numbers when unsure.' },
  plugin: { label: 'Minecraft Plugin', icon: '▤', desc: 'Paper, Spigot, Bukkit, Velocity', rules: 'Mode: Minecraft Plugin. Target server version: {MC}. If the user does not name a server, assume Paper and say so in the first line. Provide: the plugin metadata file (plugin.yml, paper-plugin.yml or velocity-plugin.json, as appropriate); the build file (pom.xml or build.gradle); the Java classes; build and install steps. Use only API calls that exist for that server version, and say so when unsure.' },
  webapp: { label: 'Web & Android App', icon: '◫', desc: 'HTML, JS, React, Capacitor APK', rules: 'Mode: Web & Android App. Provide complete, runnable files. Explain how to run locally and, for Android, how to build with Capacitor. Keep dependencies minimal.' },
  debug: { label: 'Debug & Logs', icon: '⚠', desc: 'Error log paste karo, fix pao', rules: 'Mode: Debug. First state the root cause in one or two sentences. Then give the minimal fix as exact replacement code. Ask for one specific missing piece only if you truly cannot proceed.' },
};

const BASE_RULES = [
  'You are ASHOK GPT, an expert AI assistant for software development and Minecraft modding.',
  'Reply in the language the user writes in. Hinglish is fine when the user writes in Hinglish.',
  'Be practical: give complete, copy-paste-ready code with exact file paths, and state important assumptions briefly.',
  'Never claim that code was compiled, run or tested. You cannot run code in this app.',
  'Do not invent APIs or version numbers. If unsure, say so and point the user to the official docs.',
  'Refuse to write malware, credential stealers, exploits, or attacks against systems or servers the user does not own. Also refuse cheats or anti-cheat bypasses for public multiplayer servers.',
].join(' ');

const SUGGESTIONS = [
  { icon: '▦', title: 'Minecraft mod', text: 'Fabric mod banao jo ek custom block add kare. ', mode: 'mod' },
  { icon: '▤', title: 'Server plugin', text: 'Paper plugin banao jo /spawn command de. ', mode: 'plugin' },
  { icon: '⌘', title: 'Code likho', text: 'Python script likho jo CSV files merge kare. ', mode: 'coding' },
  { icon: '⚠', title: 'Error fix karo', text: 'Mera error ye hai, root cause batao aur fix do:\n', mode: 'debug' },
];

let settings = { ...DEFAULT_SETTINGS };
let chats = [];
let currentId = null;
let pendingAttachments = [];
let busy = false;
let activeController = null;
let streamingMsg = null;
let streamingIndex = -1;
let uiScheduled = false;
let toastTimer = null;
let dialogResolve = null;

/* ---------- Utilities ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function makeTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      resolve(text.includes('\u0000') ? null : text); // null = binary file
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function openPanel(id) { $(id).classList.remove('hidden'); }
function closePanel(id) { $(id).classList.add('hidden'); }

function openSidebar() {
  $('sidebar').classList.add('open');
  $('scrim').classList.add('show');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').classList.remove('show');
}

function scrollStage(force) {
  const s = $('stage');
  const nearBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 160;
  if (force || nearBottom) s.scrollTop = s.scrollHeight;
}

function autosize() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 180) + 'px';
}

/* ---------- Markdown (safe: all text is escaped before formatting) ---------- */

function inlineMd(src) {
  let t = esc(src);
  const codes = [];
  t = t.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => '<code>' + codes[Number(n)] + '</code>');
  return t;
}

function codeBlockHtml(lang, code) {
  return '<div class="code"><div class="code-head"><span>' + esc(lang || 'code') +
    '</span><button type="button" class="copy-code">Copy</button></div><pre><code>' +
    esc(code) + '</code></pre></div>';
}

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let listTag = null;
  let items = [];

  const flushPara = () => {
    if (para.length) { out.push('<p>' + para.map(inlineMd).join('<br>') + '</p>'); para = []; }
  };
  const flushList = () => {
    if (listTag) {
      out.push('<' + listTag + '>' + items.map((x) => '<li>' + inlineMd(x) + '</li>').join('') + '</' + listTag + '>');
      listTag = null;
      items = [];
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flushAll();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      out.push(codeBlockHtml(fence[1], code.join('\n')));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const n = heading[1].length + 2; // # -> h3 ... #### -> h6
      out.push('<h' + n + '>' + inlineMd(heading[2]) + '</h' + n + '>');
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    const item = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (listTag !== tag) { flushList(); listTag = tag; }
      items.push(item[2]);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushAll();
      out.push('<blockquote>' + inlineMd(quote[1]) + '</blockquote>');
      continue;
    }

    if (!line.trim()) { flushAll(); continue; }

    flushList();
    para.push(line);
  }
  flushAll();
  return out.join('');
}

function dotsHtml() {
  return '<span class="dots"><i></i><i></i><i></i></span>';
}

/* ---------- Storage ---------- */

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    toast('Settings save nahi ho paaye (storage full?)');
    return false;
  }
}

function makeChat(title, mode, messages) {
  const now = Date.now();
  return {
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 7),
    title: title || 'New chat',
    mode: mode || 'general',
    createdAt: now,
    updatedAt: now,
    messages: messages || [],
  };
}

function loadChats() {
  try { chats = JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); } catch { chats = []; }
  if (!Array.isArray(chats)) chats = [];
  if (!chats.length) {
    // Bring over the single history from the previous version, if there is one.
    try {
      const old = JSON.parse(localStorage.getItem(OLD_HISTORY_KEY) || '[]');
      if (Array.isArray(old) && old.length) {
        const firstUser = old.find((m) => m.role === 'user');
        chats = [makeChat(makeTitle(firstUser && firstUser.content), 'general',
          old.map((m) => ({ role: m.role, content: String(m.content || '') })))];
        saveChats();
      }
    } catch {}
  }
}

function saveChats() {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    return true;
  } catch {
    toast('Storage full ho gaya. Purane chats delete karo.');
    return false;
  }
}

function currentChat() {
  return chats.find((c) => c.id === currentId) || null;
}

function mostRecentId() {
  const sorted = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted[0] ? sorted[0].id : null;
}

function ensureChat() {
  let c = currentChat();
  if (!c) {
    c = makeChat('New chat', settings.defaultMode || 'general');
    chats.push(c);
    currentId = c.id;
  }
  return c;
}

/* ---------- Rendering ---------- */

function renderAll() {
  renderChatList();
  renderModePill();
  renderMessages();
  renderAttachments();
  updateConnectionUI();
}

function renderModePill() {
  const c = currentChat();
  const mode = MODES[c ? c.mode : settings.defaultMode] || MODES.general;
  $('modeLabel').textContent = mode.label;
}

function updateConnectionUI() {
  const ok = !!settings.apiKey;
  $('connDot').classList.toggle('connected', ok);
  $('connText').textContent = ok
    ? 'Connected · ' + (settings.model || 'model not set')
    : 'Not connected. Settings mein key daalo';
  $('modelTag').textContent = ok ? (settings.model || '') : 'Setup needed';
}

function renderChatList() {
  const q = ($('chatSearch').value || '').trim().toLowerCase();
  const list = $('chatList');
  const items = chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !q || c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => (m.content || '').toLowerCase().includes(q)));

  list.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'muted small pad';
    p.textContent = q ? 'Koi chat nahi mili.' : 'Abhi koi chat nahi. "New chat" dabao.';
    list.appendChild(p);
    return;
  }

  for (const c of items) {
    const row = document.createElement('div');
    row.className = 'chat-item' + (c.id === currentId ? ' active' : '');
    row.dataset.id = c.id;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'chat-open';
    open.textContent = c.title || 'New chat';

    const ren = document.createElement('button');
    ren.type = 'button';
    ren.className = 'mini';
    ren.dataset.rename = '';
    ren.title = 'Rename';
    ren.textContent = '✎';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini';
    del.dataset.del = '';
    del.title = 'Delete';
    del.textContent = '✕';

    row.append(open, ren, del);
    list.appendChild(row);
  }
}

function lastAssistantIndex(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role === 'assistant' && !m.pending) return i;
  }
  return -1;
}

function renderMessages() {
  const chat = currentChat();
  const box = $('messages');
  const msgs = chat ? chat.messages : [];
  box.innerHTML = '';
  msgs.forEach((m, i) => box.appendChild(messageNode(m, i, chat)));
  $('welcome').classList.toggle('hidden', msgs.length > 0);
  scrollStage(true);
}

function messageNode(m, i, chat) {
  const el = document.createElement('div');
  el.className = 'msg ' + m.role + (m.error ? ' error' : '');
  el.dataset.i = String(i);

  if (m.role === 'user') {
    if (m.attachments && m.attachments.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const a of m.attachments) {
        const s = document.createElement('span');
        s.className = 'chip';
        s.textContent = '📎 ' + a.name;
        chips.appendChild(s);
      }
      el.appendChild(chips);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.content === '(file attached)' ? '' : m.content;
    el.appendChild(bubble);
    el.insertAdjacentHTML('beforeend',
      '<div class="msg-actions"><button type="button" class="link-btn" data-act="copy">Copy</button>' +
      '<button type="button" class="link-btn" data-act="edit">Edit</button></div>');
  } else {
    const showActions = !m.pending;
    const regen = i === lastAssistantIndex(chat)
      ? '<button type="button" class="link-btn" data-act="regen">Regenerate</button>' : '';
    el.innerHTML = '<div class="avatar"><img src="' + LOGO + '" alt=""></div>' +
      '<div class="body"><div class="md"></div><div class="msg-actions">' +
      (showActions ? '<button type="button" class="link-btn" data-act="copy">Copy</button>' + regen : '') +
      '</div></div>';
    const md = el.querySelector('.md');
    md.innerHTML = m.content ? renderMarkdown(m.content) : (m.pending ? dotsHtml() : '');
    if (m.pending) md.classList.add('streaming');
  }
  return el;
}

function renderAttachments() {
  const row = $('attachRow');
  row.innerHTML = '';
  row.classList.toggle('hidden', !pendingAttachments.length);
  pendingAttachments.forEach((a, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip removable';
    chip.textContent = '📎 ' + a.name;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Remove ' + a.name);
    x.addEventListener('click', () => {
      pendingAttachments.splice(idx, 1);
      renderAttachments();
    });
    chip.appendChild(x);
    row.appendChild(chip);
  });
}

// Streaming updates are batched to one redraw per frame so the page stays smooth.
function scheduleStreamUpdate() {
  if (uiScheduled) return;
  uiScheduled = true;
  requestAnimationFrame(() => {
    uiScheduled = false;
    if (!streamingMsg) return;
    const md = $('messages').querySelector('.msg[data-i="' + streamingIndex + '"] .md');
    if (md) md.innerHTML = streamingMsg.content ? renderMarkdown(streamingMsg.content) : dotsHtml();
    scrollStage(false);
  });
}

function renderModeSheet() {
  const list = $('modeList');
  list.innerHTML = '';
  for (const key of Object.keys(MODES)) {
    const m = MODES[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-item';
    b.dataset.mode = key;

    const icon = document.createElement('span');
    icon.className = 'mode-icon';
    icon.textContent = m.icon;

    const text = document.createElement('span');
    text.className = 'mode-text';
    const title = document.createElement('b');
    title.textContent = m.label;
    const desc = document.createElement('small');
    desc.textContent = m.desc;
    text.append(title, desc);

    b.append(icon, text);
    b.addEventListener('click', () => setCurrentMode(key));
    list.appendChild(b);
  }
}

function showModeSheet() {
  const c = currentChat();
  const active = c ? c.mode : (settings.defaultMode || 'general');
  document.querySelectorAll('.mode-item').forEach((b) => b.classList.toggle('active', b.dataset.mode === active));
  openPanel('modeSheet');
}

function setCurrentMode(key) {
  const chat = ensureChat();
  chat.mode = key;
  saveChats();
  closePanel('modeSheet');
  renderAll();
  toast('Mode: ' + MODES[key].label);
}

function renderSuggestions() {
  const box = $('suggestions');
  box.innerHTML = '';
  for (const s of SUGGESTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggest';
    const icon = document.createElement('i');
    icon.textContent = s.icon;
    const title = document.createElement('b');
    title.textContent = s.title;
    b.append(icon, title);
    b.addEventListener('click', () => {
      if (busy) return;
      const chat = ensureChat();
      chat.mode = s.mode;
      saveChats();
      $('input').value = s.text;
      autosize();
      renderAll();
      $('input').focus();
    });
    box.appendChild(b);
  }
}

/* ---------- Chat actions ---------- */

function newChat() {
  if (busy) { toast('Response complete hone do, phir naya chat'); return; }
  const cur = currentChat();
  if (!(cur && cur.messages.length === 0)) {
    const c = makeChat('New chat', settings.defaultMode || 'general');
    chats.push(c);
    currentId = c.id;
    saveChats();
  }
  pendingAttachments = [];
  closeSidebar();
  renderAll();
}

function openChat(id) {
  if (busy) { toast('Response complete hone do'); return; }
  currentId = id;
  pendingAttachments = [];
  closeSidebar();
  renderAll();
}

async function renameChat(id) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  const name = await askDialog({ title: 'Chat ka naam', input: c.title, okText: 'Save' });
  if (name) {
    c.title = name.slice(0, 60);
    saveChats();
    renderChatList();
  }
}

async function deleteChat(id) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  if (busy && id === currentId) { toast('Pehle response complete hone do'); return; }
  const ok = await askDialog({
    title: 'Chat delete karein?',
    text: '"' + c.title + '" is device se hamesha ke liye delete ho jayegi.',
    okText: 'Delete',
    danger: true,
  });
  if (!ok) return;
  chats = chats.filter((x) => x.id !== id);
  if (currentId === id) currentId = mostRecentId();
  saveChats();
  renderAll();
}

function onChatListClick(e) {
  const row = e.target.closest('.chat-item');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('[data-rename]')) renameChat(id);
  else if (e.target.closest('[data-del]')) deleteChat(id);
  else openChat(id);
}

function sendFromInput() {
  if (busy) return;
  const text = $('input').value.trim();
  if (!text && !pendingAttachments.length) return;
  if (!settings.apiKey) {
    toast('Pehle Settings mein API key aur model daalo');
    openSettings();
    return;
  }
  const chat = ensureChat();
  const userMsg = { role: 'user', content: text || '(file attached)', ts: Date.now() };
  if (pendingAttachments.length) userMsg.attachments = pendingAttachments.splice(0);
  chat.messages.push(userMsg);
  if (chat.messages.filter((m) => m.role === 'user').length === 1) {
    chat.title = makeTitle(text || (userMsg.attachments && userMsg.attachments[0].name) || 'New chat');
  }
  $('input').value = '';
  autosize();
  generate(chat);
}

function regenerate() {
  const chat = currentChat();
  if (!chat || busy) return;
  while (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'assistant') {
    chat.messages.pop();
  }
  if (!chat.messages.length) return;
  generate(chat);
}

function editMessage(i) {
  const chat = currentChat();
  if (!chat || busy) return;
  const m = chat.messages[i];
  if (!m || m.role !== 'user') return;
  $('input').value = m.content === '(file attached)' ? '' : m.content;
  pendingAttachments = (m.attachments || []).slice();
  chat.messages.splice(i); // remove this message and everything after it
  saveChats();
  renderAll();
  autosize();
  $('input').focus();
}

function onMessageClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.classList.contains('copy-code')) {
    copyText(btn.closest('.code').querySelector('code').textContent);
    toast('Code copied');
    return;
  }

  const msgEl = btn.closest('.msg');
  const i = msgEl ? Number(msgEl.dataset.i) : -1;
  const chat = currentChat();
  const act = btn.dataset.act;

  if (act === 'copy' && chat && chat.messages[i]) {
    copyText(chat.messages[i].content);
    toast('Copied');
  } else if (act === 'edit') {
    editMessage(i);
  } else if (act === 'regen') {
    regenerate();
  }
}

/* ---------- Generation ---------- */

function setBusy(value) {
  busy = value;
  $('sendBtn').classList.toggle('hidden', value);
  $('stopBtn').classList.toggle('hidden', !value);
}

function buildSystemPrompt(modeKey) {
  const mode = MODES[modeKey] || MODES.general;
  const mc = (settings.mcVersion || DEFAULT_SETTINGS.mcVersion).trim();
  const style = {
    concise: 'Keep answers short and to the point.',
    detailed: 'Give detailed explanations and examples.',
  }[settings.answerStyle] || 'Use balanced detail.';
  const parts = [BASE_RULES, mode.rules.replace(/\{MC\}/g, mc), style];
  const custom = (settings.customInstructions || '').trim();
  if (custom) parts.push('User custom instructions (follow them unless they conflict with the rules above): ' + custom);
  return parts.join('\n\n');
}

// Turns stored messages into API messages. Newest messages are kept first, within a size budget.
function buildApiMessages(msgs) {
  const picked = [];
  let total = 0;
  for (let i = msgs.length - 1; i >= 0 && picked.length < MAX_CONTEXT_MESSAGES; i--) {
    const m = msgs[i];
    let content = m.content || '';
    if (m.role === 'user' && m.attachments && m.attachments.length) {
      content += m.attachments.map((a) => '\n\n--- Attached file: ' + a.name + ' ---\n' + a.text).join('');
    }
    if (total + content.length > CONTEXT_CHAR_BUDGET && picked.length) break;
    total += content.length;
    picked.unshift({ role: m.role, content });
  }
  while (picked.length && picked[0].role !== 'user') picked.shift(); // conversations must start with the user
  return picked;
}

async function generate(chat) {
  const placeholder = { role: 'assistant', content: '', pending: true, ts: Date.now() };
  chat.messages.push(placeholder);
  chat.updatedAt = Date.now();
  saveChats();

  streamingMsg = placeholder;
  streamingIndex = chat.messages.length - 1;
  const history = buildApiMessages(chat.messages.slice(0, -1));
  const system = buildSystemPrompt(chat.mode);
  activeController = new AbortController();
  setBusy(true);
  renderAll();

  try {
    const text = await callProvider(history, system, {
      stream: settings.streaming !== false,
      signal: activeController.signal,
      onDelta: (full) => {
        placeholder.content = full;
        scheduleStreamUpdate();
      },
    });
    placeholder.content = (text || '').trim() || 'Model ne khaali response diya. Dusra model ya prompt try karo.';
  } catch (e) {
    const partial = placeholder.content ? placeholder.content + '\n\n' : '';
    if (e && e.name === 'AbortError') {
      placeholder.content = partial + '*(Stopped)*';
    } else {
      placeholder.error = true;
      placeholder.content = partial + 'Request error: ' + ((e && e.message) || 'unknown error') +
        '\n\nSettings mein provider, API key, model ID aur usage limits check karo.';
    }
  } finally {
    delete placeholder.pending;
    streamingMsg = null;
    streamingIndex = -1;
    activeController = null;
    setBusy(false);
    chat.updatedAt = Date.now();
    saveChats();
    renderAll();
  }
}

/* ---------- Providers ---------- */

function temperatureValue() {
  const map = { precise: 0.2, balanced: 0.7, creative: 1 };
  return map[settings.creativity] ?? null; // null = let the model use its default
}

async function callProvider(messages, system, opts = {}) {
  if (!settings.apiKey) throw new Error('API key missing. Settings mein key daalo.');
  if (!settings.model) throw new Error('Model ID missing. Settings mein model ID daalo.');
  if (settings.provider === 'gemini') return callGemini(messages, system, opts);
  return callOpenAICompatible(messages, system, opts);
}

async function readError(r) {
  const raw = await r.text().catch(() => '');
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    msg = (j.error && j.error.message) || j.message || (typeof j.error === 'string' ? j.error : raw);
  } catch {}
  return 'HTTP ' + r.status + (msg ? ': ' + String(msg).slice(0, 400) : '');
}

// Reads a server-sent-events stream and calls onDelta with the full text so far.
async function readSSE(response, pick, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handle = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch { return; }
    const piece = pick(json); // may throw if the provider sent an error mid-stream
    if (piece) {
      full += piece;
      if (onDelta) onDelta(full);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  return full;
}

async function callOpenAICompatible(messages, system, opts) {
  const base = settings.provider === 'openai'
    ? 'https://api.openai.com/v1'
    : (settings.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey };
  if (settings.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://mrgozoprince-oss.github.io/ashok-gpt/';
    headers['X-Title'] = 'ASHOK GPT';
  }

  const body = {
    model: settings.model,
    messages: [{ role: 'system', content: system }, ...messages],
    stream: !!opts.stream,
  };
  const temperature = temperatureValue();
  if (temperature !== null) body.temperature = temperature;

  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok) throw new Error(await readError(r));

  if (opts.stream && r.body && r.body.getReader) {
    return readSSE(r, (j) => {
      if (j.error) throw new Error(j.error.message || 'Stream error');
      return (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
    }, opts.onDelta);
  }

  const data = await r.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function callGemini(messages, system, opts) {
  const model = settings.model.replace(/^models\//, '').trim();
  const method = opts.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':' + method;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  };
  const temperature = temperatureValue();
  if (temperature !== null) body.generationConfig = { temperature };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!r.ok) throw new Error(await readError(r));

  const pick = (j) => {
    if (j.error) throw new Error(j.error.message || 'Gemini error');
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    return parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  };

  if (opts.stream && r.body && r.body.getReader) return readSSE(r, pick, opts.onDelta);
  return pick(await r.json());
}

/* ---------- Attachments ---------- */

async function onFilesPicked(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      toast('Ek baar mein max ' + MAX_ATTACHMENTS + ' files');
      break;
    }
    if (f.size > MAX_FILE_BYTES) { toast(f.name + ' 300 KB se badi hai'); continue; }
    try {
      const text = await readTextFile(f);
      if (text === null) { toast(f.name + ' text file nahi lagti'); continue; }
      const cut = text.length > MAX_FILE_CHARS;
      pendingAttachments.push({
        name: f.name,
        text: cut ? text.slice(0, MAX_FILE_CHARS) + '\n...[truncated]' : text,
      });
    } catch {
      toast('File read nahi ho paayi: ' + f.name);
    }
  }
  renderAttachments();
}

/* ---------- Settings ---------- */

function setSettingsStatus(msg) {
  $('settingsStatus').textContent = msg;
}

function updateProviderRows() {
  const p = $('provider').value;
  $('baseUrlRow').classList.toggle('hidden', !(p === 'openrouter' || p === 'custom'));
}

function onProviderChange() {
  const p = $('provider').value;
  if (p === 'gemini') $('model').value = 'gemini-2.5-flash';
  if (p === 'openai') $('model').value = 'gpt-4o-mini';
  if (p === 'openrouter') {
    $('model').value = 'openai/gpt-4o-mini';
    $('baseUrl').value = 'https://openrouter.ai/api/v1';
  }
  if (p === 'custom' && !$('baseUrl').value.trim()) $('baseUrl').value = 'https://your-provider.example/v1';
  updateProviderRows();
}

function fillSettingsForm() {
  $('provider').value = settings.provider || 'openrouter';
  $('apiKey').value = settings.apiKey || '';
  $('model').value = settings.model || '';
  $('baseUrl').value = settings.baseUrl || '';
  $('mcVersion').value = settings.mcVersion || DEFAULT_SETTINGS.mcVersion;
  $('creativity').value = settings.creativity || 'default';
  $('streaming').checked = settings.streaming !== false;
  $('answerStyle').value = settings.answerStyle || 'balanced';
  $('customInstructions').value = settings.customInstructions || '';
  $('defaultMode').value = settings.defaultMode || 'general';
  $('enterToSend').checked = !!settings.enterToSend;
  updateProviderRows();
}

function readSettingsForm() {
  return {
    provider: $('provider').value,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    baseUrl: $('baseUrl').value.trim(),
    mcVersion: $('mcVersion').value.trim() || DEFAULT_SETTINGS.mcVersion,
    creativity: $('creativity').value,
    streaming: $('streaming').checked,
    answerStyle: $('answerStyle').value,
    customInstructions: $('customInstructions').value.trim().slice(0, 1500),
    defaultMode: $('defaultMode').value,
    enterToSend: $('enterToSend').checked,
  };
}

function openSettings() {
  $('apiKey').type = 'password';
  $('toggleKey').textContent = 'Show';
  fillSettingsForm();
  setSettingsStatus(settings.apiKey ? 'Settings saved on this device.' : 'Abhi koi API key save nahi hai.');
  openPanel('settingsPanel');
}

function onSaveSettings() {
  const next = readSettingsForm();
  if (next.provider === 'custom' && !next.baseUrl) {
    setSettingsStatus('Custom provider ke liye API base URL daalo.');
    return;
  }
  settings = { ...settings, ...next };
  if (settings.provider === 'openrouter' && !settings.baseUrl) settings.baseUrl = DEFAULT_SETTINGS.baseUrl;
  if (persistSettings()) {
    setSettingsStatus('Settings saved on this device.');
    toast('Settings saved');
  }
  updateConnectionUI();
  renderModePill();
}

async function testConnection() {
  const next = readSettingsForm();
  if (!next.apiKey) { setSettingsStatus('Pehle API key daalo.'); return; }
  settings = { ...settings, ...next };
  persistSettings();
  updateConnectionUI();
  setSettingsStatus('Testing…');
  try {
    const reply = await callProvider(
      [{ role: 'user', content: 'Reply with exactly: ASHOK GPT connection successful.' }],
      'You are running a connection test. Keep the reply very short.',
      { stream: false }
    );
    setSettingsStatus('Connected. Model reply: ' + ((reply || '').trim().slice(0, 160) || '(empty)'));
  } catch (e) {
    setSettingsStatus('Connection failed: ' + ((e && e.message) || 'unknown error'));
  }
}

function onForgetKey() {
  settings.apiKey = '';
  $('apiKey').value = '';
  persistSettings();
  updateConnectionUI();
  setSettingsStatus('Saved API key removed.');
}

function exportChats() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), chats }, null, 2)], { type: 'application/json' });
  download(blob, 'ashok-gpt-chats.json');
  toast('Export started');
}

async function onDeleteAll() {
  if (busy) { toast('Pehle response complete hone do'); return; }
  const ok = await askDialog({
    title: 'Saare chats delete karein?',
    text: 'Ye sab chats is device se hamesha ke liye delete ho jayengi.',
    okText: 'Delete all',
    danger: true,
  });
  if (!ok) return;
  chats = [];
  currentId = null;
  pendingAttachments = [];
  saveChats();
  renderAll();
  toast('All chats deleted');
}

/* ---------- Dialog (replaces browser prompt/confirm, which Android WebView may block) ---------- */

function askDialog({ title, text = '', input = null, okText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    if (dialogResolve) dialogResolve(null);
    dialogResolve = resolve;
    $('dlgTitle').textContent = title;
    $('dlgText').textContent = text;
    const inp = $('dlgInput');
    inp.classList.toggle('hidden', input === null);
    inp.value = input === null ? '' : input;
    const ok = $('dlgOk');
    ok.textContent = okText;
    ok.className = danger ? 'danger-btn' : 'primary-btn';
    $('dlgBack').classList.remove('hidden');
    if (input !== null) setTimeout(() => { inp.focus(); inp.select(); }, 60);
  });
}

function closeDialog(result) {
  $('dlgBack').classList.add('hidden');
  const resolve = dialogResolve;
  dialogResolve = null;
  if (resolve) resolve(result);
}

function onDialogOk() {
  const inp = $('dlgInput');
  if (inp.classList.contains('hidden')) { closeDialog(true); return; }
  const v = inp.value.trim();
  closeDialog(v || null);
}

/* ---------- Wiring ---------- */

function bindEvents() {
  $('newChat').addEventListener('click', newChat);
  $('topNew').addEventListener('click', newChat);
  $('menuBtn').addEventListener('click', openSidebar);
  $('closeSide').addEventListener('click', closeSidebar);
  $('scrim').addEventListener('click', closeSidebar);
  $('chatSearch').addEventListener('input', renderChatList);
  $('chatList').addEventListener('click', onChatListClick);

  $('modePill').addEventListener('click', showModeSheet);
  $('closeMode').addEventListener('click', () => closePanel('modeSheet'));
  $('modeSheet').addEventListener('click', (e) => { if (e.target.id === 'modeSheet') closePanel('modeSheet'); });

  $('settingsBtn').addEventListener('click', openSettings);
  $('sideSettings').addEventListener('click', () => { closeSidebar(); openSettings(); });
  $('closeSettings').addEventListener('click', () => closePanel('settingsPanel'));
  $('provider').addEventListener('change', onProviderChange);
  $('toggleKey').addEventListener('click', () => {
    const k = $('apiKey');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('toggleKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
  });
  $('saveSettings').addEventListener('click', onSaveSettings);
  $('saveSettings2').addEventListener('click', onSaveSettings);
  $('testConnection').addEventListener('click', testConnection);
  $('forgetKey').addEventListener('click', onForgetKey);
  $('exportChats').addEventListener('click', exportChats);
  $('deleteAll').addEventListener('click', onDeleteAll);

  $('composer').addEventListener('submit', (e) => { e.preventDefault(); sendFromInput(); });
  $('input').addEventListener('input', autosize);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && settings.enterToSend) {
      e.preventDefault();
      sendFromInput();
    }
  });
  $('stopBtn').addEventListener('click', () => { if (activeController) activeController.abort(); });
  $('attachBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', onFilesPicked);
  $('messages').addEventListener('click', onMessageClick);

  $('dlgCancel').addEventListener('click', () => closeDialog(null));
  $('dlgOk').addEventListener('click', onDialogOk);
  $('dlgInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onDialogOk(); }
  });
  $('dlgBack').addEventListener('click', (e) => { if (e.target.id === 'dlgBack') closeDialog(null); });
}

function init() {
  loadSettings();
  loadChats();
  currentId = mostRecentId();
  renderSuggestions();
  renderModeSheet();
  bindEvents();
  renderAll();
  autosize();
}

if (typeof document !== 'undefined' && document.getElementById('messages')) init();
