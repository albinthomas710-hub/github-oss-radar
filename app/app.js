// =====================================================================
// GitHub OSS Radar - app.js
// Pure vanilla JS. Talks only to api.github.com. Stores everything in
// localStorage. No build step, no dependencies.
// =====================================================================

const API = 'https://api.github.com';

// ---------- Storage helpers ----------
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        // Evict heavy caches first to free space
        const evictKeys = ['insiderCache', 'releasesCache'];
        for (const k of evictKeys) localStorage.removeItem(k);
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          console.warn('localStorage full — could not save', key);
          toast('Storage nearly full — some caches cleared', 'error');
        }
      }
    }
  },
  usage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      total += (localStorage.getItem(k) || '').length;
    }
    return total;
  }
};

const DEFAULT_FOLLOWS = [
  'karpathy', 'simonw', 'ggerganov', 'jeremyhoward', 'swyxio',
  'anthropics', 'openai', 'huggingface', 'langchain-ai', 'vercel',
  'microsoft', 'google-deepmind'
];

const DEFAULT_TOPICS = [
  'claude-code', 'mcp', 'ai-agents', 'llm', 'rag',
  'copilot', 'developer-tools', 'cli', 'agentic', 'open-source'
];

// Interest-based discovery lanes — composite queries that find gold Instagram curators would post
const INTEREST_LANES = [
  {
    id: 'ai-agents', name: '🤖 AI Agents & LLMs', color: '#a855f7',
    queries: [
      'topic:ai-agents stars:>50 pushed:>={since}',
      '"ai agent" OR "llm" OR "autonomous agent" stars:>100 pushed:>={since}',
      'topic:langchain OR topic:autogpt OR topic:crewai stars:>20 pushed:>={since}',
    ],
    keywords: ['agent','agents','llm','gpt','claude','anthropic','openai','langchain','autogpt','crewai','autonomous','reasoning','chain-of-thought','rag','retrieval','embedding']
  },
  {
    id: 'claude-mcp', name: '⚡ Claude & MCP & Cursor', color: '#7c9cff',
    queries: [
      'topic:claude-code OR topic:mcp stars:>10 pushed:>={since}',
      '"claude code" OR "cursor" OR "mcp server" OR "claude skill" stars:>20 pushed:>={since}',
      '"model context protocol" OR "anthropic" stars:>30 pushed:>={since}',
    ],
    keywords: ['claude','claude-code','cursor','mcp','anthropic','model-context-protocol','sonnet','opus','haiku','claude-skill','windsurf','cline']
  },
  {
    id: 'startup-tools', name: '🚀 Startup & SaaS Tools', color: '#10b981',
    queries: [
      'topic:saas OR topic:boilerplate stars:>100 pushed:>={since}',
      '"saas" OR "boilerplate" OR "starter-kit" OR "indie hacker" stars:>50 pushed:>={since}',
      'topic:startup OR topic:mvp OR topic:landing-page stars:>30 pushed:>={since}',
    ],
    keywords: ['saas','startup','boilerplate','starter','mvp','landing-page','stripe','payment','auth','waitlist','indie-hacker','shipfast','launch','pricing','monetize']
  },
  {
    id: 'dev-tools', name: '🛠 Developer Tools & CLI', color: '#f59e0b',
    queries: [
      'topic:developer-tools OR topic:cli stars:>100 pushed:>={since}',
      'topic:devtools OR topic:productivity stars:>50 pushed:>={since}',
      '"developer tool" OR "dev tool" OR "command line" stars:>80 pushed:>={since}',
    ],
    keywords: ['cli','terminal','devtools','developer-tool','productivity','automation','workflow','build-tool','linter','formatter','debugger','profiler']
  },
  {
    id: 'frontend', name: '🎨 Frontend & UI', color: '#ec4899',
    queries: [
      'topic:ui-components OR topic:design-system stars:>100 pushed:>={since}',
      'topic:react OR topic:nextjs OR topic:tailwindcss stars:>200 pushed:>={since}',
      '"ui library" OR "component library" OR "design system" stars:>50 pushed:>={since}',
    ],
    keywords: ['react','nextjs','tailwind','ui','component','design-system','css','animation','shadcn','radix','framer-motion','svelte','vue','astro']
  },
];

// Score a repo against interest lanes (0-100)
function laneScore(repo, lane) {
  const blob = [
    repo.full_name || '',
    repo.description || '',
    (repo.topics || []).join(' ')
  ].join(' ').toLowerCase();
  const tokens = blob.split(/[^a-z0-9\-]+/).filter(Boolean);
  let hits = 0;
  for (const kw of lane.keywords) {
    if (tokens.includes(kw) || blob.includes(kw)) hits++;
  }
  if (!hits) return 0;
  let score = Math.min(60, hits * 15);
  const stars = repo.stargazers_count || 0;
  if (stars >= 1000) score += 20;
  else if (stars >= 200) score += 12;
  else if (stars >= 50) score += 6;
  const ts = tasteScore(repo);
  if (ts >= 5) score += 15;
  else if (ts >= 2) score += 8;
  return Math.min(100, score);
}

function bestLane(repo) {
  let best = null, bestScore = 0;
  for (const lane of INTEREST_LANES) {
    const s = laneScore(repo, lane);
    if (s > bestScore) { bestScore = s; best = lane; }
  }
  return best && bestScore >= 15 ? { lane: best, score: bestScore } : null;
}

function laneLabel(repo) {
  const b = bestLane(repo);
  if (!b) return '';
  return `<span class="badge" style="background:${b.lane.color}22;color:${b.lane.color};border:1px solid ${b.lane.color}44;">${b.lane.name.split(' ')[0]} ${b.score}</span>`;
}

const STATE = {
  token:   LS.get('pat', ''),
  ghUser:  LS.get('ghUser', ''),                          // user's GitHub handle for import
  follows: LS.get('follows', DEFAULT_FOLLOWS),
  followMeta: LS.get('followMeta', {}),                   // login -> {name, avatar_url, bio, ...}
  saved:   LS.get('saved', []),                           // {full_name, html_url, description, stars, language, created_at, topics, savedAt, collections:[], tags:[]}
  topics:  LS.get('topics', DEFAULT_TOPICS),              // user-editable
  collections: LS.get('collections', []),                 // [{id, name}]
  activeCollection: LS.get('activeCollection', 'all'),    // 'all' | 'uncategorized' | <collection id>
  lastSeen: LS.get('lastSeen', {}),
  refreshIntervalMs: LS.get('refreshIntervalMs', 3600000),
  cache: {},
};

// ---------- Modal ----------
function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal-box">${html}</div></div>`;
  const backdrop = root.firstElementChild;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', escClose);
  return root.querySelector('.modal-box');
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}
function escClose(e) { if (e.key === 'Escape') closeModal(); }

// ---------- GitHub login (PAT-based, feels like real login) ----------
// Cached user profile
Object.assign(STATE, { user: LS.get('user', null) });

async function fetchMyProfile(token) {
  const res = await fetch(`${API}/user`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) throw new Error(`Invalid token (GitHub ${res.status})`);
  return res.json();
}

function renderLoginUI() {
  const loginBtn = document.getElementById('btn-login');
  const badge    = document.getElementById('user-badge');
  if (STATE.user && STATE.token) {
    loginBtn.classList.add('hidden');
    badge.classList.remove('hidden');
    badge.classList.add('flex');
    document.getElementById('user-avatar').src = STATE.user.avatar_url;
    document.getElementById('user-login').textContent = '@' + STATE.user.login;
    document.getElementById('subtitle').textContent = `Signed in as ${STATE.user.name || STATE.user.login} · rate limit 5,000/hr`;
  } else {
    loginBtn.classList.remove('hidden');
    badge.classList.add('hidden');
    badge.classList.remove('flex');
    document.getElementById('subtitle').textContent = 'Sign in with GitHub for faster loads and one-click imports';
  }
}

async function applyToken(token) {
  const user = await fetchMyProfile(token);
  STATE.token = token;
  STATE.user  = { login: user.login, name: user.name, avatar_url: user.avatar_url, html_url: user.html_url, following: user.following, public_repos: user.public_repos };
  STATE.ghUser = user.login;
  LS.set('pat', token);
  LS.set('user', STATE.user);
  LS.set('ghUser', STATE.ghUser);
  const patInput = document.getElementById('pat-input');
  if (patInput) patInput.value = token;
  renderLoginUI();
  toast(`Welcome, ${user.name || user.login}`, 'success');
  return user;
}

let terminalPollAbort = null;

function openLoginModal() {
  const box = openModal(`
    <h3>🔐 Sign in with GitHub</h3>
    <p class="hint">Pick whichever method feels easier. Your token stays on this machine — only sent to api.github.com.</p>

    <div class="bg-ink-800 border border-accent-600 rounded-lg p-4 mt-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-lg">🖥</span>
        <strong class="text-sm">Terminal sign-in <span class="text-xs text-accent-400 font-normal">recommended</span></strong>
      </div>
      <ol class="text-xs text-slate-300 space-y-1 list-decimal list-inside ml-1">
        <li>Open a terminal in the <code>app</code> folder</li>
        <li>Run: <code class="bg-ink-900 px-1.5 py-0.5 rounded">python login.py</code> (or double-click <code>login.bat</code>)</li>
        <li>Authorize GitHub when prompted (one-time code + browser)</li>
        <li>Come back here — sign-in completes automatically</li>
      </ol>
      <div class="mt-3 flex items-center gap-2">
        <button class="btn-primary" id="m-start-terminal" style="padding:0.45rem 0.8rem;font-size:0.8rem;">Start polling</button>
        <span id="m-terminal-status" class="text-xs text-slate-400"></span>
      </div>
      <div class="text-xs text-slate-500 mt-2">Needs <a href="https://cli.github.com" target="_blank" class="text-accent-400 hover:underline">GitHub CLI</a> + Python 3. The script will tell you what's missing.</div>
    </div>

    <details class="mt-3">
      <summary class="text-xs text-slate-400 cursor-pointer hover:text-slate-200">Or paste a personal access token instead</summary>
      <div class="bg-ink-800 border border-ink-600 rounded-lg p-4 mt-2">
        <div class="text-xs text-slate-300 mb-2">
          <a href="https://github.com/settings/tokens/new?description=GitHub%20OSS%20Radar&scopes=" target="_blank"
             class="text-accent-400 hover:underline">↗ Create a token on GitHub</a> (no scopes needed for public data),
          then paste it here.
        </div>
        <input id="m-token" type="password" placeholder="ghp_… or github_pat_…" autocomplete="off" />
        <div class="modal-actions" style="margin-top:0.75rem;">
          <button class="btn-primary" id="m-go" style="padding:0.45rem 0.9rem;font-size:0.85rem;">Sign in with token</button>
        </div>
      </div>
    </details>

    <div id="m-status" class="text-xs text-slate-400 mt-3"></div>

    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Close</button>
    </div>
  `);

  const status = box.querySelector('#m-status');
  const tStatus = box.querySelector('#m-terminal-status');

  box.querySelector('#m-cancel').addEventListener('click', () => {
    if (terminalPollAbort) { terminalPollAbort.abort(); terminalPollAbort = null; }
    closeModal();
  });

  // --- Terminal polling ---
  box.querySelector('#m-start-terminal').addEventListener('click', async () => {
    const btn = box.querySelector('#m-start-terminal');
    btn.disabled = true;
    btn.textContent = 'Polling…';
    tStatus.innerHTML = '<span class="text-accent-400">Waiting for <code>localhost:8765</code>… run <code>python login.py</code> now.</span>';
    if (terminalPollAbort) terminalPollAbort.abort();
    terminalPollAbort = new AbortController();
    const signal = terminalPollAbort.signal;
    const start = Date.now();
    const TIMEOUT = 180000; // 3 min
    let attempts = 0;
    while (!signal.aborted && Date.now() - start < TIMEOUT) {
      attempts++;
      try {
        const res = await fetch('http://localhost:8765/token', { signal, mode: 'cors' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.token) {
            tStatus.innerHTML = '<span class="text-emerald-400">✓ Got token, verifying…</span>';
            try {
              await applyToken(data.token);
              closeModal();
              offerFirstTimeImport();
              return;
            } catch (e) {
              tStatus.innerHTML = `<span class="text-red-400">Token invalid: ${escapeHtml(e.message)}</span>`;
              btn.disabled = false; btn.textContent = 'Try again';
              return;
            }
          }
        }
      } catch { /* connection refused — script not running yet */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!signal.aborted) {
      tStatus.innerHTML = `<span class="text-slate-400">Timed out after ${attempts} attempts. Run <code>python login.py</code> first, then click again.</span>`;
      btn.disabled = false; btn.textContent = 'Start polling';
    }
  });

  // --- Manual token paste ---
  const tokenInput = box.querySelector('#m-token');
  tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('#m-go').click(); });
  box.querySelector('#m-go').addEventListener('click', async () => {
    const t = tokenInput.value.trim();
    if (!t) { status.innerHTML = '<span class="text-red-400">Paste a token first.</span>'; return; }
    box.querySelector('#m-go').textContent = 'Verifying…';
    box.querySelector('#m-go').disabled = true;
    try {
      await applyToken(t);
      closeModal();
      offerFirstTimeImport();
    } catch (e) {
      status.innerHTML = `<span class="text-red-400">${escapeHtml(e.message)}</span>`;
      box.querySelector('#m-go').textContent = 'Sign in with token';
      box.querySelector('#m-go').disabled = false;
    }
  });
}

