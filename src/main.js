// Antigravity Mascot — Main Process
// Unified Windows taskbar companion for Antigravity & Claude Code / Claude Desktop.
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const i18n = require('./i18n');
const agyHooks = require('./hooks-antigravity');
const claudeHooks = require('./hooks-claude');
const toasts = require('./toasts');

let w32 = null;
try {
  w32 = require('./win32');
} catch (err) {
  console.error('[win32] failed to load koffi bindings:', err.message);
}

const PORT = +process.env.MASCOT_PORT || agyHooks.DEFAULT_PORT;
const BASE_HEIGHT = 215;
const SCALES = [1, 1.4, 1.8];
const ASSETS = path.join(__dirname, '..', 'assets');

app.setAppUserModelId('com.makerkk.antigravity.mascot');
if (!process.env.MASCOT_ALLOW_MULTI && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- Persistent Config ----------
const cfgFile = () => process.env.MASCOT_CONFIG || path.join(app.getPath('userData'), 'config.json');

let cfg = {
  lang: 'auto',
  scale: 1.4,
  sound: true,
  volume: 0.85,
  pauseSec: 7,
  autostart: false,
  agyHook: true,
  agyStopHook: true,
  claudeHook: true,
  claudeStopHook: true,
  toasts: true,
  firstRunDone: false,
};

function loadCfg() {
  try {
    if (fs.existsSync(cfgFile())) {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile(), 'utf8')) };
    }
  } catch (e) {
    console.error('[cfg] load error:', e.message);
  }
}

function saveCfg() {
  try {
    fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
    fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.error('[cfg] save error:', e.message);
  }
}

const curScale = () => (SCALES.includes(cfg.scale) ? cfg.scale : 1.4);
const curLang = () => i18n.resolve(cfg.lang);
const t = () => i18n.T[curLang()];

// ---------- Runtime State ----------
let overlayWin = null;
let settingsWin = null;
let tray = null;
let server = null;
let stopToasts = null;

let activeAlert = null; // { source: 'antigravity'|'claude', reason: string } | null
let pendingStatusReply = null;
const recentEvents = [];

const fgActive = { antigravity: false, claude: false };
const lastHwnd = { antigravity: 0, claude: 0 };
const knownExe = {
  antigravity: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
  claude: '',
};

function recordEvent(source, detail) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  recentEvents.unshift({ source, detail, time });
  if (recentEvents.length > 12) recentEvents.length = 12;
  broadcastState();
}

function isAntigravityWindow(w) {
  if (!w || w.pid === process.pid) return false;
  if (w.exe === 'antigravity.exe') return true;
  if (/mascot/i.test(w.title) || w.exe === 'antigravitymascot.exe') return false;
  return /\bantigravity\b/i.test(w.title);
}

function isClaudeWindow(w) {
  if (!w || w.pid === process.pid) return false;
  if (w.exe === 'claude.exe') return true;
  if (/mascot/i.test(w.title) || w.exe === 'antigravitymascot.exe') return false;
  return /\bclaude\b/i.test(w.title);
}

// ---------- Overlay Window ----------
function calcOverlayBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.round(BASE_HEIGHT * curScale());
  return {
    x: wa.x,
    y: wa.y + wa.height - h,
    width: wa.width,
    height: h,
  };
}

function pushOverlayConfig() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.setZoomFactor(curScale());
  overlayWin.webContents.send('config', {
    lang: curLang(),
    sound: cfg.sound,
    volume: cfg.volume,
    pauseSec: cfg.pauseSec,
  });
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    ...calcOverlayBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    title: 'Antigravity Mascot Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setMenu(null);
  overlayWin.loadFile(path.join(__dirname, 'mascot.html'), { query: { lang: curLang() } });

  overlayWin.webContents.on('did-finish-load', () => {
    pushOverlayConfig();
  });

  overlayWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlayWin.webContents.on('will-navigate', e => e.preventDefault());

  const refit = () => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setBounds(calcOverlayBounds());
  };
  screen.on('display-metrics-changed', refit);
  screen.on('display-added', refit);
  screen.on('display-removed', refit);
}

function showOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setBounds(calcOverlayBounds());
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  if (!overlayWin.isVisible()) overlayWin.showInactive();
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.moveTop();
}

function notify({ source = 'antigravity', reason = 'complete', stage = 0, force = false } = {}) {
  if (!overlayWin || overlayWin.isDestroyed()) return false;
  const src = source === 'claude' ? 'claude' : 'antigravity';
  if (!force) {
    if (fgActive[src]) return false; // User is already looking at that app!
    if (activeAlert && activeAlert.source === src) return false; // Already alerting for this app
  }
  activeAlert = { source: src, reason };
  showOverlay();
  overlayWin.webContents.send('notify', { source: src, reason, stage });
  return true;
}

