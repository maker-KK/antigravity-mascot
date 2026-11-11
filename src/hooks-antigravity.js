// Manages the global Antigravity plugin & lifecycle hooks at:
//   ~/.gemini/config/plugins/antigravity-mascot/
// Follows Antigravity's exact hooks.json & plugin.json specification:
// - PreToolUse / PostToolUse: grouped with { matcher, hooks: [...] }
// - PreInvocation / Stop: flat list of command handler objects
// - Always outputs valid JSON on stdout even when Mascot is closed!
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = +process.env.MASCOT_PORT || 47822;
const PLUGIN_DIR_NAME = 'antigravity-mascot';

function pluginDir() {
  return process.env.MASCOT_AGY_PLUGIN_DIR || path.join(os.homedir(), '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
}

function hooksPath() {
  return path.join(pluginDir(), 'hooks.json');
}

function manifestPath() {
  return path.join(pluginDir(), 'plugin.json');
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#0EA5E9"/>
    </linearGradient>
  </defs>
  <rect x="14" y="14" width="100" height="100" rx="28" fill="url(#bg)"/>
  <line x1="64" y1="22" x2="64" y2="34" stroke="#E0F2FE" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="19" r="6" fill="#38BDF8"/>
  <rect x="30" y="34" width="68" height="62" rx="26" fill="#F8FAFC"/>
  <rect x="38" y="45" width="52" height="34" rx="15" fill="#0F172A"/>
  <circle cx="52" cy="61" r="5.5" fill="#38BDF8"/>
  <circle cx="76" cy="61" r="5.5" fill="#38BDF8"/>
  <circle cx="54" cy="59" r="2" fill="#FFFFFF"/>
  <circle cx="78" cy="59" r="2" fill="#FFFFFF"/>
  <path d="M57 71 Q64 76 71 71" fill="none" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

const PLUGIN_README = `# Antigravity Mascot Plugin

Connects Antigravity lifecycle events (\`Stop\`, \`PreToolUse: ask_question\`, \`PostToolUse\`, \`PreInvocation\`) to the **Antigravity Mascot** Windows taskbar companion over \`127.0.0.1:${DEFAULT_PORT}\`.

When the desktop mascot app is closed, all hook commands fall back cleanly in milliseconds without interrupting your session.
`;

function buildCmd(port, event, fallbackJson) {
  const url = `http://127.0.0.1:${port}/hook/antigravity?event=${event}`;
  return `curl.exe -s -f --connect-timeout 1 -m 2 -H "Content-Type: application/json" --data-binary @- "${url}" || echo ${fallbackJson}`;
}

function buildHooksObject({ enabled = true, stopHook = true, port = DEFAULT_PORT } = {}) {
  const entry = {
    enabled: !!enabled,
    PreInvocation: [
      {
        type: 'command',
        command: buildCmd(port, 'PreInvocation', '{}'),
        timeout: 5,
      },
    ],
    PreToolUse: [
      {
        matcher: 'ask_question',
        hooks: [
          {
            type: 'command',
            command: buildCmd(port, 'PreToolUse', '{"decision":"allow"}'),
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'ask_question',
        hooks: [
          {
            type: 'command',
            command: buildCmd(port, 'PostToolUse', '{}'),
            timeout: 5,
          },
        ],
      },
    ],
  };

  if (stopHook) {
    entry.Stop = [
      {
        type: 'command',
        command: buildCmd(port, 'Stop', '{"decision":"allow"}'),
        timeout: 5,
      },
    ];
  }

  return {
    'antigravity-mascot': entry,
  };
}

function buildManifest() {
  return {
    name: 'antigravity-mascot',
    displayName: 'Antigravity Mascot',
    version: '1.0.0',
    description: 'Animated zero-gravity astronaut mascot on your Windows taskbar that alerts you when Antigravity finishes work or asks a question.',
    logo: 'assets/logo.svg',
    author: {
      name: 'maker-KK',
      url: 'https://github.com/maker-KK/antigravity-mascot',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/maker-KK/antigravity-mascot.git',
    },
    suggestedPrompts: [
      'Show Antigravity Mascot plugin details',
      'Ask me a sample multiple-choice question to test the mascot',
      'Explain how Antigravity Mascot hooks work',
    ],
  };
}

function status(port = DEFAULT_PORT) {
  try {
    const hp = hooksPath();
    const mp = manifestPath();
    if (!fs.existsSync(hp) || !fs.existsSync(mp)) {
      return { installed: false, enabled: false, stopHook: false, path: pluginDir() };
    }
    const hooksData = JSON.parse(fs.readFileSync(hp, 'utf8'));
    const h = hooksData && hooksData['antigravity-mascot'];
    if (!h) return { installed: false, enabled: false, stopHook: false, path: pluginDir() };
    const mark = `127.0.0.1:${port}/hook/antigravity`;
    const hasAsk = Array.isArray(h.PreToolUse) && JSON.stringify(h.PreToolUse).includes(mark);
    const hasStop = Array.isArray(h.Stop) && JSON.stringify(h.Stop).includes(mark);
    return {
      installed: hasAsk,
      enabled: h.enabled !== false && hasAsk,
      stopHook: hasStop,
      path: pluginDir(),
    };
  } catch {
    return { installed: false, enabled: false, stopHook: false, path: pluginDir() };
  }
}

function apply({ enabled = true, stopHook = true, port = DEFAULT_PORT } = {}) {
  const dir = pluginDir();
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const mp = manifestPath();
  const hp = hooksPath();
  const lp = path.join(assetsDir, 'logo.svg');
  const rp = path.join(dir, 'README.md');

  fs.writeFileSync(mp, JSON.stringify(buildManifest(), null, 2) + '\n', 'utf8');
  fs.writeFileSync(lp, LOGO_SVG, 'utf8');
  if (!fs.existsSync(rp)) fs.writeFileSync(rp, PLUGIN_README, 'utf8');

  const hooksObj = buildHooksObject({ enabled, stopHook, port });
  const tmp = `${hp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(hooksObj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, hp);
  return status(port);
}

module.exports = {
  DEFAULT_PORT,
  PLUGIN_DIR_NAME,
  pluginDir,
  hooksPath,
  status,
  apply,
  buildHooksObject,
};