function logout() {
  if (!confirm('Sign out and clear your token? (Saves, follows, and collections stay.)')) return;
  STATE.token = '';
  STATE.user  = null;
  STATE.ghUser = '';
  LS.set('pat', '');
  LS.set('ghUser', '');
  localStorage.removeItem('user');
  // Clear server-side caches so re-sign-in fetches fresh
  STATE.cache = {};
  localStorage.removeItem('insiderCache');
  localStorage.removeItem('releasesCache');
  const patInput = document.getElementById('pat-input');
  if (patInput) patInput.value = '';
  renderLoginUI();
  toast('Signed out');
}

function offerFirstTimeImport() {
  // Only offer if they have few saves/follows (looks like a fresh account)
  const light = STATE.saved.length < 5 && STATE.follows.length <= DEFAULT_FOLLOWS.length;
  if (!light) return;
  setTimeout(() => {
    const box = openModal(`
      <h3>Welcome, @${escapeHtml(STATE.user.login)} 👋</h3>
      <p class="hint">Want to import your GitHub stars and follows now? One click, fully local.</p>
      <label class="flex items-center gap-2 mt-3"><input type="checkbox" id="m-follows" checked /> <span>Import people you follow (~${STATE.user.following || '?'} accounts)</span></label>
      <label class="flex items-center gap-2 mt-2"><input type="checkbox" id="m-stars" checked /> <span>Import your most recent 200 stars</span></label>
      <div id="m-status" class="text-xs text-slate-400 mt-3"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="m-cancel">Skip</button>
        <button class="btn-primary"   id="m-go">Import</button>
      </div>
    `);
    box.querySelector('#m-cancel').addEventListener('click', closeModal);
    box.querySelector('#m-go').addEventListener('click', async () => {
      const wantF = box.querySelector('#m-follows').checked;
      const wantS = box.querySelector('#m-stars').checked;
      const status = box.querySelector('#m-status');
      box.querySelector('#m-go').textContent = 'Importing…';
      box.querySelector('#m-go').disabled = true;
      try {
        if (wantF) {
          status.textContent = 'Importing follows…';
          await importFollowsForUser(STATE.user.login);
        }
        if (wantS) {
          status.textContent = 'Importing stars…';
          await importStarsForUser(STATE.user.login, 200);
        }
        closeModal();
        toast('All set. Your radar is tuned.', 'success');
        setTab('briefing');
      } catch (e) {
        status.innerHTML = `<span style="color:#ef4444">${escapeHtml(e.message)}</span>`;
        box.querySelector('#m-go').textContent = 'Retry';
        box.querySelector('#m-go').disabled = false;
      }
    });
  }, 300);
}

async function importFollowsForUser(u) {
  let page = 1, added = 0;
  while (page <= 5) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
    const res = await fetch(`${API}/users/${encodeURIComponent(u)}/following?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const arr = await res.json();
    if (!arr.length) break;
    for (const person of arr) {
      if (STATE.follows.includes(person.login)) continue;
      STATE.follows.push(person.login);
      STATE.followMeta[person.login] = { avatar_url: person.avatar_url };
      added++;
    }
    if (arr.length < 100) break;
    page++;
  }
  LS.set('follows', STATE.follows);
  LS.set('followMeta', STATE.followMeta);
  return added;
}

async function importStarsForUser(u, limit = 200) {
  let page = 1, added = 0;
  while (page <= 10 && added < limit) {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
    const res = await fetch(`${API}/users/${encodeURIComponent(u)}/starred?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const arr = await res.json();
    if (!arr.length) break;
    for (const repo of arr) {
      if (added >= limit) break;
      if (STATE.saved.some(r => r.full_name === repo.full_name)) continue;
      addSavedRepo(repo);
      added++;
    }
    if (arr.length < 100) break;
    page++;
  }
  LS.set('saved', STATE.saved);
  return added;
}

// ---------- Taste model ----------
const TASTE = {
  topics: LS.get('taste.topics', {}),   // topic -> score
  langs:  LS.get('taste.langs',  {}),   // language -> score
  hidden: LS.get('taste.hidden', []),   // [full_name]
};

let _tasteSaveTimer;
function _scheduleTasteSave() {
  clearTimeout(_tasteSaveTimer);
  _tasteSaveTimer = setTimeout(() => {
    LS.set('taste.topics', TASTE.topics);
    LS.set('taste.langs',  TASTE.langs);
  }, 250);
}
function recordSignal(repo, weight) {
  for (const t of (repo.topics || [])) {
    TASTE.topics[t] = (TASTE.topics[t] || 0) + weight;
  }
  if (repo.language) {
    TASTE.langs[repo.language] = (TASTE.langs[repo.language] || 0) + weight * 0.5;
  }
  _scheduleTasteSave();
}

function tasteScore(repo) {
  let s = 0;
  for (const t of (repo.topics || [])) s += (TASTE.topics[t] || 0);
  if (repo.language) s += (TASTE.langs[repo.language] || 0);
  return s;
}

function isHidden(fullName) { return TASTE.hidden.includes(fullName); }
function hideRepo(fullName, repo) {
  if (!TASTE.hidden.includes(fullName)) TASTE.hidden.push(fullName);
  LS.set('taste.hidden', TASTE.hidden);
  if (repo) recordSignal(repo, -1);
  toast('Hidden — similar repos demoted');
}

// ---------- Velocity ----------
function velocityFor(repo) {
  const ageMs = Date.now() - new Date(repo.created_at || repo.pushed_at || Date.now()).getTime();
  const ageDays = Math.max(1, ageMs / 86400000);
  return Math.round((repo.stargazers_count || 0) / ageDays);
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

// AI/DEV keyword tagging
const KW = ['ai','llm','gpt','claude','agent','machine-learning','deep-learning',
  'generative','copilot','assistant','automation','dev-tool','developer-tool','cli','mcp'];

function isAiDev(repo) {
  const blob = [
    repo.description || '',
    repo.full_name || '',
    (repo.topics || []).join(' ')
  ].join(' ').toLowerCase();
  const tokens = blob.split(/[^a-z0-9\-]+/).filter(Boolean);
  return KW.some(k => tokens.includes(k));
}

// ---------- Network ----------
// Search API rate limiter: GitHub allows 30 search req/min.
// We queue search calls and enforce minimum spacing.
const _searchQueue = { last: 0, pending: Promise.resolve() };
const SEARCH_MIN_GAP_MS = 2200; // ~27 req/min max, safe margin

function ghSearch(path, opts = {}) {
  _searchQueue.pending = _searchQueue.pending.then(async () => {
    const now = Date.now();
    const wait = SEARCH_MIN_GAP_MS - (now - _searchQueue.last);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _searchQueue.last = Date.now();
  });
  return _searchQueue.pending.then(() => gh(path, opts));
}

async function gh(path, opts = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
  const url = path.startsWith('http') ? path : API + path;
  const res = await fetch(url, { ...opts, headers });
  // surface rate limit
  const rem = res.headers.get('x-ratelimit-remaining');
  const lim = res.headers.get('x-ratelimit-limit');
  if (rem && lim) {
    document.getElementById('rate-limit').textContent = `API: ${rem}/${lim}`;
  }
  if (!res.ok) {
    // Token expired / revoked — auto-detect and prompt
    if (res.status === 401 && STATE.token) {
      STATE.token = '';
      STATE.user = null;
      LS.set('pat', '');
      localStorage.removeItem('user');
      renderLoginUI();
      toast('Token expired — sign in again to continue', 'error');
      throw new Error('Token expired (401). Please sign in again.');
    }
    // Search API secondary rate limit (403 with "rate limit" message)
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      if (body.includes('rate limit') || body.includes('secondary')) {
        toast('GitHub search rate limit hit — wait a moment', 'error');
        throw new Error('Search rate limit exceeded. Wait ~60s and retry.');
      }
      throw new Error(`GitHub 403: ${body.slice(0, 120)}`);
    }
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

// ---------- Toast ----------
let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('border-red-500', 'border-green-500', 'border-ink-600');
  el.classList.add(type === 'error' ? 'border-red-500' : type === 'success' ? 'border-green-500' : 'border-ink-600');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Rendering ----------
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function isSaved(fullName) {
  return STATE.saved.some(r => r.full_name === fullName);
}

function repoCard(repo, opts = {}) {
  const ai      = isAiDev(repo);
  const stars   = fmtNum(repo.stargazers_count || 0);
  const lang    = repo.language || '—';
  const created = fmtDate(repo.created_at);
  const topics  = (repo.topics || []).slice(0, 5);
  const desc    = escapeHtml(repo.description || '_No description_');
  const saved   = isSaved(repo.full_name);
  const isNew   = opts.isNew;
  const rank    = opts.rank ? `<span class="text-slate-500 font-mono text-xs mr-2">#${opts.rank}</span>` : '';
  const vel     = velocityFor(repo);
  const velBadge = vel >= 50 ? `<span class="badge" style="background:linear-gradient(90deg,#f97316,#ef4444);color:#fff;">🚀 +${fmtNum(vel)}/day</span>`
                  : vel >= 10 ? `<span class="badge badge-lang">+${vel}/day</span>` : '';
  const tasteHint = (() => {
    const s = tasteScore(repo);
    if (s >= 5) return '<span class="badge" style="background:#0ea5e9;color:#fff;" title="Matches your taste">✦ for you</span>';
    return '';
  })();
  const extra = opts.extra || '';

  return `
    <div class="repo-card" data-fullname="${escapeHtml(repo.full_name)}" data-ai="${ai}">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            ${rank}
            <a href="${repo.html_url}" target="_blank" class="repo-link font-semibold truncate">${escapeHtml(repo.full_name)}</a>
            ${ai ? '<span class="badge badge-ai">AI/DEV</span>' : ''}
            ${velBadge}
            ${isNew ? '<span class="badge badge-new">NEW</span>' : ''}
            ${tasteHint}
            ${laneLabel(repo)}
          </div>
          <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
            <span>⭐ ${stars}</span>
            <span class="badge badge-lang">${escapeHtml(lang)}</span>
            <span>created ${created}</span>
          </div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button class="btn-icon ${saved ? 'saved' : ''}" data-action="save" title="${saved ? 'Saved' : 'Save'}">${saved ? '★' : '☆'}</button>
          <button class="btn-icon" data-action="hide" title="Not interested">✕</button>
          <a href="${repo.html_url}" target="_blank" class="btn-icon" title="Open on GitHub">↗</a>
        </div>
      </div>
      <p class="text-sm text-slate-300 mb-2 leading-relaxed">${desc}</p>
      ${topics.length ? `<div class="flex flex-wrap gap-1">${topics.map(t => `<span class="text-xs text-slate-500">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      ${extra}
    </div>
  `;
}

function skeleton(n = 3) {
  return Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');
let currentTab = 'trending';
function setTab(name) {
  currentTab = name;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'briefing')  renderBriefingShellIfEmpty();
  if (name === 'insider')   loadInsider();
  if (name === 'releases')  loadReleases();
  if (name === 'trending')  loadTrending();
  if (name === 'following') loadFollowing();
  if (name === 'curated')   loadCurated();
  if (name === 'saved')     renderSaved();
  if (name === 'settings')  renderHiddenList();
}
tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

// ---------- Trending ----------
let trendingFilter = 'all';
let trendingData = { week: [], month: [] };

function bindFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      trendingFilter = c.dataset.filter;
      renderTrending();
    });
  });
}
bindFilterChips();
document.getElementById('search-trending').addEventListener('input', e => {
  trendingFilter = e.target.value ? `q:${e.target.value.toLowerCase()}` : 'all';
  document.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
  if (!e.target.value) document.querySelector('.filter-chip[data-filter="all"]')?.classList.add('active');
  renderTrending();
});