function dismiss(onlySource = null) {
  if (!activeAlert || !overlayWin || overlayWin.isDestroyed()) return;
  if (onlySource && activeAlert.source !== onlySource) return;
  activeAlert = null;
  overlayWin.webContents.send('leave');
}

// ---------- Settings / Control Deck Window ----------
function getFullState() {
  return {
    port: PORT,
    cfg,
    activeAlert,
    fgActive,
    hooks: {
      antigravity: agyHooks.status(PORT),
      claude: claudeHooks.status(PORT),
    },
    recentEvents,
  };
}

function broadcastState() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('stateChanged', getFullState());
  }
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 540,
    minHeight: 560,
    backgroundColor: '#0B101E',
    title: 'Antigravity Mascot — 설정 및 컨트롤 데크',
    icon: path.join(ASSETS, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- Foreground Polling & Target Focus ----------
function pollForeground() {
  if (!w32) return;
  let fg = null;
  try {
    fg = w32.foreground();
  } catch {
    return;
  }

  const agyNow = isAntigravityWindow(fg);
  const claudeNow = isClaudeWindow(fg);

  if (agyNow) {
    lastHwnd.antigravity = fg.hwnd;
    if (fg.exe === 'antigravity.exe' && fg.path) knownExe.antigravity = fg.path;
    if (activeAlert && activeAlert.source === 'antigravity') dismiss('antigravity');
  }
  if (claudeNow) {
    lastHwnd.claude = fg.hwnd;
    if (fg.exe === 'claude.exe' && fg.path) knownExe.claude = fg.path;
    if (activeAlert && activeAlert.source === 'claude') dismiss('claude');
  }

  fgActive.antigravity = agyNow;
  fgActive.claude = claudeNow;
}

function focusTarget(source) {
  const src = source === 'claude' ? 'claude' : 'antigravity';
  if (!w32) {
    if (src === 'claude') shell.openExternal('claude://');
    return;
  }
  try {
    let h = w32.alive(lastHwnd[src]) ? lastHwnd[src] : 0;
    if (!h) {
      const exeName = src === 'claude' ? 'claude.exe' : 'antigravity.exe';
      const byExe = w32.windowsOf(exeName);
      if (byExe.length) h = byExe[0].hwnd;
    }
    if (!h) {
      const matcher = src === 'claude' ? isClaudeWindow : isAntigravityWindow;
      const byTitle = w32.windowsMatching(matcher);
      if (byTitle.length) h = byTitle[0].hwnd;
    }
    if (h) {
      w32.activate(h);
      return;
    }
    // Hidden to tray -> re-launching single-instance app restores its main window
    const exeName = src === 'claude' ? 'claude.exe' : 'antigravity.exe';
    const hidden = w32.windowsOf(exeName, { visibleOnly: false });
    const exe = (hidden[0] && hidden[0].path) || knownExe[src];
    if (exe && fs.existsSync(exe)) {
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    } else if (src === 'claude') {
      shell.openExternal('claude://');
    }
  } catch (e) {
    console.error('[focusTarget]', src, e.message);
  }
}

// ---------- Hook Sync ----------
function syncAllHooks() {
  try {
    agyHooks.apply({
      enabled: cfg.agyHook,
      stopHook: cfg.agyStopHook,
      port: PORT,
    });
  } catch (e) {
    console.error('[hooks:antigravity]', e.message);
  }
  try {
    claudeHooks.apply({
      enabled: cfg.claudeHook,
      stopHook: cfg.claudeStopHook,
      port: PORT,
    });
  } catch (e) {
    console.error('[hooks:claude]', e.message);
  }
}

function exeForAutostart() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}
function argsForAutostart() {
  return app.isPackaged ? [] : [app.getAppPath()];
}
function applyAutostart(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: exeForAutostart(),
      args: argsForAutostart(),
    });
  } catch (e) {
    console.error('[autostart]', e.message);
  }
}

// ---------- Local HTTP Hook Server ----------
const CLAUDE_ASK_TOOLS = ['AskUserQuestion', 'ExitPlanMode'];

