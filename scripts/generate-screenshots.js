#!/usr/bin/env node
/**
 * Generates live high-DPI screenshots of Guanaco from the production web bundle (`dist/`)
 * using headless Google Chrome + Chrome DevTools Protocol (CDP) into `docs/assets/screenshots/`.
 *
 * Output dimensions are Play-Store-ready and GitHub-ready:
 * - Phone screenshots: 1215x2160 (exact 9:16 at 3x DPR)
 * - Tablet screenshots: 2240x1260 (exact 16:9 at 2x DPR)
 * Note: `docs/assets/social-preview.png` is custom illustrated artwork and is preserved.
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

if (process.argv.includes('--rebuild-web') || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.log('Building production web bundle (npx expo export -p web)...');
  execFileSync('npx', ['expo', 'export', '-p', 'web'], { cwd: ROOT_DIR, stdio: 'inherit' });
}

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// Build warm, everyday household, grocery, and family demo lists relative to "now"
function buildDemoDataset() {
  const now = new Date();
  const todayEvening = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    17,
    30,
    0
  ).toISOString();
  const tomorrowMorning = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    10,
    0,
    0
  ).toISOString();
  const yesterdayDue = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    15,
    0,
    0
  ).toISOString();
  const nextWeekDue = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 4,
    11,
    0,
    0
  ).toISOString();

  const currentUser = { id: 1, username: 'alex', name: 'Alex' };
  const partner = { id: 2, username: 'emma', name: 'Emma' };

  const labels = [
    { id: 1, title: 'TraderJoes', hex_color: '#FF453A' },
    { id: 2, title: 'Costco', hex_color: '#0A84FF' },
    { id: 3, title: 'FarmersMarket', hex_color: '#30D158' },
    { id: 4, title: 'weekend', hex_color: '#BF5AF2' },
    { id: 5, title: 'hardware', hex_color: '#FF9F0A' },
    { id: 6, title: 'garden', hex_color: '#32D74B' },
    { id: 7, title: 'home', hex_color: '#64D2FF' },
  ];

  const projects = [
    {
      id: 1,
      title: 'Weekly Groceries',
      hex_color: '#FF9F0A',
      is_favorite: true,
      views: [{ id: 101, title: 'List', project_id: 1, view_kind: 'list' }],
    },
    {
      id: 2,
      title: 'Honey-Do & Home',
      hex_color: '#0A84FF',
      is_favorite: true,
      views: [{ id: 102, title: 'List', project_id: 2, view_kind: 'list' }],
    },
    {
      id: 3,
      title: 'Family & Errands',
      hex_color: '#30D158',
      views: [{ id: 103, title: 'List', project_id: 3, view_kind: 'list' }],
    },
    {
      id: 4,
      title: 'Lake Tahoe Family Trip',
      parent_project_id: 3,
      hex_color: '#64D2FF',
      views: [{ id: 104, title: 'List', project_id: 4, view_kind: 'list' }],
    },
    {
      id: 5,
      title: 'Birthday & Gift Ideas',
      hex_color: '#BF5AF2',
      views: [{ id: 105, title: 'List', project_id: 5, view_kind: 'list' }],
    },
    {
      id: 6,
      title: 'Spring Kitchen Remodel',
      hex_color: '#8E8E93',
      is_archived: true,
    },
    {
      id: -2,
      title: 'Due This Week',
      hex_color: '#0A84FF',
      views: [{ id: 201, title: 'List', project_id: -2, view_kind: 'list' }],
    },
    {
      id: -3,
      title: 'Weekend Projects',
      hex_color: '#FF453A',
      views: [{ id: 202, title: 'List', project_id: -3, view_kind: 'list' }],
    },
  ];

  const sub1 = {
    id: 211,
    title: 'Check Moen cartridge model number',
    done: true,
    priority: 2,
    project_id: 2,
    position: 9000,
    related_tasks: {
      parenttask: [
        {
          id: 201,
          title: 'Fix leaky kitchen faucet',
          done: false,
          priority: 4,
          project_id: 2,
        },
      ],
    },
  };
  const sub2 = {
    id: 212,
    title: 'Pick up brass O-ring kit at Ace Hardware',
    done: true,
    priority: 2,
    project_id: 2,
    position: 9100,
    related_tasks: {
      parenttask: [
        {
          id: 201,
          title: 'Fix leaky kitchen faucet',
          done: false,
          priority: 4,
          project_id: 2,
        },
      ],
    },
  };
  const sub3 = {
    id: 213,
    title: 'Re-caulk around faucet baseplate',
    done: false,
    priority: 2,
    project_id: 2,
    position: 9200,
    related_tasks: {
      parenttask: [
        {
          id: 201,
          title: 'Fix leaky kitchen faucet',
          done: false,
          priority: 4,
          project_id: 2,
        },
      ],
    },
  };

  const tasks = [
    // 1. Weekly Groceries (Project 1 — showcases Department / Aisle grouping!)
    {
      id: 101,
      title: 'Honeycrisp apples & ripe avocados',
      done: false,
      priority: 2,
      project_id: 1,
      position: 1000,
      labels: [labels[0]],
    },
    {
      id: 102,
      title: 'Fresh basil, lemons & garlic',
      done: false,
      priority: 1,
      project_id: 1,
      position: 2000,
      labels: [labels[2], labels[3]],
    },
    {
      id: 103,
      title: 'Pasture-raised eggs & oat milk',
      done: false,
      priority: 3,
      project_id: 1,
      position: 3000,
      due_date: todayEvening,
      labels: [labels[1]],
      assignees: [currentUser],
    },
    {
      id: 104,
      title: 'Greek yogurt & aged sharp cheddar',
      done: false,
      priority: 1,
      project_id: 1,
      position: 4000,
      labels: [labels[0]],
    },
    {
      id: 105,
      title: 'Wild Alaskan salmon fillets',
      done: false,
      priority: 2,
      project_id: 1,
      position: 5000,
      labels: [labels[1]],
      assignees: [partner],
    },
    {
      id: 106,
      title: 'Warm sourdough loaf & olive oil',
      done: false,
      priority: 2,
      project_id: 1,
      position: 5500,
      labels: [labels[2], labels[3]],
      assignees: [partner],
    },
    {
      id: 107,
      title: 'Whole-bean espresso roast',
      done: true,
      priority: 1,
      project_id: 1,
      position: 6000,
      labels: [labels[1]],
    },

    // 2. Honey-Do & Home (Project 2 — subtasks, checklist notes, recurring tasks)
    {
      id: 201,
      title: 'Fix leaky kitchen faucet',
      description:
        '<p>Stop slow drip on cold handle before family visits.</p>' +
        '<ul data-type="taskList">' +
        '<li data-checked="true"><p>Shut off valves under sink</p></li>' +
        '<li data-checked="false"><p>Swap cartridge &amp; rinse aerator</p></li>' +
        '</ul>',
      done: false,
      priority: 4,
      percent_done: 0.75,
      project_id: 2,
      position: 1000,
      due_date: todayEvening,
      reminders: [{ relative_to: 'due_date', relative_period: -900 }],
      labels: [labels[3], labels[4]],
      assignees: [currentUser],
      related_tasks: {
        subtask: [sub1, sub2, sub3],
      },
    },
    {
      id: 202,
      title: 'Hang floating oak shelves in guest room',
      description: '<p>Find wall studs and level brackets above desk.</p>',
      done: false,
      priority: 3,
      project_id: 2,
      position: 2000,
      due_date: yesterdayDue,
      labels: [labels[3], labels[6]],
      assignees: [currentUser],
    },
    {
      id: 203,
      title: 'Water indoor plants & patio herbs',
      done: false,
      priority: 2,
      project_id: 2,
      position: 3000,
      due_date: tomorrowMorning,
      repeat_after: 345600, // Every 4 days
      repeat_mode: 0,
      reminders: [{ relative_to: 'due_date', relative_period: 0 }],
      labels: [labels[5]],
    },
    {
      id: 204,
      title: 'Replace hallway air filter (16x25x1)',
      done: false,
      priority: 1,
      project_id: 2,
      position: 4000,
      due_date: nextWeekDue,
      labels: [labels[6]],
      assignees: [partner],
    },
    sub3,

    // 3. Family & Errands (Project 3 — showcases On-Device Smart Grouping on Tablet!)
    {
      id: 301,
      title: 'Schedule annual dentist checkup for kids',
      done: false,
      priority: 3,
      project_id: 3,
      position: 1000,
      due_date: tomorrowMorning,
      labels: [labels[6]],
      assignees: [partner],
    },
    {
      id: 302,
      title: 'Renew library books & pick up hold',
      done: false,
      priority: 2,
      project_id: 3,
      position: 2000,
      due_date: todayEvening,
    },
    {
      id: 303,
      title: 'Drop off winter coats at dry cleaner',
      done: false,
      priority: 2,
      project_id: 3,
      position: 3000,
      labels: [labels[3]],
    },
    {
      id: 304,
      title: 'Clean patio grill & refill propane tank',
      done: false,
      priority: 2,
      project_id: 3,
      position: 4000,
      due_date: nextWeekDue,
      labels: [labels[3], labels[4]],
      assignees: [currentUser],
    },
    {
      id: 305,
      title: 'Book flight & rental car for Thanksgiving',
      done: false,
      priority: 4,
      project_id: 3,
      position: 5000,
      due_date: todayEvening,
      assignees: [currentUser],
    },

    // 4. Lake Tahoe Family Trip (Project 4 — showcases Smart Grouping categories on Tablet!)
    {
      id: 401,
      title: 'Print cabin reservation & trail passes',
      done: false,
      priority: 3,
      project_id: 4,
      position: 1000,
      due_date: todayEvening,
      labels: [labels[3]],
      assignees: [currentUser],
    },
    {
      id: 402,
      title: 'Pack hiking boots, fleece jackets & warm socks',
      done: false,
      priority: 3,
      project_id: 4,
      position: 2000,
      due_date: nextWeekDue,
      labels: [labels[3]],
      assignees: [currentUser, partner],
    },
    {
      id: 403,
      title: 'Charge camera battery, power bank & headlamps',
      done: false,
      priority: 2,
      project_id: 4,
      position: 3000,
      due_date: tomorrowMorning,
      labels: [labels[3]],
    },
    {
      id: 404,
      title: 'Sunscreen, first-aid meds & lip balm',
      done: false,
      priority: 1,
      project_id: 4,
      position: 4000,
      labels: [labels[0]],
    },
    {
      id: 405,
      title: 'Pack cooler, firewood & s’mores kit',
      done: false,
      priority: 2,
      project_id: 4,
      position: 5000,
      labels: [labels[0], labels[3]],
      assignees: [partner],
    },

    // 5. Birthday & Gift Ideas (Project 5)
    {
      id: 501,
      title: 'Cast-iron Dutch oven for Mom’s birthday',
      done: false,
      priority: 2,
      project_id: 5,
      position: 1000,
    },
  ];

  return { currentUser, partner, labels, projects, tasks };
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
        return sendJson([dataset.currentUser, dataset.partner]);
      }

      const projTasksMatch = pathname.match(/^\/api\/v1\/projects\/(-?\d+)\/(?:views\/\d+\/)?tasks$/);
      if (projTasksMatch) {
        const pid = Number(projTasksMatch[1]);
        if (pid === -2) {
          return sendJson(dataset.tasks.filter((t) => !t.done && Boolean(t.due_date)));
        }
        if (pid === -3) {
          return sendJson(
            dataset.tasks.filter(
              (t) => !t.done && (t.labels || []).some((l) => l.title === 'weekend')
            )
          );
        }
        return sendJson(dataset.tasks.filter((t) => t.project_id === pid));
      }

      const projViewsMatch = pathname.match(/^\/api\/v1\/projects\/(-?\d+)\/views$/);
      if (projViewsMatch) {
        const pid = Number(projViewsMatch[1]);
        const found = dataset.projects.find((p) => p.id === pid);
        return sendJson(
          found?.views || [{ id: 900 + Math.abs(pid), title: 'List', project_id: pid, view_kind: 'list' }]
        );
      }

      if (pathname.startsWith('/api/v1/')) {
        return sendJson({ ok: true });
      }

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

async function seedSessionAndReload(cdp, baseUrl, opts = {}) {
  const {
    themeMode = 'dark',
    projectId = 1,
    width = 405,
    height = 720,
    dpr = 3,
  } = opts;

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile: width < 768,
  });
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: themeMode === 'light' ? 'light' : 'dark' }],
  });

  // On-device heuristic Smart Grouping runs deterministically offline without browser prompt APIs

  await cdp.send('Page.navigate', { url: baseUrl });
  await sleep(650);

  await cdp.evalJs(`(() => {
    localStorage.clear();
    localStorage.setItem('@vikunja_server_url', ${JSON.stringify(baseUrl)});
    localStorage.setItem('@vikunja_auth_token', 'tk_demo_screenshot_session');
    localStorage.setItem('@vikunja_username', 'alex');
    localStorage.setItem('@vikunja_saved_username', 'alex');
    localStorage.setItem('@vikunja_last_project_id', ${JSON.stringify(String(projectId))});
    localStorage.setItem('@vikunja_theme_mode', ${JSON.stringify(themeMode)});
    localStorage.setItem('@vikunja_reenable_staples', 'true');
  })()`);

  await cdp.send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const ready = await cdp.evalJs(
      `Boolean(document.querySelector('[data-testid^="task-item-"]'))`
    );
    if (ready) break;
  }
  await injectMobilePolishCss(cdp);
  await sleep(350);
}

async function clickSelector(cdp, selector) {
  await cdp.evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing selector: ' + ${JSON.stringify(selector)});
    el.click();
  })()`);
}

async function clickTestId(cdp, testId) {
  await clickSelector(cdp, `[data-testid="${testId}"]`);
}

async function selectSortOption(cdp, sortKey) {
  await clickSelector(cdp, '[aria-label="Sort tasks"]');
  await sleep(250);
  await cdp.evalJs(`(() => {
    const primary = document.querySelector('[data-testid="sort-option-' + ${JSON.stringify(sortKey)} + '"]');
    const fallback = ${JSON.stringify(sortKey)} === 'department'
      ? document.querySelector('[data-testid="sort-option-aiSmart"]')
      : null;
    const el = primary || fallback;
    if (!el) throw new Error('Missing sort option: ' + ${JSON.stringify(sortKey)});
    el.click();
  })()`);
  await sleep(350);
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

    // 1. Weekly Groceries — Dark Mode + Department / Aisle Smart Sort (1215x2160, 9:16)
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'dark',
      projectId: 1,
      width: 405,
      height: 720,
      dpr: 3,
    });
    await selectSortOption(cdp, 'department');
    await saveScreenshot(cdp, '01-tasks-dark.png');

    // 2. Honey-Do & Home — Light Mode + Subtask Progress + Live Quick-Add Chips (1215x2160, 9:16)
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'light',
      projectId: 2,
      width: 405,
      height: 720,
      dpr: 3,
    });
    await setInputValue(
      cdp,
      'quick-add-input',
      'Paint samples #hardware tomorrow'
    );
    await sleep(350);
    await saveScreenshot(cdp, '02-tasks-light.png');

    // 3. Task Detail Modal — Checklist Notes + Subtasks (2/3) on Honey-Do item (Dark Mode)
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'dark',
      projectId: 2,
      width: 405,
      height: 720,
      dpr: 3,
    });
    await clickTestId(cdp, 'task-item-201');
    await sleep(450);
    await saveScreenshot(cdp, '03-task-detail-subtasks.png');
    await clickTestId(cdp, 'task-detail-close-btn');
    await sleep(350);

    // 4. Lists Drawer — Saved Filters, Favorites (Groceries + Honey-Do), Nested Sublists
    await clickTestId(cdp, 'drawer-toggle-btn');
    await sleep(450);
    await saveScreenshot(cdp, '05-lists-drawer.png');

    // 5. Pure Black OLED Theme + Cross-List Search ("weekend")
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'oled',
      projectId: 2,
      width: 405,
      height: 720,
      dpr: 3,
    });
    await clickTestId(cdp, 'header-search-btn');
    await sleep(250);
    await clickTestId(cdp, 'search-scope-all-lists');
    await setInputValue(cdp, 'task-search-input', 'weekend');
    await sleep(350);
    await saveScreenshot(cdp, '04-global-search-oled.png');

    // 6. Tablet Split-Screen — Dark Mode + Smart Grouping on Lake Tahoe Family Trip (2240x1260, 16:9)
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'dark',
      projectId: 4,
      width: 1120,
      height: 630,
      dpr: 2,
    });
    await selectSortOption(cdp, 'aiSmart');
    await saveScreenshot(cdp, '06-tablet-split-view.png');

    // 7. Tablet Split-Screen — Light Mode + Weekly Groceries Aisle Sort (2240x1260, 16:9)
    await seedSessionAndReload(cdp, baseUrl, {
      themeMode: 'light',
      projectId: 1,
      width: 1120,
      height: 630,
      dpr: 2,
    });
    await selectSortOption(cdp, 'department');
    await saveScreenshot(cdp, '07-tablet-groceries-light.png');
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