async function loadTrending(force = false) {
  const weekEl = document.getElementById('list-week');
  const monthEl = document.getElementById('list-month');
  const cacheKey = 'trending';
  if (!force && STATE.cache[cacheKey]) {
    trendingData = STATE.cache[cacheKey];
    renderTrending();
    return;
  }
  weekEl.innerHTML = skeleton(5);
  monthEl.innerHTML = skeleton(3);
  try {
    const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    // Fetch both new-and-hot AND established-repos-with-recent-pushes
    const weekNew = await ghSearch(`/search/repositories?q=${encodeURIComponent('created:>=' + since7)}&sort=stars&order=desc&per_page=12`);
    const weekHot = await ghSearch(`/search/repositories?q=${encodeURIComponent('stars:>500 pushed:>=' + since7)}&sort=stars&order=desc&per_page=8`);
    const month = await ghSearch(`/search/repositories?q=${encodeURIComponent('created:>=' + since30)}&sort=stars&order=desc&per_page=8`);
    // Merge and dedupe, sort by velocity (stars/age)
    const seen = new Set();
    const allWeek = [];
    for (const r of [...weekNew.items, ...weekHot.items]) {
      if (seen.has(r.full_name)) continue;
      seen.add(r.full_name);
      allWeek.push(r);
    }
    // Sort by a blended score: velocity + taste + interest lane match
    allWeek.sort((a, b) => {
      const va = velocityFor(a), vb = velocityFor(b);
      const ta = tasteScore(a), tb = tasteScore(b);
      const la = (bestLane(a)?.score || 0), lb = (bestLane(b)?.score || 0);
      return (vb + tb * 10 + lb) - (va + ta * 10 + la);
    });
    trendingData = { week: allWeek.slice(0, 15), month: month.items };
    STATE.cache[cacheKey] = trendingData;
    renderTrending();
  } catch (e) {
    weekEl.innerHTML = `<div class="text-red-400 text-sm">Failed: ${escapeHtml(e.message)}</div>`;
    monthEl.innerHTML = '';
  }
}

function applyFilter(items) {
  let out = items.filter(r => !isHidden(r.full_name));
  // Bubble taste matches up
  out = [...out].sort((a, b) => tasteScore(b) - tasteScore(a));
  if (trendingFilter === 'all') return out;
  if (trendingFilter === 'ai')  return out.filter(isAiDev);
  // Interest lane filters
  const lane = INTEREST_LANES.find(l => l.id === trendingFilter);
  if (lane) return out.filter(r => laneScore(r, lane) >= 15).sort((a, b) => laneScore(b, lane) - laneScore(a, lane));
  if (trendingFilter.startsWith('q:')) {
    const q = trendingFilter.slice(2);
    return out.filter(r =>
      (r.full_name + ' ' + (r.description || '') + ' ' + (r.topics || []).join(' ')).toLowerCase().includes(q)
    );
  }
  return out;
}

function renderTrending() {
  const week  = applyFilter(trendingData.week);
  const month = applyFilter(trendingData.month);
  document.getElementById('list-week').innerHTML  = week.map((r, i) => repoCard(r, { rank: i + 1 })).join('') || '<div class="text-slate-500 text-sm">No matches.</div>';
  document.getElementById('list-month').innerHTML = month.map((r, i) => repoCard(r, { rank: i + 1 })).join('') || '<div class="text-slate-500 text-sm">No matches.</div>';
}

// ---------- Following ----------
function renderFollowCards() {
  const el = document.getElementById('follow-cards');
  if (!STATE.follows.length) {
    el.innerHTML = '<div class="text-sm text-slate-500 col-span-2">Not following anyone yet. Search above or import from your GitHub account.</div>';
    return;
  }
  el.innerHTML = STATE.follows.map(login => {
    const m = STATE.followMeta[login] || {};
    const name = m.name || login;
    const bio  = m.bio || '';
    const avatar = m.avatar_url || `https://github.com/${encodeURIComponent(login)}.png?size=96`;
    return `
      <div class="user-card">
        <img src="${avatar}" alt="" loading="lazy" />
        <div class="info">
          <div class="name">${escapeHtml(name)}</div>
          <div class="handle"><a href="https://github.com/${encodeURIComponent(login)}" target="_blank" class="hover:text-accent-400">@${escapeHtml(login)}</a></div>
          ${bio ? `<div class="bio">${escapeHtml(bio)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn-icon" data-unfollow="${escapeHtml(login)}" title="Unfollow">×</button>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-unfollow]').forEach(b => {
    b.addEventListener('click', () => {
      const u = b.dataset.unfollow;
      STATE.follows = STATE.follows.filter(x => x !== u);
      LS.set('follows', STATE.follows);
      delete STATE.followMeta[u];
      LS.set('followMeta', STATE.followMeta);
      renderFollowCards();
      STATE.cache.following = null;
      loadFollowing(true);
      toast(`Unfollowed ${u}`);
    });
  });
}

// --- User search autocomplete ---
let acTimer, acIndex = -1, acItems = [];
const acInput = document.getElementById('add-user');
const acDrop  = document.getElementById('user-ac');

acInput.addEventListener('input', () => {
  clearTimeout(acTimer);
  const q = acInput.value.trim();
  if (q.length < 2) { acDrop.classList.add('hidden'); acDrop.innerHTML = ''; return; }
  acTimer = setTimeout(() => searchUsers(q), 300);
});
acInput.addEventListener('keydown', e => {
  if (acDrop.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, acItems.length - 1); renderAcHighlight(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0); renderAcHighlight(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (acIndex >= 0 && acItems[acIndex]) pickUser(acItems[acIndex]); }
  else if (e.key === 'Escape') { acDrop.classList.add('hidden'); }
});
document.addEventListener('click', e => { if (!e.target.closest('#add-user') && !e.target.closest('#user-ac')) acDrop.classList.add('hidden'); });

async function searchUsers(q) {
  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
    const res = await fetch(`${API}/search/users?q=${encodeURIComponent(q)}+in:login+in:name&per_page=8`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = await res.json();
    acItems = data.items || [];
    renderAc();
  } catch (e) {
    acDrop.innerHTML = `<div class="ac-item text-red-400 text-sm">${escapeHtml(e.message)}</div>`;
    acDrop.classList.remove('hidden');
  }
}
function renderAc() {
  if (!acItems.length) { acDrop.innerHTML = '<div class="ac-item text-slate-500 text-sm">No matches</div>'; acDrop.classList.remove('hidden'); return; }
  acIndex = 0;
  acDrop.innerHTML = acItems.map((u, i) => `
    <div class="ac-item ${i === 0 ? 'selected' : ''}" data-idx="${i}">
      <img src="${u.avatar_url}&s=64" alt="" />
      <div class="flex-1 min-w-0">
        <div class="ac-name truncate">${escapeHtml(u.login)}${STATE.follows.includes(u.login) ? ' <span class="text-xs text-accent-400">· following</span>' : ''}</div>
        <div class="ac-login">${u.type === 'Organization' ? '🏢 org' : '👤 user'}</div>
      </div>
    </div>`).join('');
  acDrop.classList.remove('hidden');
  acDrop.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('click', () => pickUser(acItems[Number(el.dataset.idx)]));
  });
}
function renderAcHighlight() {
  acDrop.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('selected', i === acIndex));
}
async function pickUser(u) {
  acDrop.classList.add('hidden');
  acInput.value = '';
  if (STATE.follows.includes(u.login)) { toast(`Already following ${u.login}`); return; }
  // Fetch full profile for meta
  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
    const res = await fetch(`${API}/users/${encodeURIComponent(u.login)}`, { headers });
    if (res.ok) {
      const full = await res.json();
      STATE.followMeta[u.login] = { name: full.name, avatar_url: full.avatar_url, bio: full.bio, public_repos: full.public_repos, followers: full.followers, following: full.following };
    } else {
      STATE.followMeta[u.login] = { avatar_url: u.avatar_url };
    }
  } catch {
    STATE.followMeta[u.login] = { avatar_url: u.avatar_url };
  }
  STATE.follows.push(u.login);
  LS.set('follows', STATE.follows);
  LS.set('followMeta', STATE.followMeta);
  renderFollowCards();
  STATE.cache.following = null;
  loadFollowing(true);
  toast(`Following ${u.login}`, 'success');
}

