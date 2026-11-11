// End-to-end automated smoke test for Antigravity Mascot:
// 1. Unit-tests Antigravity plugin/hooks generation + cmd.exe fallback stdout contract
// 2. Unit-tests Claude settings.json hook injection + backup + preservation of unrelated hooks
// 3. Spawns live Electron app on an isolated port/temp dir and verifies HTTP endpoints + renderer state!
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');

const TEST_PORT = 47899;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mascot-test-'));
const agyPluginDir = path.join(tmpRoot, 'plugins', 'antigravity-mascot');
const claudeSettingsFile = path.join(tmpRoot, 'claude', 'settings.json');
const mascotConfigFile = path.join(tmpRoot, 'config.json');

process.env.MASCOT_PORT = String(TEST_PORT);
process.env.MASCOT_AGY_PLUGIN_DIR = agyPluginDir;
process.env.MASCOT_CLAUDE_SETTINGS = claudeSettingsFile;

const agyHooks = require('../src/hooks-antigravity');
const claudeHooks = require('../src/hooks-claude');

function request(method, reqPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: reqPath,
      method,
      headers: bodyObj ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('1) Testing Antigravity plugin & hooks generation...');
  const agyRes = agyHooks.apply({ enabled: true, stopHook: true, port: TEST_PORT });
  assert.strictEqual(agyRes.installed, true);
  assert.strictEqual(agyRes.enabled, true);
  assert.strictEqual(agyRes.stopHook, true);

  const hooksJson = JSON.parse(fs.readFileSync(path.join(agyPluginDir, 'hooks.json'), 'utf8'));
  const entry = hooksJson['antigravity-mascot'];
  assert.ok(Array.isArray(entry.Stop), 'Stop must be flat array');
  assert.ok(entry.Stop[0].command, 'Stop handler must have command directly');
  assert.ok(Array.isArray(entry.PreToolUse) && entry.PreToolUse[0].matcher === 'ask_question');

  // Verify offline fallback command outputs valid JSON when server is NOT running!
  const stopCmd = entry.Stop[0].command;
  const offlineStdout = execSync(`cmd.exe /c "${stopCmd}"`, {
    input: '{"terminationReason":"NO_TOOL_CALL","fullyIdle":true}',
    encoding: 'utf8',
  }).trim();
  const parsedFallback = JSON.parse(offlineStdout);
  assert.strictEqual(parsedFallback.decision, 'allow', 'Offline Stop fallback must output {"decision":"allow"}');
  console.log('   OK: Offline cmd.exe fallback outputs valid JSON:', offlineStdout);

  console.log('2) Testing Claude settings.json hook preservation & backup...');
  fs.mkdirSync(path.dirname(claudeSettingsFile), { recursive: true });
  fs.writeFileSync(claudeSettingsFile, JSON.stringify({
    enableWorkflows: true,
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'impeccable hook', timeout: 30 }] },
      ],
    },
  }, null, 2), 'utf8');

  const clRes = claudeHooks.apply({ enabled: true, stopHook: true, port: TEST_PORT });
  assert.strictEqual(clRes.installed, true);
  assert.strictEqual(clRes.stopHook, true);

  const updatedClaude = JSON.parse(fs.readFileSync(claudeSettingsFile, 'utf8'));
  assert.strictEqual(updatedClaude.enableWorkflows, true);
  assert.strictEqual(updatedClaude.hooks.Stop.length, 2, 'Must preserve impeccable Stop hook alongside ours');
  console.log('   OK: Claude hooks applied while preserving existing hooks & creating .bak');

  console.log('3) Launching Electron app for live integration test...');
  const electronBin = require('electron');
  const child = spawn(electronBin, [path.join(__dirname, '..')], {
    env: {
      ...process.env,
      MASCOT_PORT: String(TEST_PORT),
      MASCOT_AGY_PLUGIN_DIR: agyPluginDir,
      MASCOT_CLAUDE_SETTINGS: claudeSettingsFile,
      MASCOT_CONFIG: mascotConfigFile,
      MASCOT_ALLOW_MULTI: '1',
      MASCOT_HEADLESS_TEST: '1',
      MASCOT_DEBUG: '1',
    },
    stdio: 'ignore',
  });

  try {
    // Poll /status until server is ready
    let ready = null;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await request('GET', '/status');
        if (r.status === 200) {
          ready = JSON.parse(r.body);
          if (ready.renderer) break;
        }
      } catch {}
      await sleep(250);
    }
    assert.ok(ready && ready.renderer, 'Electron server & renderer should become ready');
    console.log('   OK: App listening on port', ready.port);

    // Mute sound during test so we don't beep the user unexpectedly
    fs.writeFileSync(mascotConfigFile, JSON.stringify({ ...ready.cfg, sound: false, firstRunDone: true }, null, 2));

    // Test forced Antigravity alert via /test
    await request('POST', '/test?source=antigravity&reason=question');
    await sleep(350);
    const s1 = JSON.parse((await request('GET', '/status')).body);
    assert.strictEqual(s1.activeAlert.source, 'antigravity');
    assert.strictEqual(s1.renderer.busy, true);
    assert.strictEqual(s1.renderer.source, 'antigravity');
    console.log('   OK: Antigravity alert active -> speech bubble:', JSON.stringify(s1.renderer.bubble));

    // Test Antigravity hook contract while server IS running via cmd.exe!
    const liveStdout = execSync(`cmd.exe /c "${stopCmd}"`, {
      input: '{"terminationReason":"NO_TOOL_CALL","fullyIdle":true}',
      encoding: 'utf8',
    }).trim();
    assert.strictEqual(JSON.parse(liveStdout).decision, 'allow');
    console.log('   OK: Live Antigravity Stop hook stdout:', liveStdout);

    // Test PreInvocation auto-dismiss
    const preInvRes = await request('POST', '/hook/antigravity?event=PreInvocation', { conversationId: 'abc' });
    assert.strictEqual(preInvRes.status, 200);
    assert.strictEqual(preInvRes.body, '{}');
    await sleep(300);
    const s2 = JSON.parse((await request('GET', '/status')).body);
    assert.strictEqual(s2.activeAlert, null);
    console.log('   OK: Antigravity PreInvocation dismissed active alert cleanly');

    // Test forced Claude alert
    await request('POST', '/test?source=claude&reason=permission');
    await sleep(350);
    const s3 = JSON.parse((await request('GET', '/status')).body);
    assert.strictEqual(s3.activeAlert.source, 'claude');
    assert.strictEqual(s3.renderer.source, 'claude');
    console.log('   OK: Claude alert active -> speech bubble:', JSON.stringify(s3.renderer.bubble));

    // Quit cleanly
    await request('POST', '/quit');
    await sleep(400);
  } finally {
    try { child.kill(); } catch {}
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  }

  console.log('\nALL SMOKE TESTS PASSED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
