// Safely installs/updates/removes Claude Code hooks in ~/.claude/settings.json
// with automatic backups while strictly preserving all other user hooks (e.g. impeccable).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = +process.env.MASCOT_PORT || 47822;

function settingsPath() {
  return process.env.MASCOT_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
}

function markerFor(port = DEFAULT_PORT) {
  return `127.0.0.1:${port}/hook/claude`;
}

function commandFor(port = DEFAULT_PORT, event = '') {
  const qs = event ? `?event=${event}` : '';
  return `curl.exe -s -m 2 --data-binary @- "http://127.0.0.1:${port}/hook/claude${qs}" || exit 0`;
}

const HOOK_SPECS = {
  Notification: {},
  PermissionRequest: {},
  PreToolUse: { matcher: 'AskUserQuestion|ExitPlanMode' },
  UserPromptSubmit: {},
  Stop: {},
};

const EVENTS = Object.keys(HOOK_SPECS);
const BASE_EVENTS = ['Notification', 'PermissionRequest', 'PreToolUse', 'UserPromptSubmit'];

function load() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { p, raw: null, data: {} };
  const raw = fs.readFileSync(p, 'utf8');
  const clean = raw.replace(/^\uFEFF/, '');
  const data = clean.trim() ? JSON.parse(clean) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('~/.claude/settings.json must be a JSON object');
  }
  return { p, raw, data };
}

function backup(p, raw) {
  const d = new Date();
  const z = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  fs.writeFileSync(`${p}.agy-mascot-${stamp}.bak`, raw, 'utf8');
  const dir = path.dirname(p);
  const prefix = `${path.basename(p)}.agy-mascot-`;
  const old = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.bak')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 5))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
}

function status(port = DEFAULT_PORT) {
  try {
    const { data } = load();
    const mark = markerFor(port);
    const isOurs = h => h && typeof h.command === 'string' && h.command.includes(mark);
    const map = {};
    for (const ev of EVENTS) {
      const groups = data.hooks && Array.isArray(data.hooks[ev]) ? data.hooks[ev] : [];
      map[ev] = groups.some(g => Array.isArray(g && g.hooks) && g.hooks.some(isOurs));
    }
    return {
      installed: BASE_EVENTS.every(ev => map[ev]),
      stopHook: !!map.Stop,
      events: map,
      path: settingsPath(),
    };
  } catch {
    return {
      installed: false,
      stopHook: false,
      events: Object.fromEntries(EVENTS.map(ev => [ev, false])),
      path: settingsPath(),
    };
  }
}

function apply({ enabled = true, stopHook = true, port = DEFAULT_PORT } = {}) {
  const { p, raw, data } = load();
  const before = JSON.stringify(data);
  const mark = markerFor(port);
  const isOurs = h => h && typeof h.command === 'string' && h.command.includes(mark);

  const want = enabled ? (stopHook ? [...BASE_EVENTS, 'Stop'] : [...BASE_EVENTS]) : [];
  const hooks = data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks) ? data.hooks : {};

  for (const ev of EVENTS) {
    let groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    groups = groups.flatMap(g => {
      if (!g || !Array.isArray(g.hooks) || !g.hooks.some(isOurs)) return [g];
      const rest = g.hooks.filter(h => !isOurs(h));
      return rest.length ? [{ ...g, hooks: rest }] : [];
    });
    if (want.includes(ev)) {
      groups.push({
        ...HOOK_SPECS[ev],
        hooks: [
          {
            type: 'command',
            command: commandFor(port, ev),
            timeout: 5,
          },
        ],
      });
    }
    if (groups.length) hooks[ev] = groups;
    else delete hooks[ev];
  }

  if (Object.keys(hooks).length) data.hooks = hooks;
  else delete data.hooks;

  if (raw !== null && JSON.stringify(data) === before) return status(port);
  if (raw === null && !want.length) return status(port);

  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (raw !== null) backup(p, raw);
  const tmp = `${p}.agy-mascot-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
  return status(port);
}

module.exports = {
  DEFAULT_PORT,
  EVENTS,
  BASE_EVENTS,
  settingsPath,
  status,
  apply,
};