// Import the user's GitHub follows
document.getElementById('btn-import-follows').addEventListener('click', async () => {
  // If signed in, one-click import
  if (STATE.user && STATE.token) {
    toast('Importing your follows…');
    try {
      const added = await importFollowsForUser(STATE.user.login);
      renderFollowCards();
      STATE.cache.following = null;
      loadFollowing(true);
      toast(`Imported ${added} new follows`, 'success');
    } catch (e) { toast(`Import failed: ${e.message}`, 'error'); }
    return;
  }
  // Not signed in — prompt for username
  const box = openModal(`
    <h3>Import your GitHub follows</h3>
    <p class="hint">Tip: <a href="#" id="m-signin-link" class="text-accent-400 hover:underline">sign in</a> and this becomes one-click.</p>
    <label>Your GitHub username</label>
    <input id="m-gh-user" value="${escapeHtml(STATE.ghUser || '')}" placeholder="your-handle" />
    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Cancel</button>
      <button class="btn-primary" id="m-go">Import</button>
    </div>
  `);
  box.querySelector('#m-signin-link').addEventListener('click', e => { e.preventDefault(); closeModal(); openLoginModal(); });
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-go').addEventListener('click', async () => {
    const u = box.querySelector('#m-gh-user').value.trim().replace(/^@/, '');
    if (!u) { toast('Enter a username', 'error'); return; }
    STATE.ghUser = u; LS.set('ghUser', u);
    box.querySelector('#m-go').textContent = 'Importing…';
    box.querySelector('#m-go').disabled = true;
    try {
      const added = await importFollowsForUser(u);
      closeModal();
      renderFollowCards();
      STATE.cache.following = null;
      loadFollowing(true);
      toast(`Imported ${added} new follows`, 'success');
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error');
      box.querySelector('#m-go').textContent = 'Import';
      box.querySelector('#m-go').disabled = false;
    }
  });
});

async function loadFollowing(force = false) {
  renderFollowCards();
  const list = document.getElementById('list-following');
  if (!STATE.follows.length) { list.innerHTML = '<div class="text-slate-500 text-sm">Add some people above. Try karpathy, simonw, anthropics.</div>'; return; }
  if (!force && STATE.cache.following) {
    renderFollowingList(STATE.cache.following);
    return;
  }
  list.innerHTML = skeleton(5);
  try {
    // Batch users into search queries (max ~5 users per query to stay under URL limits)
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const all = [];
    const batchSize = 5;
    for (let i = 0; i < STATE.follows.length; i += batchSize) {
      const batch = STATE.follows.slice(i, i + batchSize);
      const q = batch.map(u => `user:${u}`).join(' ') + ` pushed:>=${since}`;
      const data = await ghSearch(`/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=30`);
      all.push(...data.items);
    }
    // Sort newest pushed first
    all.sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));
    // Detect "new since last seen" + fire notifications
    const newOnes = [];
    for (const r of all) {
      const owner = r.owner.login;
      const seen = STATE.lastSeen[owner];
      if (!seen || new Date(r.created_at) > new Date(seen)) {
        if (seen) newOnes.push(r);   // only notify if we had a baseline
      }
    }
    // Update lastSeen baseline (per user, take their newest created)
    const newest = {};
    for (const r of all) {
      const u = r.owner.login;
      if (!newest[u] || new Date(r.created_at) > new Date(newest[u])) newest[u] = r.created_at;
    }
    for (const u of Object.keys(newest)) STATE.lastSeen[u] = newest[u];
    LS.set('lastSeen', STATE.lastSeen);
    if (newOnes.length) fireNotifications(newOnes);
    STATE.cache.following = all;
    renderFollowingList(all);
  } catch (e) {
    list.innerHTML = `<div class="text-red-400 text-sm">Failed: ${escapeHtml(e.message)}</div>`;
  }
}
function renderFollowingList(items) {
  const list = document.getElementById('list-following');
  const visible = (items || []).filter(r => !isHidden(r.full_name));
  if (!visible.length) { list.innerHTML = '<div class="text-slate-500 text-sm">No recent activity from your follows (90-day window).</div>'; return; }
  list.innerHTML = visible.map(r => {
    const isNew = STATE.lastSeen[r.owner.login] && new Date(r.created_at).getTime() > Date.now() - 7 * 86400000;
    return repoCard(r, { isNew });
  }).join('');
}

// ---------- Curated ----------
let activeTopic = STATE.topics[0] || 'ai';
function renderTopicChips() {
  const wrap = document.getElementById('topic-chips');
  // Interest lanes first (built-in, not deletable)
  const laneChips = INTEREST_LANES.map(l =>
    `<span class="topic-chip ${l.id === activeTopic ? 'active' : ''}" data-topic="${escapeHtml(l.id)}" style="${l.id === activeTopic ? `background:${l.color};border-color:${l.color};` : `border-color:${l.color}55;color:${l.color};`}">
      <span class="topic-label">${l.name}</span>
    </span>`
  ).join('');
  // User custom topics (deletable)
  const customChips = STATE.topics.filter(t => !INTEREST_LANES.some(l => l.id === t)).map(t =>
    `<span class="topic-chip ${t === activeTopic ? 'active' : ''}" data-topic="${escapeHtml(t)}">
      <span class="topic-label">${escapeHtml(t)}</span>
      <button class="topic-del" data-del-topic="${escapeHtml(t)}" title="Remove">×</button>
    </span>`
  ).join('');
  wrap.innerHTML = laneChips + customChips;
  if (!INTEREST_LANES.length && !STATE.topics.length) {
    wrap.innerHTML = '<div class="text-sm text-slate-500">No topics yet. Add one above.</div>';
    return;
  }
  wrap.querySelectorAll('.topic-chip').forEach(b => {
    b.addEventListener('click', (e) => {
      if (e.target.closest('.topic-del')) return;
      activeTopic = b.dataset.topic;
      renderTopicChips();
      loadCurated(true);
    });
  });
  wrap.querySelectorAll('.topic-del').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = b.dataset.delTopic;
      STATE.topics = STATE.topics.filter(x => x !== t);
      LS.set('topics', STATE.topics);
      delete STATE.cache[`curated:${t}`];
      if (activeTopic === t) activeTopic = STATE.topics[0] || '';
      renderTopicChips();
      if (activeTopic) loadCurated(true);
      else document.getElementById('list-curated').innerHTML = '<div class="text-sm text-slate-500">Add a topic to get started.</div>';
      toast(`Removed topic: ${t}`);
    });
  });
}

