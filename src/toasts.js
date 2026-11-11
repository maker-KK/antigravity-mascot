// Watches Windows Notification database (wpndatabase.db) for new toast notifications
// from Antigravity or Claude desktop apps as a supplementary signal.
const path = require('path');

const DB = process.env.MASCOT_WPNDB || path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft',
  'Windows',
  'Notifications',
  'wpndatabase.db'
);

const SQL = `
  SELECT n.Id AS id, h.PrimaryId AS primaryId
  FROM Notification n
  JOIN NotificationHandler h ON h.RecordId = n.HandlerId
  WHERE n.Type = 'toast'
    AND (
      h.PrimaryId GLOB '*Antigravity*'
      OR h.PrimaryId GLOB '*antigravity*'
      OR h.PrimaryId GLOB 'Claude_*!Claude'
      OR h.PrimaryId GLOB '*Claude*'
    )
  ORDER BY n.Id DESC
  LIMIT 1
`;

function classifySource(primaryId) {
  if (!primaryId) return null;
  if (/antigravity/i.test(primaryId) && !/mascot/i.test(primaryId)) return 'antigravity';
  if (/claude/i.test(primaryId)) return 'claude';
  return null;
}

function watch(onToast, intervalMs = 1200) {
  let db = null;
  let stmt = null;
  let lastId = null;
  let retryAt = 0;

  function open() {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB, { readOnly: true });
    stmt = db.prepare(SQL);
  }

  function close() {
    try { if (db) db.close(); } catch {}
    db = null;
    stmt = null;
  }

  function tick() {
    try {
      if (!db) {
        if (Date.now() < retryAt) return;
        open();
      }
      const row = stmt.get();
      const maxId = row ? Number(row.id || 0) : 0;
      if (lastId === null) {
        lastId = maxId; // Ignore historical notifications on startup
      } else if (maxId > lastId) {
        lastId = maxId;
        const source = classifySource(row && row.primaryId);
        if (source) onToast(source);
      }
    } catch {
      close();
      retryAt = Date.now() + 10000;
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearInterval(timer);
    close();
  };
}

module.exports = { watch, classifySource };
