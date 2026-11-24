#!/usr/bin/env node
/**
 * Generates live high-DPI screenshots of Guanaco from the production web bundle (`dist/`)
 * using headless Google Chrome + Chrome DevTools Protocol (CDP) into `docs/assets/screenshots/`.
 * Note: `docs/assets/social-preview.png` is custom illustrated artwork and is intentionally
 * preserved across `npm run screenshots` runs.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'docs', 'assets', 'screenshots');

const CHROME_BIN =
  process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!fs.existsSync(CHROME_BIN)) {
  console.error(`Chrome binary not found at "${CHROME_BIN}". Set CHROME_BIN to override.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.log('Building production web bundle (npx expo export -p web)...');
  execFileSync('npx', ['expo', 'export', '-p', 'web'], { cwd: ROOT_DIR, stdio: 'inherit' });
}

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Build realistic, relatable demo dataset relative to "now" so Today / Tomorrow / Overdue render naturally
function buildDemoDataset() {
  const now = new Date();
  const todayEvening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    18,
    0,
    0
  ).toISOString();
  const tomorrowMorning = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    9,
    30,
    0
  ).toISOString();
  const yesterdayDue = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    14,
    0,
    0
  ).toISOString();
  const nextWeekDue = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 5,
    11,
    0,
    0
  ).toISOString();

  const currentUser = { id: 1, username: 'alex', name: 'Alex Rivera' };
  const teammate = { id: 2, username: 'maya', name: 'Maya Chen' };

  const labels = [
    { id: 1, title: 'homelab', hex_color: '#0A84FF' },
    { id: 2, title: 'security', hex_color: '#FF453A' },
    { id: 3, title: 'release', hex_color: '#BF5AF2' },
    { id: 4, title: 'errands', hex_color: '#30D158' },
    { id: 5, title: 'docs', hex_color: '#FF9F0A' },
  ];

  const projects = [
    {
      id: 1,
      title: 'Infrastructure & Ops',
      hex_color: '#0A84FF',
      is_favorite: true,
      views: [{ id: 101, title: 'List', project_id: 1, view_kind: 'list' }],
    },
    {
      id: 2,
      title: 'Backups & ZFS',
      parent_project_id: 1,
      hex_color: '#64D2FF',
      views: [{ id: 102, title: 'List', project_id: 2, view_kind: 'list' }],
    },
    {
      id: 3,
      title: 'Mobile Release',
      hex_color: '#BF5AF2',
      is_favorite: true,
      views: [{ id: 103, title: 'List', project_id: 3, view_kind: 'list' }],
    },
    {
      id: 4,
      title: 'Personal & Home',
      hex_color: '#30D158',
      views: [{ id: 104, title: 'List', project_id: 4, view_kind: 'list' }],
    },
    {
      id: 5,
      title: 'Weekly Groceries',
      parent_project_id: 4,
      hex_color: '#FF9F0A',
      views: [{ id: 105, title: 'List', project_id: 5, view_kind: 'list' }],
    },
    {
      id: 6,
      title: '2025 Migration Archive',
      hex_color: '#8E8E93',
      is_archived: true,
    },
    {
      id: -2,
      title: 'High Priority Queue',
      hex_color: '#FF453A',
      views: [{ id: 201, title: 'List', project_id: -2, view_kind: 'list' }],
    },
    {
      id: -3,
      title: 'Due This Week',
      hex_color: '#0A84FF',
      views: [{ id: 202, title: 'List', project_id: -3, view_kind: 'list' }],
    },
  ];

  const sub1 = {
    id: 111,
    title: 'Export root CA cert to Android trust store',
    done: true,
    priority: 2,
    project_id: 1,
    position: 9000,
    related_tasks: {
      parenttask: [{ id: 101, title: 'Renew internal Caddy TLS & verify mobile sync', done: false, priority: 4, project_id: 1 }],
    },
  };
  const sub2 = {
    id: 112,
    title: 'Verify rotating refresh cookie renewal over Wi-Fi',
    done: true,
    priority: 2,
    project_id: 1,
    position: 9100,
    related_tasks: {
      parenttask: [{ id: 101, title: 'Renew internal Caddy TLS & verify mobile sync', done: false, priority: 4, project_id: 1 }],
    },
  };
  const sub3 = {
    id: 113,
    title: 'Audit active Vikunja sessions User-Agent list',
    done: false,
    priority: 2,
    project_id: 1,
    position: 9200,
    related_tasks: {
      parenttask: [{ id: 101, title: 'Renew internal Caddy TLS & verify mobile sync', done: false, priority: 4, project_id: 1 }],
    },
  };

  const tasks = [
    {
      id: 101,
      title: 'Renew internal Caddy TLS & verify mobile sync',
      description:
        '<p>Validate private PKI certificate chain across VLANs.</p>' +
        '<ul data-type="taskList">' +
        '<li data-checked="true"><p>Install internal Root CA on Pixel</p></li>' +
        '<li data-checked="true"><p>Test offline mutation queue replay</p></li>' +
        '<li data-checked="false"><p>Confirm firewall rule on port 443</p></li>' +
        '</ul>',
      done: false,
      priority: 4,
      percent_done: 0.75,
      project_id: 1,
      position: 1000,
      due_date: todayEvening,
      reminders: [{ relative_to: 'due_date', relative_period: -900 }],
      labels: [labels[0], labels[1]],
      assignees: [currentUser],
      related_tasks: {
        subtask: [sub1, sub2, sub3],
      },
    },
    {
      id: 102,
      title: 'Rotate offsite BorgBackup repository keys',
      description: '<p>Quarterly key verification and restore drill.</p>',
      done: false,
      priority: 3,
      project_id: 1,
      position: 2000,
      due_date: yesterdayDue,
      labels: [labels[1]],
      assignees: [currentUser],
    },
    {
      id: 103,
      title: 'Check weekly ZFS scrub telemetry',
      description: 'Verify zero checksum errors across storage pools.',
      done: false,
      priority: 2,
      project_id: 1,
      position: 3000,
      due_date: tomorrowMorning,
      repeat_after: 604800,
      repeat_mode: 0,
      reminders: [{ relative_to: 'due_date', relative_period: 0 }],
      labels: [labels[0]],
    },
    {
      id: 104,
      title: 'Review reverse-proxy rate limit headers',
      done: false,
      priority: 1,
      project_id: 1,
      position: 4000,
      due_date: nextWeekDue,
      labels: [labels[4]],
      assignees: [teammate],
    },
    sub3,
    {
      id: 105,
      title: 'Upgrade Vikunja container to latest 2.x image',
      done: true,
      priority: 2,
      project_id: 1,
      position: 5000,
      labels: [labels[0]],
    },
    // Other project tasks (shown in All Lists search & drawer badges)
    {
      id: 201,
      title: 'Verify snapshot replication to TrueNAS',
      description: '<p>Check incremental zfs send bandwidth logs</p>',
      done: false,
      priority: 3,
      project_id: 2,
      position: 1000,
      due_date: todayEvening,
      labels: [labels[0]],
      assignees: [currentUser],
    },
    {
      id: 301,
      title: 'Publish signed Android release bundle',
      description: '<p>Upload R8 mapping.txt and verify internal track</p>',
      done: false,
      priority: 5,
      project_id: 3,
      position: 1000,
      due_date: todayEvening,
      labels: [labels[2]],
      assignees: [currentUser],
    },
    {
      id: 302,
      title: 'Write user manual & keyboard shortcut reference',
      done: false,
      priority: 2,
      project_id: 3,
      position: 2000,
      labels: [labels[4]],
    },
    {
      id: 401,
      title: 'Schedule annual dentist appointment',
      done: false,
      priority: 2,
      project_id: 4,
      position: 1000,
      due_date: tomorrowMorning,
      labels: [labels[3]],
    },
    {
      id: 501,
      title: 'Organic espresso beans & oat milk',
      done: false,
      priority: 1,
      project_id: 5,
      position: 1000,
      labels: [labels[3]],
    },
  ];

  return { currentUser, teammate, labels, projects, tasks };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function startDemoServer(dataset) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const sendJson = (obj, totalPages = 1) => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-pagination-total-pages': String(totalPages),
        });
        res.end(JSON.stringify(obj));
      };

      if (pathname === '/api/v1/user') return sendJson(dataset.currentUser);
      if (pathname === '/api/v1/labels') return sendJson(dataset.labels);
      if (pathname === '/api/v1/projects') return sendJson(dataset.projects);
      if (pathname === '/api/v1/tasks' || pathname === '/api/v1/tasks/all') {
        return sendJson(dataset.tasks);
      }
      if (pathname === '/api/v1/users/search') {
        return sendJson([dataset.currentUser, dataset.teammate]);
      }

      const projTasksMatch = pathname.match(/^\/api\/v1\/projects\/(-?\d+)\/(?:views\/\d+\/)?tasks$/);
      if (projTasksMatch) {
        const pid = Number(projTasksMatch[1]);
        if (pid === -2) {
          return sendJson(dataset.tasks.filter((t) => !t.done && t.priority >= 3));
        }
        if (pid === -3) {
          return sendJson(dataset.tasks.filter((t) => !t.done && Boolean(t.due_date)));
        }
        return sendJson(dataset.tasks.filter((t) => t.project_id === pid));
      }

      const projViewsMatch = pathname.match(/^\/api\/v1\/projects\/(-?\d+)\/views$/);
      if (projViewsMatch) {
        const pid = Number(projViewsMatch[1]);
        const found = dataset.projects.find((p) => p.id === pid);
        return sendJson(found?.views || [{ id: 900 + Math.abs(pid), title: 'List', project_id: pid, view_kind: 'list' }]);
      }

      if (pathname.startsWith('/api/v1/')) {
        return sendJson({ ok: true });
      }

      // Serve static files from dist/
      let relPath = pathname === '/' ? '/index.html' : pathname;
      let filePath = path.join(DIST_DIR, relPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function launchChromeWithCdp() {
  return new Promise((resolve, reject) => {
    const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'guanaco-cdp-'));
    const proc = spawn(
      CHROME_BIN,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`,
        '--remote-debugging-port=0',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stderrBuf = '';
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Timed out waiting for Chrome DevTools endpoint.\n${stderrBuf}`));
    }, 10000);

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const match = stderrBuf.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ proc, browserWsUrl: match[1], debugPort: Number(match[2]), userDataDir });
      }
    });
  });
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
      this.ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalJs(expression) {
    const out = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      throw new Error(`JS Eval error: ${JSON.stringify(out.exceptionDetails)}`);
    }
    return out.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWsUrl(debugPort) {
  const resp = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await resp.json();
  const page = targets.find((t) => t.type === 'page') || targets[0];
  return page.webSocketDebuggerUrl;
}

async function injectMobilePolishCss(cdp) {
  await cdp.evalJs(`(() => {
    if (!document.getElementById('guanaco-mobile-shot-css')) {
      const style = document.createElement('style');
      style.id = 'guanaco-mobile-shot-css';
      // Hide desktop-web-only inline Move/Delete fallback buttons so mobile screenshots match Android/iOS cards 1:1
      style.textContent = \`
        [data-testid^="task-move-action-"],
        [data-testid^="task-delete-action-"] {
          display: none !important;
        }
        * {
          -webkit-font-smoothing: antialiased;
        }
        ::-webkit-scrollbar {
          display: none;
        }
      \`;
      document.head.appendChild(style);
    }
  })()`);
}

async function seedSessionAndReload(cdp, baseUrl, themeMode = 'dark', width = 390, height = 844) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 768,
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: themeMode === 'light' ? 'light' : 'dark' }],
  });

  await cdp.send('Page.navigate', { url: baseUrl });
  await sleep(700);

  await cdp.evalJs(`(() => {
    localStorage.clear();
    localStorage.setItem('@vikunja_server_url', ${JSON.stringify(baseUrl)});
    localStorage.setItem('@vikunja_auth_token', 'tk_demo_screenshot_session');
    localStorage.setItem('@vikunja_username', 'alex');
    localStorage.setItem('@vikunja_saved_username', 'alex');
    localStorage.setItem('@vikunja_last_project_id', '1');
    localStorage.setItem('@vikunja_theme_mode', ${JSON.stringify(themeMode)});
    localStorage.setItem('@vikunja_reenable_staples', 'true');
  })()`);

  await cdp.send('Page.reload', { ignoreCache: true });
  // Wait for tasks to load & render
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const ready = await cdp.evalJs(
      `Boolean(document.querySelector('[data-testid="task-item-101"]'))`
    );
    if (ready) break;
  }
  await injectMobilePolishCss(cdp);
  await sleep(350);
}

async function clickTestId(cdp, testId) {
  await cdp.evalJs(`(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) throw new Error('Missing testID: ${testId}');
    el.click();
  })()`);
}

async function setInputValue(cdp, testId, value) {
  await cdp.evalJs(`(() => {
    const input = document.querySelector('[data-testid="${testId}"]');
    if (!input) throw new Error('Missing input testID: ${testId}');
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, ${JSON.stringify(value)});
    } else {
      input.value = ${JSON.stringify(value)};
    }
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function saveScreenshot(cdp, filename) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const outPath = path.join(SCREENSHOTS_DIR, filename);
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`✓ Saved ${path.relative(ROOT_DIR, outPath)}`);
}

async function main() {
  const dataset = buildDemoDataset();
  const { server, port } = await startDemoServer(dataset);
  const baseUrl = `http://127.0.0.1:${port}`;
  const { proc, debugPort, userDataDir } = await launchChromeWithCdp();
  let cdp = null;

  try {
    const pageWsUrl = await getPageWsUrl(debugPort);
    cdp = new CdpSession(pageWsUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 1. Main Task List — Dark Mode
    await seedSessionAndReload(cdp, baseUrl, 'dark', 390, 844);
    await saveScreenshot(cdp, '01-tasks-dark.png');

    // 2. Task Detail Modal — HTML Notes + Subtasks (2/3) + Duplicate
    await clickTestId(cdp, 'task-item-101');
    await sleep(450);
    await saveScreenshot(cdp, '03-task-detail-subtasks.png');
    await clickTestId(cdp, 'task-detail-close-btn');
    await sleep(350);

    // 3. Lists Drawer — Nested Hierarchy + Saved Filters + Open Counts
    await clickTestId(cdp, 'drawer-toggle-btn');
    await sleep(450);
    await saveScreenshot(cdp, '05-lists-drawer.png');

    // 4. Main Task List — Light Mode + Quick-Add NLP Shortcut Entry
    await seedSessionAndReload(cdp, baseUrl, 'light', 390, 844);
    await setInputValue(
      cdp,
      'quick-add-input',
      'Audit WireGuard peers #security !high tomorrow at 9am'
    );
    await sleep(350);
    await saveScreenshot(cdp, '02-tasks-light.png');

    // 5. Pure Black OLED Theme + Cross-List Global Search
    await seedSessionAndReload(cdp, baseUrl, 'oled', 390, 844);
    await clickTestId(cdp, 'header-search-btn');
    await sleep(250);
    await clickTestId(cdp, 'search-scope-all-lists');
    await setInputValue(cdp, 'task-search-input', 'homelab');
    await sleep(350);
    await saveScreenshot(cdp, '04-global-search-oled.png');

    // 6. Tablet / Foldable Dual-Pane Split-View (Dark Mode)
    await seedSessionAndReload(cdp, baseUrl, 'dark', 1024, 700);
    await saveScreenshot(cdp, '06-tablet-split-view.png');
  } finally {
    cdp?.close();
    proc.kill('SIGKILL');
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