document.getElementById('btn-add-topic').addEventListener('click', addTopic);
document.getElementById('add-topic').addEventListener('keydown', e => { if (e.key === 'Enter') addTopic(); });
function addTopic() {
  const inp = document.getElementById('add-topic');
  let t = inp.value.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
  if (!t) return;
  if (STATE.topics.includes(t)) { toast('Topic already added'); return; }
  STATE.topics.push(t);
  LS.set('topics', STATE.topics);
  activeTopic = t;
  inp.value = '';
  renderTopicChips();
  loadCurated(true);
  toast(`Added topic: ${t}`, 'success');
}
async function loadCurated(force = false) {
  renderTopicChips();
  const list = document.getElementById('list-curated');
  if (!activeTopic) { list.innerHTML = '<div class="text-sm text-slate-500">Add a topic to get started.</div>'; return; }

  // Check if this is an interest lane or a plain topic
  const lane = INTEREST_LANES.find(l => l.id === activeTopic);
  const key = `curated:${activeTopic}`;
  const paint = (items) => {
    const visible = (items || []).filter(r => !isHidden(r.full_name));
    if (lane) {
      // Sort by lane relevance score
      visible.sort((a, b) => laneScore(b, lane) - laneScore(a, lane));
    }
    list.innerHTML = visible.length
      ? visible.map(r => {
          const score = lane ? laneScore(r, lane) : 0;
          const scoreBadge = score >= 40 ? `<div class="text-xs mt-2 pt-2 border-t border-ink-700"><span class="badge" style="background:${lane.color}22;color:${lane.color};">relevance ${score}</span></div>` : '';
          return repoCard(r, { extra: scoreBadge });
        }).join('')
      : '<div class="text-slate-500 text-sm">Nothing in this lane recently.</div>';
  };
  if (!force && STATE.cache[key]) { paint(STATE.cache[key]); return; }
  list.innerHTML = skeleton(5);
  try {
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    if (lane) {
      // Multi-query: run all lane queries, merge + dedupe
      const seen = new Set();
      const all = [];
      for (const qTpl of lane.queries) {
        const q = qTpl.replace('{since}', since);
        try {
          const data = await ghSearch(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`);
          for (const r of data.items) {
            if (seen.has(r.full_name)) continue;
            seen.add(r.full_name);
            all.push(r);
          }
        } catch { /* some queries may 422 or rate-limit */ }
      }
      STATE.cache[key] = all;
      paint(all);
    } else {
      const q = `topic:${activeTopic} pushed:>=${since}`;
      const data = await ghSearch(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`);
      STATE.cache[key] = data.items;
      paint(data.items);
    }
  } catch (e) {
    list.innerHTML = `<div class="text-red-400 text-sm">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Saved ----------
function parseGithubUrl(input) {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/[#?].*$/, '');
  s = s.replace(/\/$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0], name = parts[1];
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  return `${owner}/${name}`;
}

async function fetchRepoMeta(fullName) {
  const headers = { 'Accept': 'application/vnd.github+json' };
  if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
  const res = await fetch(`${API}/repos/${fullName}`, { headers });
  if (!res.ok) throw new Error(`${fullName}: ${res.status}`);
  return res.json();
}

function addSavedRepo(repo, opts = {}) {
  if (STATE.saved.some(r => r.full_name === repo.full_name)) return false;
  const stars = repo.stargazers_count || repo.stars || 0;
  STATE.saved.push({
    full_name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description,
    stars,
    stargazers_count: stars,
    language: repo.language,
    created_at: repo.created_at,
    topics: repo.topics || [],
    savedAt: Date.now(),
    collections: opts.collections || [],
    tags: opts.tags || []
  });
  recordSignal(repo, 2);
  return true;
}

// Render topic chips (formerly "collections" — same data, friendlier UX)
function renderCollChips() {
  const el = document.getElementById('coll-chips');
  const counts = {
    all: STATE.saved.length,
    uncategorized: STATE.saved.filter(r => !r.collections || !r.collections.length).length,
  };
  for (const c of STATE.collections) {
    counts[c.id] = STATE.saved.filter(r => (r.collections || []).includes(c.id)).length;
  }
  const chip = (id, label, delBtn = false) => `
    <span class="coll-chip ${STATE.activeCollection === id ? 'active' : ''}" data-coll="${escapeHtml(id)}">
      <span>${escapeHtml(label)}</span>
      <span class="count">${counts[id] || 0}</span>
      ${delBtn ? `<button class="del" data-del-coll="${escapeHtml(id)}" title="Delete topic">×</button>` : ''}
    </span>`;

  // If user has no topics yet, show a louder onboarding row
  if (!STATE.collections.length) {
    el.innerHTML = `
      ${chip('all', 'All')}
      ${chip('uncategorized', 'Uncategorized')}
      <button id="coll-empty-cta" class="coll-chip" style="border-style:dashed;color:#7c9cff;">
        + Create your first topic
      </button>
      <span class="text-xs text-slate-500 self-center ml-1">e.g. "Claude Code", "MCP servers", "Rust crates", "To read"…</span>
    `;
  } else {
    el.innerHTML = [
      chip('all', 'All'),
      chip('uncategorized', 'Uncategorized'),
      ...STATE.collections.map(c => chip(c.id, c.name, true)),
      `<button id="coll-add-inline" class="coll-chip" style="border-style:dashed;color:#7c9cff;" title="Add another topic">+</button>`
    ].join('');
  }

  el.querySelectorAll('.coll-chip[data-coll]').forEach(c => {
    c.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
      STATE.activeCollection = c.dataset.coll;
      LS.set('activeCollection', STATE.activeCollection);
      renderCollChips();
      renderSaved();
    });
  });
  el.querySelectorAll('[data-del-coll]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.delColl;
      const coll = STATE.collections.find(c => c.id === id);
      if (!confirm(`Delete topic "${coll.name}"? Repos stay saved, just unassigned.`)) return;
      STATE.collections = STATE.collections.filter(c => c.id !== id);
      STATE.saved.forEach(r => { r.collections = (r.collections || []).filter(x => x !== id); });
      LS.set('collections', STATE.collections);
      LS.set('saved', STATE.saved);
      if (STATE.activeCollection === id) STATE.activeCollection = 'all';
      renderCollChips();
      renderSaved();
      toast(`Deleted topic`);
    });
  });
  const cta = document.getElementById('coll-empty-cta') || document.getElementById('coll-add-inline');
  if (cta) cta.addEventListener('click', () => document.getElementById('btn-new-collection').click());
}

function renderSaved() {
  renderCollChips();
  const q = (document.getElementById('search-saved')?.value || '').toLowerCase();
  const sort = document.getElementById('sort-saved')?.value || 'recent';
  let items = [...STATE.saved];
  if (STATE.activeCollection === 'uncategorized') items = items.filter(r => !r.collections || !r.collections.length);
  else if (STATE.activeCollection !== 'all') items = items.filter(r => (r.collections || []).includes(STATE.activeCollection));
  if (q) items = items.filter(r =>
    (r.full_name + ' ' + (r.description || '') + ' ' + (r.topics || []).join(' ') + ' ' + (r.tags || []).join(' ')).toLowerCase().includes(q)
  );
  if (sort === 'recent')   items.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  else if (sort === 'stars')    items.sort((a, b) => (b.stars || 0) - (a.stars || 0));
  else if (sort === 'name')     items.sort((a, b) => a.full_name.localeCompare(b.full_name));
  else if (sort === 'velocity') items.sort((a, b) => velocityFor({ ...b, stargazers_count: b.stargazers_count || b.stars || 0 }) - velocityFor({ ...a, stargazers_count: a.stargazers_count || a.stars || 0 }));

  document.getElementById('saved-count').textContent = `${items.length} of ${STATE.saved.length}`;
  const list = document.getElementById('list-saved');
  if (!STATE.saved.length) {
    list.innerHTML = '<div class="text-slate-500 text-sm">No saves yet. Click <strong>+ Add repo(s)</strong> to paste GitHub URLs, or tap ☆ on any repo across the app.</div>';
    return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="text-slate-500 text-sm">Nothing matches this filter.</div>';
    return;
  }
  list.innerHTML = items.map(r => {
    const repo = {
      full_name: r.full_name, html_url: r.html_url, description: r.description,
      stargazers_count: r.stars, language: r.language,
      created_at: r.created_at || new Date().toISOString(), topics: r.topics || []
    };
    const tags = (r.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
    const colls = (r.collections || []).map(id => {
      const c = STATE.collections.find(x => x.id === id);
      return c ? `<span class="tag-chip" style="background:#064e3b;color:#a7f3d0;">📁 ${escapeHtml(c.name)}</span>` : '';
    }).join('');
    // Build a quick-assign dropdown so user can move repo into a topic in one click (no modal)
    const quickAssign = STATE.collections.length
      ? `<select class="text-xs bg-ink-800 border border-ink-600 rounded px-2 py-1 text-slate-300" data-quick-assign="${escapeHtml(r.full_name)}">
          <option value="">→ Assign to topic…</option>
          ${STATE.collections.map(c => {
            const active = (r.collections || []).includes(c.id) ? 'selected' : '';
            return `<option value="${escapeHtml(c.id)}" ${active}>${(r.collections || []).includes(c.id) ? '✓ ' : ''}${escapeHtml(c.name)}</option>`;
          }).join('')}
          <option value="__new__">+ Create new topic…</option>
        </select>`
      : `<button class="text-xs text-accent-400 hover:underline" data-quick-new="${escapeHtml(r.full_name)}">+ Create a topic to organize this</button>`;
    const footer = `
      <div class="mt-2 pt-2 border-t border-ink-700 flex items-center justify-between gap-2 flex-wrap">
        <div>${colls} ${tags}</div>
        <div class="flex gap-2 items-center">
          ${quickAssign}
          <button class="text-xs text-slate-400 hover:text-accent-400" data-assign="${escapeHtml(r.full_name)}" title="Multi-select & tags">⚙</button>
          <button class="text-xs text-slate-400 hover:text-red-400" data-remove="${escapeHtml(r.full_name)}">🗑</button>
        </div>
      </div>`;
    return repoCard(repo, { extra: footer });
  }).join('');
  list.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => openAssignModal(b.dataset.assign)));
  list.querySelectorAll('[data-quick-assign]').forEach(sel => {
    sel.addEventListener('change', () => {
      const fn = sel.dataset.quickAssign;
      const val = sel.value;
      if (!val) return;
      if (val === '__new__') {
        // open new-topic modal, then assign on success
        document.getElementById('btn-new-collection').click();
        const watch = setInterval(() => {
          if (!document.getElementById('modal-root').children.length) {
            clearInterval(watch);
            // pick the newest collection (last in array) and assign
            const newest = STATE.collections[STATE.collections.length - 1];
            if (newest) {
              const r = STATE.saved.find(x => x.full_name === fn);
              r.collections = [...new Set([...(r.collections || []), newest.id])];
              LS.set('saved', STATE.saved);
              renderSaved();
              toast(`Added to “${newest.name}”`, 'success');
            }
          }
        }, 200);
        sel.value = '';
        return;
      }
      const r = STATE.saved.find(x => x.full_name === fn);
      const set = new Set(r.collections || []);
      if (set.has(val)) set.delete(val); else set.add(val);
      r.collections = [...set];
      LS.set('saved', STATE.saved);
      renderSaved();
      const c = STATE.collections.find(x => x.id === val);
      toast(set.has(val) ? `Added to “${c.name}”` : `Removed from “${c.name}”`, 'success');
    });
  });
  list.querySelectorAll('[data-quick-new]').forEach(b => b.addEventListener('click', () => {
    const fn = b.dataset.quickNew;
    document.getElementById('btn-new-collection').click();
    const watch = setInterval(() => {
      if (!document.getElementById('modal-root').children.length) {
        clearInterval(watch);
        const newest = STATE.collections[STATE.collections.length - 1];
        if (newest) {
          const r = STATE.saved.find(x => x.full_name === fn);
          r.collections = [...new Set([...(r.collections || []), newest.id])];
          LS.set('saved', STATE.saved);
          renderSaved();
          toast(`Added to “${newest.name}”`, 'success');
        }
      }
    }, 200);
  }));
  list.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
    const fn = b.dataset.remove;
    if (!confirm(`Remove ${fn} from saved?`)) return;
    STATE.saved = STATE.saved.filter(r => r.full_name !== fn);
    LS.set('saved', STATE.saved);
    renderSaved();
    toast('Removed');
  }));
}

// --- Add repo(s) modal ---
document.getElementById('btn-add-saved').addEventListener('click', () => {
  const collOptions = STATE.collections.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  const box = openModal(`
    <h3>+ Add repos to your stash</h3>
    <p class="hint">Paste GitHub URLs or <code>owner/repo</code> — one per line. We'll fetch metadata for each.</p>
    <textarea id="m-urls" placeholder="https://github.com/karpathy/nanoGPT
simonw/llm
ggerganov/llama.cpp"></textarea>
    <label>Add to topic (optional)</label>
    <select id="m-coll">
      <option value="">— none —</option>
      ${collOptions}
    </select>
    <label>Tags (comma-separated, optional)</label>
    <input id="m-tags" placeholder="to-read, agent-ideas, rust" />
    <div id="m-status" class="text-xs text-slate-400 mt-3"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Cancel</button>
      <button class="btn-primary" id="m-go">Add</button>
    </div>
  `);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-go').addEventListener('click', async () => {
    const raw = box.querySelector('#m-urls').value;
    const coll = box.querySelector('#m-coll').value;
    const tags = box.querySelector('#m-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const status = box.querySelector('#m-status');
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    const parsed = lines.map(parseGithubUrl).filter(Boolean);
    const uniq = [...new Set(parsed)];
    if (!uniq.length) { toast('No valid URLs found', 'error'); return; }
    box.querySelector('#m-go').textContent = 'Fetching…';
    box.querySelector('#m-go').disabled = true;
    let ok = 0, dup = 0, fail = 0;
    for (let i = 0; i < uniq.length; i++) {
      const fn = uniq[i];
      status.textContent = `Fetching ${i + 1}/${uniq.length}: ${fn}`;
      if (STATE.saved.some(r => r.full_name === fn)) { dup++; continue; }
      try {
        const meta = await fetchRepoMeta(fn);
        addSavedRepo(meta, { collections: coll ? [coll] : [], tags });
        ok++;
      } catch (e) { fail++; console.warn(e); }
      if (i < uniq.length - 1) await new Promise(r => setTimeout(r, 200));
    }
    LS.set('saved', STATE.saved);
    closeModal();
    renderSaved();
    toast(`Added ${ok}${dup ? ` · ${dup} already saved` : ''}${fail ? ` · ${fail} failed` : ''}`, ok ? 'success' : 'error');
  });
});

// --- Import stars ---
document.getElementById('btn-import-stars').addEventListener('click', async () => {
  const signedIn = STATE.user && STATE.token;
  const defaultUser = signedIn ? STATE.user.login : (STATE.ghUser || '');
  const box = openModal(`
    <h3>Import your GitHub stars</h3>
    <p class="hint">${signedIn
      ? `Pulls every repo <strong>@${escapeHtml(STATE.user.login)}</strong> has starred on github.com into your stash.`
      : `Pulls every repo you've starred on github.com. Tip: <a href="#" id="m-signin-link" class="text-accent-400 hover:underline">sign in</a> to skip the username prompt.`}</p>
    ${signedIn ? '' : `
      <label>Your GitHub username</label>
      <input id="m-gh-user" value="${escapeHtml(defaultUser)}" placeholder="your-handle" />
    `}
    <label>Limit (most recent N stars, blank = all)</label>
    <input id="m-limit" type="number" placeholder="200" min="1" />
    <div id="m-status" class="text-xs text-slate-400 mt-3"></div>
    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Cancel</button>
      <button class="btn-primary" id="m-go">Import</button>
    </div>
  `);
  if (!signedIn) {
    box.querySelector('#m-signin-link').addEventListener('click', e => { e.preventDefault(); closeModal(); openLoginModal(); });
  }
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-go').addEventListener('click', async () => {
    const u = signedIn ? STATE.user.login : box.querySelector('#m-gh-user').value.trim().replace(/^@/, '');
    const limit = Number(box.querySelector('#m-limit').value) || Infinity;
    if (!u) { toast('Enter a username', 'error'); return; }
    STATE.ghUser = u; LS.set('ghUser', u);
    const status = box.querySelector('#m-status');
    box.querySelector('#m-go').textContent = 'Importing…';
    box.querySelector('#m-go').disabled = true;
    try {
      status.textContent = 'Importing…';
      const added = await importStarsForUser(u, limit === Infinity ? Infinity : limit);
      closeModal();
      renderSaved();
      toast(`Imported ${added} stars`, 'success');
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error');
      box.querySelector('#m-go').textContent = 'Import';
      box.querySelector('#m-go').disabled = false;
    }
  });
});

// --- New topic (was "collection") ---
document.getElementById('btn-new-collection').addEventListener('click', () => {
  const box = openModal(`
    <h3>+ New topic</h3>
    <p class="hint">Topics are your own buckets for organizing saved repos. Whatever names make sense to you — no presets.</p>
    <label>Topic name</label>
    <input id="m-name" placeholder="e.g. Claude Code, MCP servers, Rust gems, To-read…" />
    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Cancel</button>
      <button class="btn-primary" id="m-go">Create</button>
    </div>
  `);
  setTimeout(() => box.querySelector('#m-name').focus(), 50);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-name').addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('#m-go').click(); });
  box.querySelector('#m-go').addEventListener('click', () => {
    const name = box.querySelector('#m-name').value.trim();
    if (!name) return;
    if (STATE.collections.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast('Topic with that name already exists', 'error');
      return;
    }
    const id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    STATE.collections.push({ id, name });
    LS.set('collections', STATE.collections);
    closeModal();
    renderCollChips();
    renderSaved();
    toast(`Topic "${name}" created — assign repos to it from any saved card`, 'success');
  });
});

// --- Assign topics/tags modal (multi-select + tags) ---
function openAssignModal(fullName) {
  const r = STATE.saved.find(x => x.full_name === fullName);
  if (!r) return;
  const collOptions = STATE.collections.map(c => {
    const checked = (r.collections || []).includes(c.id) ? 'checked' : '';
    return `<label class="flex items-center gap-2 py-1"><input type="checkbox" value="${escapeHtml(c.id)}" ${checked} /> <span>${escapeHtml(c.name)}</span></label>`;
  }).join('');
  const box = openModal(`
    <h3>Organize</h3>
    <p class="hint">${escapeHtml(r.full_name)}</p>
    <label>Topics <span class="text-xs text-slate-500">(repo can be in multiple)</span></label>
    <div id="m-colls">${collOptions || '<div class="text-sm text-slate-500">No topics yet. Click <strong>+ New topic</strong> first.</div>'}</div>
    <label>Tags <span class="text-xs text-slate-500">(comma-separated, freeform — searchable)</span></label>
    <input id="m-tags" value="${escapeHtml((r.tags || []).join(', '))}" placeholder="to-read, rust, weekend" />
    <div class="modal-actions">
      <button class="btn-secondary" id="m-cancel">Cancel</button>
      <button class="btn-primary" id="m-go">Save</button>
    </div>
  `);
  box.querySelector('#m-cancel').addEventListener('click', closeModal);
  box.querySelector('#m-go').addEventListener('click', () => {
    const checked = [...box.querySelectorAll('#m-colls input:checked')].map(i => i.value);
    const tags = box.querySelector('#m-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    r.collections = checked;
    r.tags = tags;
    LS.set('saved', STATE.saved);
    closeModal();
    renderSaved();
    toast('Updated');
  });
}

// Search + sort listeners
document.getElementById('search-saved').addEventListener('input', renderSaved);
document.getElementById('sort-saved').addEventListener('change', renderSaved);

function toggleSave(fullName) {
  // Find repo data from current caches
  const repo = findRepoEverywhere(fullName);
  if (!repo) return;
  if (isSaved(fullName)) {
    STATE.saved = STATE.saved.filter(r => r.full_name !== fullName);
    recordSignal(repo, -0.5);
    toast('Removed from saved');
  } else {
    const stars = repo.stargazers_count || repo.stars || 0;
    STATE.saved.push({
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      stars,
      stargazers_count: stars,
      language: repo.language,
      created_at: repo.created_at,
      topics: repo.topics,
      savedAt: Date.now()
    });
    recordSignal(repo, 2);
    toast('Saved ★ — your taste model learned this', 'success');
  }
  LS.set('saved', STATE.saved);
  rerenderCurrent();
}

function rerenderCurrent() {
  if (currentTab === 'trending')      renderTrending();
  else if (currentTab === 'following') renderFollowingList(STATE.cache.following || []);
  else if (currentTab === 'curated')   loadCurated();
  else if (currentTab === 'saved')     renderSaved();
  else if (currentTab === 'insider')   renderInsider(STATE.cache.insider || []);
  else if (currentTab === 'releases')  renderReleases(STATE.cache.releases || []);
}

function findRepoEverywhere(fullName) {
  const pools = [
    ...(trendingData.week || []),
    ...(trendingData.month || []),
    ...(STATE.cache.following || []),
    ...((STATE.cache.insider || []).map(it => it.repo)),
    ...Object.entries(STATE.cache).filter(([k]) => k.startsWith('curated:')).flatMap(([, v]) => v)
  ];
  return pools.find(r => r.full_name === fullName)
    || STATE.saved.find(r => r.full_name === fullName) && {
      full_name: fullName,
      html_url: STATE.saved.find(r => r.full_name === fullName).html_url,
      description: STATE.saved.find(r => r.full_name === fullName).description,
      stargazers_count: STATE.saved.find(r => r.full_name === fullName).stars,
      language: STATE.saved.find(r => r.full_name === fullName).language,
      topics: STATE.saved.find(r => r.full_name === fullName).topics || []
    };
}

// Delegate save / hide clicks
document.body.addEventListener('click', e => {
  const saveBtn = e.target.closest('[data-action="save"]');
  if (saveBtn) {
    const card = saveBtn.closest('[data-fullname]');
    if (card) toggleSave(card.dataset.fullname);
    return;
  }
  const hideBtn = e.target.closest('[data-action="hide"]');
  if (hideBtn) {
    const card = hideBtn.closest('[data-fullname]');
    if (!card) return;
    const fullName = card.dataset.fullname;
    const repo = findRepoEverywhere(fullName);
    hideRepo(fullName, repo);
    card.style.opacity = '0';
    card.style.transform = 'translateX(-20px)';
    setTimeout(() => rerenderCurrent(), 200);
  }
});

// ---------- Insider Stars ----------
async function ghStarred(user) {
  const headers = {
    'Accept': 'application/vnd.github.star+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
  const url = `${API}/users/${encodeURIComponent(user)}/starred?sort=created&direction=desc&per_page=15`;
  const res = await fetch(url, { headers });
  const rem = res.headers.get('x-ratelimit-remaining');
  const lim = res.headers.get('x-ratelimit-limit');
  if (rem && lim) document.getElementById('rate-limit').textContent = `API: ${rem}/${lim}`;
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${user}`);
  return res.json();
}

async function loadInsider(force = false) {
  const list = document.getElementById('list-insider');
  const meta = document.getElementById('insider-meta');
  if (!STATE.follows.length) {
    list.innerHTML = '<div class="text-slate-500 text-sm">Follow some people first (Following tab).</div>';
    return;
  }
  // 6h cache via localStorage to survive reloads (insider data is heavy)
  const cached = LS.get('insiderCache', null);
  if (!force && cached && (Date.now() - cached.at) < 6 * 3600000) {
    STATE.cache.insider = cached.items;
    renderInsider(cached.items);
    meta.textContent = `cached ${timeAgo(new Date(cached.at).toISOString())}`;
    return;
  }
  if (!force && STATE.cache.insider) { renderInsider(STATE.cache.insider); return; }

  list.innerHTML = skeleton(6);
  meta.textContent = `fetching ${STATE.follows.length} accounts…`;
  try {
    const since = Date.now() - 21 * 86400000;
    const repoMap = new Map();
    let done = 0;
    for (const u of STATE.follows) {
      try {
        const starred = await ghStarred(u);
        for (const s of starred) {
          if (!s.starred_at || !s.repo) continue;
          if (new Date(s.starred_at).getTime() < since) continue;
          const r = s.repo;
          if (STATE.follows.includes(r.owner.login)) continue; // skip self-stars from network
          const key = r.full_name;
          if (!repoMap.has(key)) repoMap.set(key, { repo: r, starredBy: [] });
          repoMap.get(key).starredBy.push({ user: u, at: s.starred_at });
        }
      } catch (e) {
        // swallow per-user errors (404s for renamed accounts, etc)
        console.warn('insider fetch failed for', u, e.message);
      }
      done++;
      meta.textContent = `fetched ${done}/${STATE.follows.length}`;
      await new Promise(r => setTimeout(r, 250));
    }
    const items = [...repoMap.values()].sort((a, b) => {
      if (b.starredBy.length !== a.starredBy.length) return b.starredBy.length - a.starredBy.length;
      const aLatest = Math.max(...a.starredBy.map(s => new Date(s.at).getTime()));
      const bLatest = Math.max(...b.starredBy.map(s => new Date(s.at).getTime()));
      return bLatest - aLatest;
    });
    STATE.cache.insider = items;
    LS.set('insiderCache', { at: Date.now(), items });
    meta.textContent = `${items.length} repos · just refreshed`;
    renderInsider(items);
  } catch (e) {
    list.innerHTML = `<div class="text-red-400 text-sm">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderInsider(items) {
  const list = document.getElementById('list-insider');
  const visible = items.filter(it => !isHidden(it.repo.full_name));
  if (!visible.length) {
    list.innerHTML = '<div class="text-slate-500 text-sm">No fresh insider stars in the last 21 days. Try refreshing or adding more follows.</div>';
    return;
  }
  list.innerHTML = visible.slice(0, 40).map(it => {
    const cross = it.starredBy.length;
    const mostRecent = it.starredBy.reduce((a, b) => new Date(a.at) > new Date(b.at) ? a : b);
    const avatars = it.starredBy.slice(0, 6).map(s =>
      `<img src="https://github.com/${encodeURIComponent(s.user)}.png?size=48" class="w-6 h-6 rounded-full -ml-1 first:ml-0 border-2 border-ink-900" title="${escapeHtml(s.user)} · ${timeAgo(s.at)}" loading="lazy" />`
    ).join('');
    const moreCount = cross > 6 ? `<span class="text-xs text-slate-400 ml-2">+${cross - 6}</span>` : '';
    const crossBadge = cross >= 2
      ? `<span class="badge" style="background:linear-gradient(90deg,#fbbf24,#f59e0b);color:#000;">💎 ${cross}× insider</span>`
      : `<span class="badge" style="background:#312e81;color:#c7d2fe;">starred by ${escapeHtml(mostRecent.user)}</span>`;
    const extra = `
      <div class="mt-3 pt-3 border-t border-ink-700 flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-1">${avatars}${moreCount}</div>
        <span class="text-xs text-slate-500">most recent: ${escapeHtml(mostRecent.user)} · ${timeAgo(mostRecent.at)}</span>
      </div>`;
    // Inject crossBadge into a custom card
    const ai = isAiDev(it.repo);
    const stars = fmtNum(it.repo.stargazers_count || 0);
    const lang = it.repo.language || '—';
    const desc = escapeHtml(it.repo.description || '_No description_');
    const topics = (it.repo.topics || []).slice(0, 5);
    const saved = isSaved(it.repo.full_name);
    const vel = velocityFor(it.repo);
    const velBadge = vel >= 50 ? `<span class="badge" style="background:linear-gradient(90deg,#f97316,#ef4444);color:#fff;">🚀 +${fmtNum(vel)}/day</span>`
                    : vel >= 10 ? `<span class="badge badge-lang">+${vel}/day</span>` : '';
    return `
      <div class="repo-card" data-fullname="${escapeHtml(it.repo.full_name)}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <a href="${it.repo.html_url}" target="_blank" class="repo-link font-semibold truncate">${escapeHtml(it.repo.full_name)}</a>
              ${crossBadge}
              ${ai ? '<span class="badge badge-ai">AI/DEV</span>' : ''}
              ${velBadge}
            </div>
            <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span>⭐ ${stars}</span>
              <span class="badge badge-lang">${escapeHtml(lang)}</span>
              <span>${escapeHtml(it.repo.owner.login)}</span>
            </div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button class="btn-icon ${saved ? 'saved' : ''}" data-action="save">${saved ? '★' : '☆'}</button>
            <button class="btn-icon" data-action="hide" title="Not interested">✕</button>
            <a href="${it.repo.html_url}" target="_blank" class="btn-icon">↗</a>
          </div>
        </div>
        <p class="text-sm text-slate-300 mb-2 leading-relaxed">${desc}</p>
        ${topics.length ? `<div class="flex flex-wrap gap-1">${topics.map(t => `<span class="text-xs text-slate-500">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${extra}
      </div>`;
  }).join('');
}

// ---------- Releases ----------
async function loadReleases(force = false) {
  const list = document.getElementById('list-releases');
  const meta = document.getElementById('releases-meta');

  // Pool: saved repos + recent following + top insider items
  const pool = new Set();
  STATE.saved.forEach(r => pool.add(r.full_name));
  (STATE.cache.following || []).slice(0, 25).forEach(r => pool.add(r.full_name));
  (STATE.cache.insider || []).slice(0, 15).forEach(it => pool.add(it.repo.full_name));

  if (!pool.size) {
    list.innerHTML = '<div class="text-slate-500 text-sm">Save a few repos or open Following / Insider first to seed the radar.</div>';
    return;
  }

  const cached = LS.get('releasesCache', null);
  if (!force && cached && (Date.now() - cached.at) < 3 * 3600000) {
    STATE.cache.releases = cached.items;
    renderReleases(cached.items);
    meta.textContent = `cached ${timeAgo(new Date(cached.at).toISOString())}`;
    return;
  }
  if (!force && STATE.cache.releases) { renderReleases(STATE.cache.releases); return; }

  list.innerHTML = skeleton(5);
  const repos = [...pool];
  meta.textContent = `checking ${repos.length} repos…`;
  const releases = [];
  const since = Date.now() - 30 * 86400000;
  for (let i = 0; i < repos.length; i++) {
    const fn = repos[i];
    try {
      const headers = { 'Accept': 'application/vnd.github+json' };
      if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
      const res = await fetch(`${API}/repos/${fn}/releases?per_page=1`, { headers });
      if (res.ok) {
        const arr = await res.json();
        if (arr.length) {
          const r = arr[0];
          if (r.published_at && new Date(r.published_at).getTime() >= since) {
            releases.push({ repo_full: fn, ...r });
          }
        }
      }
    } catch {}
    if ((i + 1) % 5 === 0) {
      meta.textContent = `checked ${i + 1}/${repos.length}`;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  releases.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  STATE.cache.releases = releases;
  LS.set('releasesCache', { at: Date.now(), items: releases });
  meta.textContent = `${releases.length} fresh releases`;
  renderReleases(releases);
}

function renderReleases(items) {
  const list = document.getElementById('list-releases');
  const visible = items.filter(r => !isHidden(r.repo_full));
  if (!visible.length) {
    list.innerHTML = '<div class="text-slate-500 text-sm">No releases in the last 30 days from your tracked repos.</div>';
    return;
  }
  list.innerHTML = visible.slice(0, 40).map(r => {
    const body = (r.body || '').slice(0, 240);
    const tag = escapeHtml(r.tag_name || r.name || 'release');
    const isPre = r.prerelease ? '<span class="badge" style="background:#7c2d12;color:#fed7aa;">pre-release</span>' : '';
    return `
      <div class="repo-card" data-fullname="${escapeHtml(r.repo_full)}">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <a href="https://github.com/${escapeHtml(r.repo_full)}" target="_blank" class="repo-link font-semibold truncate">${escapeHtml(r.repo_full)}</a>
              <span class="badge" style="background:#065f46;color:#a7f3d0;">🚀 ${tag}</span>
              ${isPre}
            </div>
            <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span>${timeAgo(r.published_at)}</span>
              <span>${fmtDate(r.published_at)}</span>
              <a href="${r.html_url}" target="_blank" class="text-accent-400 hover:underline">view release →</a>
            </div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button class="btn-icon" data-action="hide" title="Not interested">✕</button>
            <a href="${r.html_url}" target="_blank" class="btn-icon">↗</a>
          </div>
        </div>
        ${r.name && r.name !== r.tag_name ? `<div class="text-sm font-medium text-slate-200 mb-1">${escapeHtml(r.name)}</div>` : ''}
        ${body ? `<pre class="text-xs text-slate-400 whitespace-pre-wrap font-sans leading-relaxed">${escapeHtml(body)}${r.body && r.body.length > 240 ? '…' : ''}</pre>` : ''}
      </div>`;
  }).join('');
}

// ---------- Briefing ----------
function renderBriefingShellIfEmpty() {
  document.getElementById('briefing-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

document.getElementById('btn-briefing-refresh').addEventListener('click', buildBriefing);

async function buildBriefing() {
  const el = document.getElementById('briefing-content');
  el.innerHTML = `<div class="bg-ink-900 border border-ink-700 rounded-xl p-6 text-center text-slate-400">${skeleton(1)}<p class="text-xs mt-3">Pulling trending, insider stars, releases…</p></div>`;

  // Ensure all data sources are loaded
  await loadTrending(false);
  if (!STATE.cache.insider) await loadInsider(false);
  if (!STATE.cache.releases) await loadReleases(false);

  const week = (trendingData.week || []).filter(r => !isHidden(r.full_name));
  const insider = (STATE.cache.insider || []).filter(it => !isHidden(it.repo.full_name));
  const releases = (STATE.cache.releases || []).filter(r => !isHidden(r.repo_full));

  // Score every candidate from week + insider
  const scored = new Map();
  const consider = (repo, src, extras = {}) => {
    if (!repo || isHidden(repo.full_name)) return;
    const prev = scored.get(repo.full_name) || { repo, score: 0, reasons: [], sources: new Set() };
    const v = velocityFor(repo);
    let bump = 0;
    if (src === 'insider') {
      bump += extras.cross * 30;
      if (extras.cross >= 2) prev.reasons.push(`💎 starred by ${extras.cross} insiders`);
      else prev.reasons.push(`starred by ${extras.starrer}`);
    }
    if (src === 'trending') {
      bump += Math.min(40, v / 5);
      if (v >= 100) prev.reasons.push(`🚀 ${fmtNum(v)} stars/day`);
      else if (v >= 30) prev.reasons.push(`fast-rising (+${v}/day)`);
    }
    const ts = tasteScore(repo);
    if (ts >= 5) { bump += 15; prev.reasons.push('matches your taste'); }
    if (isAiDev(repo)) bump += 5;
    prev.score += bump;
    prev.sources.add(src);
    prev.repo = repo;
    scored.set(repo.full_name, prev);
  };
  for (const it of insider) consider(it.repo, 'insider', { cross: it.starredBy.length, starrer: it.starredBy[0].user });
  for (const r of week) consider(r, 'trending');

  const top = [...scored.values()]
    .filter(x => !isSaved(x.repo.full_name))
    .sort((a, b) => b.score - a.score);

  const mustSee = top[0];
  const worthClick = top.slice(1, 3);
  const watchList = releases.slice(0, 3);

  const renderTopPick = (item) => {
    if (!item) return '';
    const r = item.repo;
    const ai = isAiDev(r);
    const reasons = [...new Set(item.reasons)].slice(0, 3).map(x => `<span class="badge badge-lang">${x}</span>`).join(' ');
    return `
      <div class="repo-card" data-fullname="${escapeHtml(r.full_name)}" style="background:linear-gradient(135deg,#1a1d2e,#0f1117);border:1px solid #4263eb;">
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="flex-1 min-w-0">
            <div class="text-xs text-accent-400 font-semibold uppercase tracking-wider mb-1">★ Must see today</div>
            <a href="${r.html_url}" target="_blank" class="repo-link text-xl font-bold">${escapeHtml(r.full_name)}</a>
            ${ai ? '<span class="badge badge-ai ml-2">AI/DEV</span>' : ''}
            <div class="text-xs text-slate-400 mt-1">⭐ ${fmtNum(r.stargazers_count)} · ${escapeHtml(r.language || '—')} · created ${fmtDate(r.created_at)}</div>
          </div>
          <div class="flex gap-1 shrink-0">
            <button class="btn-icon ${isSaved(r.full_name) ? 'saved' : ''}" data-action="save">${isSaved(r.full_name) ? '★' : '☆'}</button>
            <button class="btn-icon" data-action="hide" title="Not interested">✕</button>
            <a href="${r.html_url}" target="_blank" class="btn-icon">↗</a>
          </div>
        </div>
        <p class="text-sm text-slate-200 my-3 leading-relaxed">${escapeHtml(r.description || '_No description_')}</p>
        <div class="flex flex-wrap gap-2 mt-2">${reasons}</div>
      </div>`;
  };

  const renderWorth = (item) => {
    if (!item) return '';
    const r = item.repo;
    const reasons = [...new Set(item.reasons)].slice(0, 2).map(x => `<span class="badge badge-lang">${x}</span>`).join(' ');
    return repoCard(r, { extra: `<div class="mt-2 pt-2 border-t border-ink-700 flex flex-wrap gap-2">${reasons}</div>` });
  };

  const renderWatch = (rel) => `
    <div class="repo-card" data-fullname="${escapeHtml(rel.repo_full)}">
      <div class="flex items-center gap-2 flex-wrap mb-1">
        <a href="https://github.com/${escapeHtml(rel.repo_full)}" target="_blank" class="repo-link font-semibold">${escapeHtml(rel.repo_full)}</a>
        <span class="badge" style="background:#065f46;color:#a7f3d0;">🚀 ${escapeHtml(rel.tag_name || 'release')}</span>
        <span class="text-xs text-slate-400">${timeAgo(rel.published_at)}</span>
      </div>
      ${rel.name && rel.name !== rel.tag_name ? `<div class="text-sm text-slate-300">${escapeHtml(rel.name)}</div>` : ''}
    </div>`;

  // Build per-lane highlights
  const laneHighlights = INTEREST_LANES.map(lane => {
    const allRepos = [...(trendingData.week || []), ...(trendingData.month || []), ...insider.map(it => it.repo)];
    const scored = allRepos
      .filter(r => !isHidden(r.full_name) && !isSaved(r.full_name))
      .map(r => ({ repo: r, score: laneScore(r, lane) }))
      .filter(x => x.score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { lane, repos: scored };
  }).filter(lh => lh.repos.length > 0);

  el.innerHTML = `
    <div class="grid gap-6">
      <div>
        ${mustSee ? renderTopPick(mustSee) : '<div class="bg-ink-900 border border-ink-700 rounded-xl p-6 text-slate-400 text-sm">No standout pick — try refreshing or adding more follows.</div>'}
      </div>

      ${worthClick.length ? `
      <div>
        <h3 class="text-sm uppercase tracking-wider text-slate-400 mb-3">👀 Worth a click</h3>
        <div class="grid md:grid-cols-2 gap-3">
          ${worthClick.map(renderWorth).join('')}
        </div>
      </div>` : ''}

      ${laneHighlights.map(lh => `
      <div>
        <h3 class="text-sm uppercase tracking-wider mb-3" style="color:${lh.lane.color}">${lh.lane.name}</h3>
        <div class="space-y-2">
          ${lh.repos.map(x => {
            const scoreBadge = `<div class="mt-2 pt-2 border-t border-ink-700"><span class="badge" style="background:${lh.lane.color}22;color:${lh.lane.color};">relevance ${x.score}</span></div>`;
            return repoCard(x.repo, { extra: scoreBadge });
          }).join('')}
        </div>
      </div>`).join('')}

      ${watchList.length ? `
      <div>
        <h3 class="text-sm uppercase tracking-wider text-slate-400 mb-3">🔔 From your watch list</h3>
        <div class="space-y-2">
          ${watchList.map(renderWatch).join('')}
        </div>
      </div>` : ''}

      <div class="text-center text-xs text-slate-500 pt-4 border-t border-ink-700">
        Done. Close the tab. Touch grass. ✌
      </div>
    </div>
  `;
}

// ---------- Daily Report ----------
function buildMarkdown() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const week  = trendingData.week  || [];
  const month = trendingData.month || [];
  const aiCount = week.filter(isAiDev).length;
  const topAi = week.find(isAiDev);

  const fmtRepo = (r, i) => {
    const ai = isAiDev(r) ? ' **[AI/DEV]**' : '';
    const stars = fmtNum(r.stargazers_count || r.stars || 0);
    const lang  = r.language || 'n/a';
    const created = fmtDate(r.created_at);
    const topics = (r.topics || []).slice(0, 5).join(', ');
    const desc = (r.description || '_No description_').trim();
    return `${i + 1}. [${r.full_name}](${r.html_url})${ai} - ⭐ ${stars} - ${lang} - created ${created}\n${topics ? `   Topics: ${topics}\n` : ''}   ${desc}\n`;
  };

  let md = `# GitHub Trending - ${dateStr} (${dayName})\n\n`;
  md += `## Top 10 Trending This Week\n\n`;
  md += week.map(fmtRepo).join('\n');
  md += `\n## Top 5 Trending This Month\n\n`;
  md += month.map(fmtRepo).join('\n');
  md += `\n## Content Radar\n\n`;
  md += `AI/DEV-relevant repos this week: **${aiCount} / ${week.length}**\n\n`;
  if (topAi) {
    md += `**Top AI pick:** [${topAi.full_name}](${topAi.html_url}) - ⭐ ${fmtNum(topAi.stargazers_count || 0)}\n\n`;
    md += `${(topAi.description || '_No description_').trim()}\n`;
  } else {
    md += `_No AI/DEV-tagged repos in this week's top 10._\n`;
  }

  // Interest Lane highlights
  const allRepos = [...week, ...month];
  const laneResults = INTEREST_LANES.map(lane => {
    const scored = allRepos
      .filter(r => !isHidden(r.full_name))
      .map(r => ({ repo: r, score: laneScore(r, lane) }))
      .filter(x => x.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { lane, repos: scored };
  }).filter(lr => lr.repos.length > 0);

  if (laneResults.length) {
    md += `\n## Interest Lane Highlights\n\n`;
    for (const lr of laneResults) {
      md += `### ${lr.lane.name}\n\n`;
      md += lr.repos.map((x, i) => {
        const r = x.repo;
        const stars = fmtNum(r.stargazers_count || 0);
        const desc = (r.description || '_No description_').trim();
        return `${i + 1}. [${r.full_name}](${r.html_url}) - ⭐ ${stars} · relevance ${x.score}\n   ${desc}\n`;
      }).join('\n');
      md += '\n';
    }
  }

  return md;
}

let lastMarkdown = '';
document.getElementById('btn-generate').addEventListener('click', async () => {
  await loadTrending(true);
  lastMarkdown = buildMarkdown();
  document.getElementById('daily-preview').textContent = lastMarkdown;
  document.getElementById('btn-download').classList.remove('hidden');
  document.getElementById('btn-copy').classList.remove('hidden');
  toast('Report generated', 'success');
});
document.getElementById('btn-download').addEventListener('click', () => {
  const blob = new Blob([lastMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${new Date().toISOString().slice(0,10)}-trending.md`;
  a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btn-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(lastMarkdown);
  toast('Copied to clipboard', 'success');
});
document.querySelectorAll('.copy-cmd').forEach(b => {
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(b.dataset.cmd);
    toast(`Copied: ${b.dataset.cmd.slice(0, 50)}…`, 'success');
  });
});

// ---------- Settings ----------
document.getElementById('pat-input').value = STATE.token;
document.getElementById('refresh-interval').value = String(STATE.refreshIntervalMs);
document.getElementById('btn-save-pat').addEventListener('click', async () => {
  const t = document.getElementById('pat-input').value.trim();
  if (!t) {
    // Clearing token = sign out
    STATE.token = ''; STATE.user = null; STATE.ghUser = '';
    LS.set('pat', ''); LS.set('ghUser', ''); localStorage.removeItem('user');
    STATE.cache = {};
    localStorage.removeItem('insiderCache');
    localStorage.removeItem('releasesCache');
    renderLoginUI();
    toast('Token cleared');
    return;
  }
  try {
    await applyToken(t);
    STATE.cache = {};
    localStorage.removeItem('insiderCache');
    localStorage.removeItem('releasesCache');
    loadTrending(true);
  } catch (e) {
    toast('Invalid token: ' + e.message, 'error');
  }
});
document.getElementById('refresh-interval').addEventListener('change', e => {
  STATE.refreshIntervalMs = Number(e.target.value);
  LS.set('refreshIntervalMs', STATE.refreshIntervalMs);
  setupAutoRefresh();
  toast('Auto-refresh updated', 'success');
});
document.getElementById('btn-export').addEventListener('click', () => {
  const data = JSON.stringify({
    follows: STATE.follows, followMeta: STATE.followMeta,
    saved: STATE.saved, topics: STATE.topics, collections: STATE.collections,
    lastSeen: STATE.lastSeen, ghUser: STATE.ghUser,
    taste: { topics: TASTE.topics, langs: TASTE.langs, hidden: TASTE.hidden }
  }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `oss-radar-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
});
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.follows))     { STATE.follows = data.follows; LS.set('follows', STATE.follows); }
      if (data.followMeta)                 { STATE.followMeta = data.followMeta; LS.set('followMeta', STATE.followMeta); }
      if (Array.isArray(data.saved))       { STATE.saved = data.saved; LS.set('saved', STATE.saved); }
      if (Array.isArray(data.topics))      { STATE.topics = data.topics; LS.set('topics', STATE.topics); }
      if (Array.isArray(data.collections)) { STATE.collections = data.collections; LS.set('collections', STATE.collections); }
      if (data.lastSeen)                   { STATE.lastSeen = data.lastSeen; LS.set('lastSeen', STATE.lastSeen); }
      if (data.ghUser)                     { STATE.ghUser = data.ghUser; LS.set('ghUser', STATE.ghUser); }
      if (data.taste) {
        if (data.taste.topics) { TASTE.topics = data.taste.topics; LS.set('taste.topics', TASTE.topics); }
        if (data.taste.langs)  { TASTE.langs  = data.taste.langs;  LS.set('taste.langs', TASTE.langs); }
        if (data.taste.hidden) { TASTE.hidden = data.taste.hidden; LS.set('taste.hidden', TASTE.hidden); }
      }
      toast('Imported', 'success');
      setTab(currentTab);
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  };
  reader.readAsText(f);
});

// --- Hidden list management ---
function renderHiddenList() {
  const el = document.getElementById('hidden-list');
  const countEl = document.getElementById('hidden-count');
  if (!el) return;
  countEl.textContent = TASTE.hidden.length ? `(${TASTE.hidden.length})` : '';
  if (!TASTE.hidden.length) {
    el.innerHTML = '<div class="text-xs text-slate-500">Nothing hidden.</div>';
    return;
  }
  el.innerHTML = TASTE.hidden.map(fn =>
    `<button class="follow-chip" data-unhide="${escapeHtml(fn)}" title="Click to unhide">
      <span>${escapeHtml(fn)}</span> <span class="del">×</span>
    </button>`
  ).join('');
  el.querySelectorAll('[data-unhide]').forEach(b => {
    b.addEventListener('click', () => {
      const fn = b.dataset.unhide;
      TASTE.hidden = TASTE.hidden.filter(x => x !== fn);
      LS.set('taste.hidden', TASTE.hidden);
      renderHiddenList();
      toast(`Unhidden: ${fn}`, 'success');
    });
  });
}
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Wipe follows, saves, and settings?')) return;
  localStorage.clear();
  location.reload();
});

