// Generates crisp multi-resolution Windows .ico and .png assets using Electron's Chromium canvas.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

function packIco(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type 1 = ICO
  header.writeUInt16LE(count, 4); // Image count

  const dirEntries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  pngBuffersWithSizes.forEach(({ size, buf }, i) => {
    const base = i * 16;
    dirEntries.writeUInt8(size >= 256 ? 0 : size, base + 0); // Width (0 = 256)
    dirEntries.writeUInt8(size >= 256 ? 0 : size, base + 1); // Height (0 = 256)
    dirEntries.writeUInt8(0, base + 2);                      // Palette
    dirEntries.writeUInt8(0, base + 3);                      // Reserved
    dirEntries.writeUInt16LE(1, base + 4);                   // Color planes
    dirEntries.writeUInt16LE(32, base + 6);                  // Bits per pixel
    dirEntries.writeUInt32LE(buf.length, base + 8);          // Image byte size
    dirEntries.writeUInt32LE(offset, base + 12);             // Offset
    offset += buf.length;
  });

  return Buffer.concat([header, dirEntries, ...pngBuffersWithSizes.map(x => x.buf)]);
}

const RENDER_HTML = `<!doctype html><html><body style="margin:0;background:transparent">
<script>
function drawAstronaut(size, variant) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const s = v => (v / 128) * size;

  const rrect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(s(x), s(y), s(w), s(h), s(r));
    ctx.closePath();
  };

  if (variant === 'app') {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#312E81');
    grad.addColorStop(0.55, '#1D4ED8');
    grad.addColorStop(1, '#0284C7');
    rrect(8, 8, 112, 112, 28);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Antenna stem
  ctx.strokeStyle = variant === 'ping' ? '#FDBA74' : '#BAE6FD';
  ctx.lineWidth = Math.max(1.5, s(6));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s(64), s(14));
  ctx.lineTo(s(64), s(30));
  ctx.stroke();

  // Antenna beacon
  ctx.beginPath();
  ctx.arc(s(64), s(13), s(9), 0, Math.PI * 2);
  ctx.fillStyle = variant === 'ping' ? '#F97316' : '#38BDF8';
  ctx.fill();

  // Helmet outer shell
  rrect(20, 28, 88, 78, 34);
  ctx.fillStyle = '#CBD5E1';
  ctx.fill();

  rrect(22, 26, 84, 73, 32);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();

  // Dark visor
  rrect(32, 40, 64, 46, 20);
  ctx.fillStyle = '#0F172A';
  ctx.fill();

  // Glowing eyes
  const eyeColor = variant === 'ping' ? '#FB923C' : '#38BDF8';
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(s(50), s(62), s(7.5), 0, Math.PI * 2);
  ctx.arc(s(78), s(62), s(7.5), 0, Math.PI * 2);
  ctx.fill();

  // Eye highlights
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(s(52.5), s(59.5), s(2.6), 0, Math.PI * 2);
  ctx.arc(s(80.5), s(59.5), s(2.6), 0, Math.PI * 2);
  ctx.fill();

  // Notification ping badge on tray-ping
  if (variant === 'ping') {
    ctx.beginPath();
    ctx.arc(s(100), s(28), s(20), 0, Math.PI * 2);
    ctx.fillStyle = '#EF4444';
    ctx.fill();
    ctx.lineWidth = Math.max(1, s(4));
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }

  return c.toDataURL('image/png').split(',')[1];
}
window.drawAstronaut = drawAstronaut;
</script></body></html>`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#312E81"/>
      <stop offset="55%" stop-color="#1D4ED8"/>
      <stop offset="100%" stop-color="#0284C7"/>
    </linearGradient>
  </defs>
  <rect x="12" y="12" width="104" height="104" rx="28" fill="url(#bg)"/>
  <line x1="64" y1="20" x2="64" y2="34" stroke="#BAE6FD" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="18" r="7" fill="#38BDF8"/>
  <rect x="28" y="34" width="72" height="64" rx="28" fill="#F8FAFC"/>
  <rect x="36" y="45" width="56" height="36" rx="16" fill="#0F172A"/>
  <circle cx="52" cy="63" r="6" fill="#38BDF8"/>
  <circle cx="76" cy="63" r="6" fill="#38BDF8"/>
  <circle cx="54" cy="60.5" r="2.2" fill="#FFFFFF"/>
  <circle cx="78" cy="60.5" r="2.2" fill="#FFFFFF"/>
  <path d="M57 73 Q64 78 71 73" fill="none" stroke="#38BDF8" stroke-width="3" stroke-linecap="round"/>
</svg>
`;

app.whenReady().then(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  const win = new BrowserWindow({
    show: false,
    width: 300,
    height: 300,
    webPreferences: { offscreen: true },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(RENDER_HTML)}`);

  async function renderVariant(variant, sizes) {
    const items = [];
    for (const sz of sizes) {
      const b64 = await win.webContents.executeJavaScript(`window.drawAstronaut(${sz}, ${JSON.stringify(variant)})`);
      items.push({ size: sz, buf: Buffer.from(b64, 'base64') });
    }
    return items;
  }

  const appFrames = await renderVariant('app', [16, 32, 48, 64, 128, 256]);
  const trayNormalFrames = await renderVariant('normal', [16, 24, 32, 48]);
  const trayPingFrames = await renderVariant('ping', [16, 24, 32, 48]);

  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), packIco(appFrames));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), appFrames.find(f => f.size === 256).buf);
  fs.writeFileSync(path.join(ASSETS, 'tray.ico'), packIco(trayNormalFrames));
  fs.writeFileSync(path.join(ASSETS, 'tray-ping.ico'), packIco(trayPingFrames));
  fs.writeFileSync(path.join(ASSETS, 'logo.svg'), LOGO_SVG, 'utf8');

  console.log('Generated icons in assets/:', fs.readdirSync(ASSETS).join(', '));
  app.quit();
});