function startHookServer() {
  server = http.createServer((req, res) => {
    if (req.headers.origin) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      const parsed = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
      const pathname = parsed.pathname;

      if (pathname === '/status') {
        handleStatusRequest(res);
        return;
      }

      // 1. Antigravity Lifecycle Hook Endpoint (must return valid JSON on stdout!)
      if (pathname === '/hook/antigravity') {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch {}
        const ev = parsed.searchParams.get('event') || 'Stop';

        if (ev === 'PreInvocation' || ev === 'PostToolUse') {
          dismiss('antigravity');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{}');
          return;
        }

        if (ev === 'PreToolUse') {
          const toolName = (payload.toolCall && payload.toolCall.name) || 'ask_question';
          recordEvent('antigravity', `질문/확인 요청 (${toolName})`);
          notify({ source: 'antigravity', reason: 'question' });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end('{"decision":"allow"}');
          return;
        }

        // Stop event
        const term = payload.terminationReason || 'NO_TOOL_CALL';
        const isErr = term === 'ERROR' || !!payload.error;
        const skipBg = payload.fullyIdle === false && !isErr;
        const canceled = term === 'USER_CANCELED';

        if (!skipBg && !canceled && cfg.agyStopHook) {
          recordEvent('antigravity', isErr ? `오류 정지 (${term})` : '작업 완료 및 대기 (Stop)');
          notify({ source: 'antigravity', reason: isErr ? 'error' : 'complete' });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"decision":"allow"}');
        return;
      }

      // 2. Claude Code Hook Endpoint (204 empty body)
      if (pathname === '/hook/claude' || pathname === '/hook') {
        res.writeHead(204);
        res.end();
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch {}
        const ev = payload.hook_event_name || parsed.searchParams.get('event') || 'Notification';

        if (ev === 'UserPromptSubmit') {
          dismiss('claude');
          return;
        }
        if (ev === 'Notification' && payload.notification_type === 'auth_success') return;
        if (ev === 'PreToolUse' && payload.tool_name && !CLAUDE_ASK_TOOLS.includes(payload.tool_name)) return;
        if (ev === 'Stop' && !cfg.claudeStopHook) return;

        let reason = 'question';
        if (ev === 'PermissionRequest' || payload.notification_type === 'permission_prompt') reason = 'permission';
        else if (ev === 'Stop') reason = 'complete';

        recordEvent('claude', `이벤트 수신 (${ev})`);
        notify({ source: 'claude', reason });
        return;
      }

      // 3. Direct control endpoints (/test, /notify, /dismiss)
      if (pathname === '/test' || pathname === '/notify') {
        const source = parsed.searchParams.get('source') || 'antigravity';
        const reason = parsed.searchParams.get('reason') || 'complete';
        const stage = Number(parsed.searchParams.get('stage') || 0);
        const force = pathname === '/test';
        recordEvent(source, force ? `수동 테스트 (${reason})` : `알림 호출 (${reason})`);
        notify({ source, reason, stage, force });
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === '/dismiss') {
        const source = parsed.searchParams.get('source') || null;
        dismiss(source);
        res.writeHead(204);
        res.end();
        return;
      }

      if (process.env.MASCOT_DEBUG && pathname === '/quit') {
        res.writeHead(204);
        res.end();
        app.quit();
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  server.on('error', err => {
    const T = t();
    dialog.showErrorBox(T.name, err.code === 'EADDRINUSE' ? T.portBusy(PORT) : T.portErr(PORT, err.message));
  });

  server.listen(PORT, '127.0.0.1');
}

function handleStatusRequest(res) {
  const send = obj => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const base = {
    ...getFullState(),
    windowVisible: !!overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible(),
    bounds: overlayWin && !overlayWin.isDestroyed() ? overlayWin.getBounds() : null,
  };
  if (!overlayWin || overlayWin.isDestroyed()) return send(base);
  const timer = setTimeout(() => {
    pendingStatusReply = null;
    send(base);
  }, 500);
  pendingStatusReply = rendererStatus => {
    clearTimeout(timer);
    send({ ...base, renderer: rendererStatus });
  };
  overlayWin.webContents.send('status');
}

// ---------- Tray ----------
const trayIcons = {};

function setTrayPing(ping) {
  if (!tray) return;
  tray.setImage(ping ? trayIcons.ping : trayIcons.normal);
}

function applyConfigPatch(patch) {
  cfg = { ...cfg, ...patch };
  saveCfg();

  if ('scale' in patch && overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setBounds(calcOverlayBounds());
  }
  pushOverlayConfig();

  if ('agyHook' in patch || 'agyStopHook' in patch || 'claudeHook' in patch || 'claudeStopHook' in patch) {
    syncAllHooks();
  }
  if ('autostart' in patch) {
    applyAutostart(cfg.autostart);
  }
  if (tray) {
    tray.setToolTip(`${t().tooltip} (v${app.getVersion()})`);
    buildTrayMenu();
  }
  broadcastState();
  return getFullState();
}

function buildTrayMenu() {
  if (!tray) return;
  const T = t();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: T.openDashboard, click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: T.testAgy, click: () => { recordEvent('antigravity', '트레이 테스트'); notify({ source: 'antigravity', reason: 'question', force: true }); } },
    { label: T.testClaude, click: () => { recordEvent('claude', '트레이 테스트'); notify({ source: 'claude', reason: 'permission', force: true }); } },
    { label: T.dismissNow, click: () => dismiss() },
    { type: 'separator' },
    {
      label: T.size,
      submenu: SCALES.map((val, idx) => ({
        label: T.sizes[idx],
        type: 'radio',
        checked: curScale() === val,
        click: () => {
          applyConfigPatch({ scale: val });
          notify({ source: 'antigravity', reason: 'complete', force: true });
        },
      })),
    },
    {
      label: T.language,
      submenu: [['auto', T.langAuto], ...i18n.LANGS].map(([val, label]) => ({
        label,
        type: 'radio',
        checked: (cfg.lang || 'auto') === val,
        click: () => applyConfigPatch({ lang: val }),
      })),
    },
    {
      label: T.sound,
      type: 'checkbox',
      checked: cfg.sound,
      click: m => applyConfigPatch({ sound: m.checked }),
    },
    {
      label: T.autostart,
      type: 'checkbox',
      checked: cfg.autostart,
      click: m => applyConfigPatch({ autostart: m.checked }),
    },
    { type: 'separator' },
    {
      label: T.agySection,
      type: 'checkbox',
      checked: cfg.agyHook,
      click: m => applyConfigPatch({ agyHook: m.checked }),
    },
    {
      label: T.agyStopHook,
      type: 'checkbox',
      checked: cfg.agyStopHook,
      enabled: cfg.agyHook,
      click: m => applyConfigPatch({ agyStopHook: m.checked }),
    },
    {
      label: T.claudeSection,
      type: 'checkbox',
      checked: cfg.claudeHook,
      click: m => applyConfigPatch({ claudeHook: m.checked }),
    },
    {
      label: T.claudeStopHook,
      type: 'checkbox',
      checked: cfg.claudeStopHook,
      enabled: cfg.claudeHook,
      click: m => applyConfigPatch({ claudeStopHook: m.checked }),
    },
    {
      label: T.toasts,
      type: 'checkbox',
      checked: cfg.toasts,
      click: m => applyConfigPatch({ toasts: m.checked }),
    },
    { type: 'separator' },
    { label: T.quit, click: () => app.quit() },
  ]));
}