// ---------- Notifications ----------
document.getElementById('btn-notify').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('Notifications not supported', 'error'); return; }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? 'Alerts enabled' : 'Alerts denied', perm === 'granted' ? 'success' : 'error');
  if (perm === 'granted') document.getElementById('btn-notify').classList.add('hidden');
});
function fireNotifications(repos) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const r of repos.slice(0, 3)) {
    const n = new Notification(`${r.owner.login} dropped: ${r.name}`, {
      body: (r.description || '').slice(0, 140),
      icon: `https://github.com/${r.owner.login}.png?size=80`,
      tag: r.full_name
    });
    n.onclick = () => { window.open(r.html_url, '_blank'); n.close(); };
  }
}
if ('Notification' in window && Notification.permission === 'granted') {
  document.getElementById('btn-notify').classList.add('hidden');
}

// ---------- Refresh ----------
let refreshTimer;
function setupAutoRefresh() {
  clearInterval(refreshTimer);
  if (STATE.refreshIntervalMs > 0) {
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        // Only invalidate the active tab's cache, not all caches
        if (currentTab === 'trending')  { delete STATE.cache.trending; loadTrending(true); }
        if (currentTab === 'following') { STATE.cache.following = null; loadFollowing(true); }
        if (currentTab === 'curated')   { delete STATE.cache[`curated:${activeTopic}`]; loadCurated(true); }
      }
    }, STATE.refreshIntervalMs);
  }
}
document.getElementById('btn-refresh').addEventListener('click', () => {
  STATE.cache = {};
  if (currentTab === 'trending')  loadTrending(true);
  if (currentTab === 'following') loadFollowing(true);
  if (currentTab === 'curated')   loadCurated(true);
  if (currentTab === 'insider')   loadInsider(true);
  if (currentTab === 'releases')  loadReleases(true);
  if (currentTab === 'briefing')  buildBriefing();
  toast('Refreshed', 'success');
});

// ---------- Login wiring ----------
document.getElementById('btn-login').addEventListener('click', openLoginModal);
document.getElementById('btn-logout').addEventListener('click', logout);

// On boot: if a token exists but no cached user (e.g. imported from old version), validate + fetch
async function hydrateUser() {
  if (STATE.token && !STATE.user) {
    try {
      const u = await fetchMyProfile(STATE.token);
      STATE.user = { login: u.login, name: u.name, avatar_url: u.avatar_url, html_url: u.html_url, following: u.following, public_repos: u.public_repos };
      LS.set('user', STATE.user);
      if (!STATE.ghUser) { STATE.ghUser = u.login; LS.set('ghUser', STATE.ghUser); }
    } catch { /* token invalid or offline — leave unlogged */ }
  }
  renderLoginUI();
}

// ---------- Boot ----------
// Migration: backfill stargazers_count on saved repos that only have .stars
(() => {
  let patched = false;
  for (const r of STATE.saved) {
    if (!r.stargazers_count && r.stars) { r.stargazers_count = r.stars; patched = true; }
    if (r.stargazers_count && !r.stars) { r.stars = r.stargazers_count; patched = true; }
  }
  if (patched) LS.set('saved', STATE.saved);
})();

hydrateUser();
renderLoginUI();
setupAutoRefresh();
setTab('briefing');

// Background poll for following (every 30 min) — only when signed in (otherwise we burn the 60/hr unauthenticated limit)
setInterval(() => {
  if (STATE.token && STATE.follows.length && document.visibilityState === 'visible') loadFollowing(true);
}, 30 * 60 * 1000);