function createTray() {
  trayIcons.normal = nativeImage.createFromPath(path.join(ASSETS, 'tray.ico'));
  trayIcons.ping = nativeImage.createFromPath(path.join(ASSETS, 'tray-ping.ico'));
  tray = new Tray(trayIcons.normal);
  tray.setToolTip(`${t().tooltip} (v${app.getVersion()})`);
  tray.on('click', () => tray.popUpContextMenu());
  tray.on('double-click', () => openSettingsWindow());
  buildTrayMenu();
}

// ---------- IPC Handlers ----------
ipcMain.on('mascot:mouse', (_e, over) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(!over, { forward: true });
  }
});

ipcMain.on('mascot:idle', () => {
  if (activeAlert || !overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.hide();
});

ipcMain.on('mascot:ping', (_e, on) => setTrayPing(on));

ipcMain.on('mascot:clicked', () => {
  const target = activeAlert ? activeAlert.source : 'antigravity';
  activeAlert = null;
  focusTarget(target);
});

ipcMain.on('mascot:status', (_e, s) => {
  if (pendingStatusReply) {
    pendingStatusReply(s);
    pendingStatusReply = null;
  }
});

ipcMain.handle('settings:getState', () => getFullState());
ipcMain.handle('settings:updateConfig', (_e, patch) => applyConfigPatch(patch || {}));
ipcMain.handle('settings:test', (_e, opts = {}) => {
  const source = opts.source || 'antigravity';
  const reason = opts.reason || 'question';
  const stage = Number(opts.stage || 0);
  recordEvent(source, `컨트롤 데크 테스트 (${reason})`);
  return notify({ source, reason, stage, force: true });
});
ipcMain.handle('settings:dismiss', () => {
  dismiss();
  return true;
});

// ---------- App Lifecycle ----------
app.on('second-instance', () => {
  openSettingsWindow();
});

app.on('window-all-closed', () => {
  // Keep running in system tray
});

app.on('before-quit', () => {
  try { if (stopToasts) stopToasts(); } catch {}
  try { if (server) server.close(); } catch {}
});

app.whenReady().then(() => {
  loadCfg();
  createOverlayWindow();
  createTray();
  startHookServer();
  syncAllHooks();
  buildTrayMenu();

  if (cfg.autostart) applyAutostart(true);
  setInterval(pollForeground, 300);

  stopToasts = toasts.watch(source => {
    if (!cfg.toasts) return;
    recordEvent(source, 'Windows 데스크탑 알림 감지');
    notify({ source, reason: 'question' });
  });

  if (!cfg.firstRunDone && !process.env.MASCOT_HEADLESS_TEST) {
    cfg.firstRunDone = true;
    saveCfg();
    if (tray) {
      tray.displayBalloon({
        title: t().started,
        content: t().startedOk,
        iconType: 'info',
      });
    }
  }
});
