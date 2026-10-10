'use strict';

/* ================= Hằng số ================= */
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const MIN = -12, MAX = 12, STEP = 0.5;
const WS_URL = 'ws://127.0.0.1:8765';
const EMBED_URL = 'http://127.0.0.1:8766/';
const LS_KEY = 'q14.state.v1';
const NATIVE = window.EQoNative || null;   // cầu nối từ app Android (nếu chạy trong app)

const PRESETS = {
  'Neutral':       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Vocal Clear':   [-4, -3, -2, -1, 0, 1, 3, 4, 2, 0],
  'V-pop Ballad':  [1, 2, 2, 1, 0, 1, 2, 3, 3, 2],
  'Bass Moderate': [4, 4, 3, 1, 0, 0, 0, 0, 1, 1],
  'Bass Boost':    [7, 6, 5, 2, 0, 0, 0, 0, 0, 0],
  'Treble Boost':  [0, 0, 0, 0, 0, 1, 2, 4, 6, 7],
  'Loudness':      [6, 4, 1, 0, -1, 0, -1, 0, 3, 5],
  'Rock':          [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  'Pop':           [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'Hip-hop':       [6, 5, 3, 3, -1, -1, 1, -1, 2, 3],
  'EDM':           [6, 5, 2, 0, -2, 0, 1, 3, 5, 6],
  'Jazz':          [3, 2, 1, 2, -2, -2, 0, 1, 2, 3],
  'Classical':     [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  'Acoustic':      [4, 4, 3, 1, 2, 2, 3, 3, 3, 2],
  'Podcast':       [-6, -5, -3, 0, 2, 3, 3, 2, -1, -3],
};
const DEVICE_KEYS = ['speaker', 'wired', 'bluetooth'];
const DEVICE_LABEL = { speaker: 'Loa ngoài', wired: 'Tai nghe có dây', bluetooth: 'Bluetooth' };
const SELECT_ID = { speaker: 'autoSpeaker', wired: 'autoWired', bluetooth: 'autoBt' };
const SWATCHES = ['#37d6c4', '#6c8cff', '#ff6b9d', '#ffb347', '#a78bfa', '#4ade80', '#f87171', '#38bdf8'];
const BGS = {
  dark:     { bg: '#0b0e14', card: '#131824', card2: '#1a2132', line: '#262f45' },
  amoled:   { bg: '#000000', card: '#0b0b0d', card2: '#151518', line: '#26262b' },
  midnight: { bg: '#0a1020', card: '#101a30', card2: '#17233f', line: '#25365c' },
};

const $ = (id) => document.getElementById(id);
const state = {
  enabled: true,
  headroom: true,
  gains: Array(10).fill(0),
  custom: {},
  mode: 'global',
  engine: 'auto',
  preamp: 0, bass: 0, virt: 0, loud: 0,
  autostart: false,
  showNow: true,
  autoOn: false,
  autoMap: { speaker: null, wired: null, bluetooth: null },
  lastAutoSeq: 0,
  theme: { accent: '#37d6c4', bg: 'dark', radius: 10 },
};

/* ================= Lưu / nạp ================= */
function num(v, lo, hi, def) {
  const n = Number(v);
  return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
}
function clampGain(g) {
  g = Number(g); if (!isFinite(g)) g = 0;
  return Math.max(MIN, Math.min(MAX, Math.round(g / STEP) * STEP));
}
function fmt(g) { return (g > 0 ? '+' : '') + g.toFixed(1); }

function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { /* bỏ qua */ }
  if (!s || typeof s !== 'object') return;
  if (Array.isArray(s.gains) && s.gains.length === 10) state.gains = s.gains.map(clampGain);
  ['enabled', 'headroom', 'autoOn', 'autostart', 'showNow'].forEach((k) => { if (typeof s[k] === 'boolean') state[k] = s[k]; });
  if (s.custom && typeof s.custom === 'object') state.custom = s.custom;
  if (['global', 'sessions', 'both'].includes(s.mode)) state.mode = s.mode;
  if (['auto', 'equalizer', 'dynamics'].includes(s.engine)) state.engine = s.engine;
  state.preamp = num(s.preamp, -12, 12, 0);
  state.bass = num(s.bass, 0, 100, 0);
  state.virt = num(s.virt, 0, 100, 0);
  state.loud = num(s.loud, 0, 12, 0);
  if (s.autoMap && typeof s.autoMap === 'object') {
    DEVICE_KEYS.forEach((k) => { state.autoMap[k] = typeof s.autoMap[k] === 'string' ? s.autoMap[k] : null; });
  }
  if (typeof s.lastAutoSeq === 'number') state.lastAutoSeq = s.lastAutoSeq;
  if (s.theme && typeof s.theme === 'object') {
    if (/^#[0-9a-fA-F]{6}$/.test(s.theme.accent)) state.theme.accent = s.theme.accent;
    if (BGS[s.theme.bg]) state.theme.bg = s.theme.bg;
    if ([4, 10, 16].includes(s.theme.radius)) state.theme.radius = s.theme.radius;
  }
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* bỏ qua */ }
}

function allPresets() { return Object.assign({}, PRESETS, state.custom); }
function presetGains(name) {
  const p = name ? allPresets()[name] : null;
  return Array.isArray(p) && p.length === 10 ? p : null;
}

/** Gain gửi tới bộ xử lý (web + Android): headroom rồi cộng preamp. */
function effFrom(gains) {
  const off = state.headroom ? -Math.max(0, ...gains) : 0;
  return gains.map((g) => Math.max(-24, Math.min(24, g + off + state.preamp)));
}
function effectiveGains() {
  return state.enabled ? effFrom(state.gains) : Array(10).fill(0);
}

/* ================= Chủ đề màu ================= */
const th = { accent: '#37d6c4', accent2: '#6c8cff' };

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(h, a) { const c = hexToRgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const to = (v) => ('0' + Math.round((v + m) * 255).toString(16)).slice(-2);
  return '#' + to(r) + to(g) + to(b);
}
function shiftHue(hex, deg) {
  const c = hexToRgb(hex), hsl = rgbToHsl(c[0], c[1], c[2]);
  return hslToHex(hsl[0] + deg, Math.max(0.45, hsl[1]), Math.min(0.68, Math.max(0.5, hsl[2])));
}
function luminance(hex) {
  const c = hexToRgb(hex);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

function applyTheme() {
  const t = state.theme, b = BGS[t.bg] || BGS.dark, st = document.documentElement.style;
  th.accent = t.accent; th.accent2 = shiftHue(t.accent, 45);
  st.setProperty('--bg', b.bg); st.setProperty('--card', b.card);
  st.setProperty('--card2', b.card2); st.setProperty('--line', b.line);
  st.setProperty('--accent', th.accent); st.setProperty('--accent2', th.accent2);
  st.setProperty('--on-accent', luminance(t.accent) > 0.55 ? '#06101a' : '#ffffff');
  st.setProperty('--r', t.radius + 'px');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', b.bg);
  if (NATIVE && NATIVE.setBarColor) { try { NATIVE.setBarColor(b.bg); } catch (e) { /* bỏ qua */ } }
}

/* ================= Canvas ================= */
function prep(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  return { c, w, h };
}

const CURVE_RANGE = 15;
const curveFreqs = (() => {
  const n = 180, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 20 * Math.pow(1000, i / (n - 1));
  return a;
})();

/** Đáp ứng biên độ (dB) của một bộ lọc biquad RBJ tại tần số f. */
function biquadDb(type, f0, Q, gainDb, f) {
  const fs = 48000, A = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    const al = sw / (2 * Q);
    b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A;
    a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
  } else {
    const al = (sw / 2) * Math.SQRT2, sA = 2 * Math.sqrt(A) * al;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + sA); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sA);
      a0 = (A + 1) + (A - 1) * cw + sA; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sA;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + sA); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sA);
      a0 = (A + 1) - (A - 1) * cw + sA; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sA;
    }
  }
  const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

function drawCurve() {
  const { c, w, h } = prep($('curve'));
  const padL = 26, padR = 8, padT = 8, padB = 16;
  const pw = w - padL - padR, ph = h - padT - padB;
  const xOf = (f) => padL + (Math.log(f / 20) / Math.log(1000)) * pw;
  const yOf = (db) => padT + ph / 2 - (db / CURVE_RANGE) * (ph / 2);

  c.font = '10px system-ui'; c.textBaseline = 'middle';
  [-12, -6, 0, 6, 12].forEach((db) => {
    c.strokeStyle = db === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.08)';
    c.beginPath(); c.moveTo(padL, yOf(db)); c.lineTo(w - padR, yOf(db)); c.stroke();
    c.fillStyle = '#6f7a96'; c.textAlign = 'right'; c.fillText(String(db), padL - 4, yOf(db));
  });
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  FREQS.forEach((f, i) => {
    c.strokeStyle = 'rgba(255,255,255,.05)';
    c.beginPath(); c.moveTo(xOf(f), padT); c.lineTo(xOf(f), padT + ph); c.stroke();
    if (i % 2 === 0 || w > 380) { c.fillStyle = '#6f7a96'; c.fillText(LABELS[i], xOf(f), h - 3); }
  });

  const total = new Float32Array(curveFreqs.length);
  FREQS.forEach((f0, i) => {
    const type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
    for (let k = 0; k < total.length; k++) total[k] += biquadDb(type, f0, 1.41, state.gains[i], curveFreqs[k]);
  });

  const col = state.enabled ? th.accent : '#5d6785';
  const grad = c.createLinearGradient(0, padT, 0, padT + ph);
  grad.addColorStop(0, state.enabled ? rgba(th.accent, 0.35) : 'rgba(93,103,133,.25)');
  grad.addColorStop(1, rgba(th.accent, 0));
  c.beginPath();
  total.forEach((db, i) => {
    const x = xOf(curveFreqs[i]), y = yOf(Math.max(-CURVE_RANGE, Math.min(CURVE_RANGE, db)));
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  });
  c.strokeStyle = col; c.lineWidth = 2; c.stroke();
  c.lineTo(xOf(20000), yOf(0)); c.lineTo(xOf(20), yOf(0)); c.closePath();
  c.fillStyle = grad; c.fill();
  state.gains.forEach((g, i) => {
    c.beginPath(); c.arc(xOf(FREQS[i]), yOf(g), 3.5, 0, Math.PI * 2);
    c.fillStyle = '#fff'; c.fill();
  });
}

/* ================= Thanh trượt ================= */
const bandEls = [];
function buildBands() {
  const root = $('bands');
  FREQS.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'band'; el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', LABELS[i] + ' Hz');
    el.setAttribute('aria-valuemin', MIN); el.setAttribute('aria-valuemax', MAX);
    el.innerHTML = '<div class="val"></div><div class="trk"><div class="rail"></div><div class="mid"></div><div class="fill"></div><div class="thumb"></div></div><div class="lbl"></div>';
    el.querySelector('.lbl').textContent = LABELS[i];
    const trk = el.querySelector('.trk');
    const setFromY = (clientY) => {
      const r = trk.getBoundingClientRect();
      const ratio = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      setGain(i, MIN + ratio * (MAX - MIN));
    };
    trk.addEventListener('pointerdown', (e) => { trk.setPointerCapture(e.pointerId); setFromY(e.clientY); });
    trk.addEventListener('pointermove', (e) => { if (trk.hasPointerCapture(e.pointerId)) setFromY(e.clientY); });
    el.addEventListener('dblclick', () => setGain(i, 0));
    el.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') setGain(i, state.gains[i] + STEP);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') setGain(i, state.gains[i] - STEP);
      else if (k === 'Home') setGain(i, 0);
      else return;
      e.preventDefault();
    });
    root.appendChild(el); bandEls.push(el);
  });
}
function renderBands() {
  $('bands').classList.toggle('off', !state.enabled);
  bandEls.forEach((el, i) => {
    const g = state.gains[i], pct = ((g - MIN) / (MAX - MIN)) * 100;
    el.querySelector('.val').textContent = fmt(g);
    el.querySelector('.thumb').style.top = (100 - pct) + '%';
    const fill = el.querySelector('.fill');
    fill.style.top = (g >= 0 ? 100 - pct : 50) + '%';
    fill.style.height = Math.abs(pct - 50) + '%';
    el.setAttribute('aria-valuenow', g);
    el.setAttribute('aria-valuetext', fmt(g) + ' dB');
  });
}

/* ================= Preset ================= */
function sameGains(a, b) { return a.every((v, i) => Math.abs(v - b[i]) < 1e-6); }
function renderPresets() {
  const root = $('presets'); root.replaceChildren();
  const add = (name, gains, deletable) => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (sameGains(state.gains, gains) ? ' active' : '');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'main'; b.textContent = name;
    b.addEventListener('click', () => { state.gains = gains.map(clampGain); changed(); });
    chip.appendChild(b);
    if (deletable) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.title = 'Xoá cấu hình';
      x.addEventListener('click', () => {
        if (confirm('Xoá cấu hình "' + name + '"?')) {
          delete state.custom[name];
          DEVICE_KEYS.forEach((k) => { if (state.autoMap[k] === name) state.autoMap[k] = null; });
          saveState(); renderPresets(); fillAutoSelects(); scheduleSend();
        }
      });
      chip.appendChild(x);
    }
    root.appendChild(chip);
  };
  Object.entries(PRESETS).forEach(([n, g]) => add(n, g, false));
  Object.entries(state.custom).forEach(([n, g]) => add(n, g, true));
}

/* ================= Luồng thay đổi chung ================= */
function setGain(i, g) {
  g = clampGain(g);
  if (g === state.gains[i]) return;
  state.gains[i] = g; changed();
}
function changed() {
  renderBands(); renderPresets();
  $('eqOn').checked = state.enabled; $('eqOnText').textContent = state.enabled ? 'BẬT' : 'TẮT';
  drawCurve(); updateAudio(); saveState(); scheduleSend(); renderLink();
}

/* ================= Kết nối app Android ================= */
const link = { state: 'offline', status: null, lastStatusAt: 0, first: false };
let ws = null, retryTimer = 0, sendTimer = 0, retryDelay = 1500;

function wsSend(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function scheduleSend() { clearTimeout(sendTimer); sendTimer = setTimeout(pushAll, 40); }
function pushAll() { pushEq(); pushFx(); pushAuto(); }
function pushEq() { wsSend({ type: 'setEq', enabled: state.enabled, gains: effectiveGains() }); }
function pushFx() { wsSend({ type: 'fx', bass: state.bass, virt: state.virt, loud: state.loud }); }
function pushAuto() {
  const profiles = {};
  DEVICE_KEYS.forEach((k) => {
    const g = presetGains(state.autoMap[k]);
    profiles[k] = g ? effFrom(g.map(clampGain)) : null;
  });
  wsSend({ type: 'auto', enabled: state.autoOn, profiles });
}
function pushConfig() { wsSend({ type: 'config', mode: state.mode, engine: state.engine, autostart: state.autostart }); }

/** Nếu app Android vừa tự đổi preset theo thiết bị (khi web đóng hoặc đang mở) thì web theo. */
function handleAutoSeq(m) {
  const a = m.auto;
  if (!a || !a.seq || a.seq === state.lastAutoSeq) return;
  state.lastAutoSeq = a.seq;
  const g = a.applied ? presetGains(state.autoMap[a.applied]) : null;
  if (g) { state.gains = g.map(clampGain); changed(); } else { saveState(); }
}

function connect() {
  if (ws && ws.readyState <= 1) return;
  clearTimeout(retryTimer);
  link.state = 'connecting'; renderLink();
  try { ws = new WebSocket(WS_URL); } catch (e) { failed(); return; }
  ws.onopen = () => {
    link.state = 'online'; link.status = null; link.first = true; retryDelay = 1500;
    wsSend({ type: 'hello', client: 'q14-web', protocol: 2 });
    pushConfig(); wsSend({ type: 'getStatus' });
    renderLink();
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (!m || m.type !== 'status') return;
    link.status = m; link.lastStatusAt = Date.now();
    handleAutoSeq(m);
    if (link.first) { link.first = false; pushAll(); }
    renderLink(); renderDiag(); renderFxStatus();
  };
  ws.onclose = failed;
  ws.onerror = () => { /* onclose sẽ xử lý */ };
}
function failed() {
  link.state = 'offline'; link.status = null; ws = null;
  renderLink(); renderDiag(); renderFxStatus();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 1.5, 10000);
}
setInterval(() => {
  if (link.state !== 'online') return;
  wsSend({ type: 'getStatus' });
  if (link.lastStatusAt && Date.now() - link.lastStatusAt > 15000 && ws) ws.close();
}, 4000);

function renderLink() {
  renderIsland();
  const pill = $('linkPill'), b = $('banner');
  b.replaceChildren();
  const add = (t) => { const p = document.createElement('p'); p.textContent = t; b.appendChild(p); return p; };
  const embedded = location.origin === 'http://127.0.0.1:8766';

  if (link.state !== 'online') {
    pill.className = 'pill offline';
    pill.textContent = link.state === 'connecting' ? 'Đang kết nối…' : 'Chưa kết nối';
    b.className = 'banner warn';
    add('Chưa kết nối với phần Android của EQo. nên EQ chưa tác động lên âm thanh nào trên máy (TikTok, YouTube, Roblox...).');
    add('Mở app EQo trên điện thoại để dịch vụ EQ tự bật. Nếu Chrome hỏi quyền truy cập thiết bị trong mạng cục bộ, hãy chọn Cho phép.');
    if (!embedded) {
      const p = add('Nếu vẫn không kết nối được, mở bản nhúng trong app: ');
      const a = document.createElement('a'); a.href = EMBED_URL; a.textContent = EMBED_URL; p.appendChild(a);
    }
    return;
  }

  const s = link.status;
  if (!s) {
    pill.className = 'pill ok'; pill.textContent = 'Đã kết nối';
    b.className = 'banner info'; add('Đã kết nối app, đang đọc trạng thái…');
    return;
  }
  const g = s.global || {};
  const sess = Array.isArray(s.sessions) ? s.sessions : [];
  const okSess = sess.filter((x) => x.ok);
  const anyOk = g.state === 'ok' || okSess.length > 0;

  if (!anyOk) {
    pill.className = 'pill err'; pill.textContent = 'Chưa áp dụng';
    b.className = 'banner err';
    add('App đã kết nối nhưng CHƯA tạo được hiệu ứng EQ hệ thống, nên EQ chưa áp dụng ngoài app.');
    if (g.state === 'error' && g.message) add('Lý do (toàn cục): ' + g.message);
    if (s.mode !== 'global' && sess.length === 0) add('Chưa có ứng dụng nào mở phiên hiệu ứng âm thanh (nhiều ứng dụng như TikTok, Roblox có thể không gửi tín hiệu này).');
    add('Thử đổi "Phạm vi áp dụng" hoặc "Bộ xử lý" trong Cài đặt → Hệ thống.');
    return;
  }
  pill.className = 'pill ok'; pill.textContent = 'Đã gửi tới app';
  b.className = 'banner ok';
  const parts = [];
  if (g.state === 'ok') parts.push('toàn cục (' + g.kind + ')');
  if (okSess.length) parts.push(okSess.length + ' phiên ứng dụng');
  add('App đã nhận EQ và khởi tạo hiệu ứng: ' + parts.join(' + ') + '.');
  add('Lưu ý: tạo hiệu ứng thành công chưa chứng minh âm thanh của ứng dụng khác thật sự bị tác động. Hãy nghe thử bằng cách bật/tắt EQ khi phát nhạc.');
  if (!state.enabled) add('EQ đang TẮT: app nhận đường phẳng (0 dB).');
}

function fxLine(name, f) {
  if (!f) return name + ': ?';
  return name + ': ' + (f.ok ? 'hoạt động' : 'không dùng được (' + (f.message || '?') + ')');
}
function renderFxStatus() {
  renderNowStatus();
  const el = $('fxStatus'), s = link.status;
  if (link.state !== 'online' || !s || !s.fx) {
    el.textContent = 'Các hiệu ứng này do Android xử lý và máy có thể không hỗ trợ. Trạng thái sẽ hiện ở đây khi đã kết nối.';
  } else {
    el.textContent = fxLine('Bass Boost', s.fx.bass) + ' · ' + fxLine('Vòm', s.fx.virt) + ' · ' + fxLine('Loudness', s.fx.loud);
  }
  const an = $('autoNow');
  if (link.state === 'online' && s && s.auto && s.auto.key) {
    an.textContent = 'Đang phát qua: ' + (DEVICE_LABEL[s.auto.key] || s.auto.key) + '. Preset đổi khi bạn cắm/ngắt thiết bị.';
  } else {
    an.textContent = 'Chưa kết nối app.';
  }
}

function renderDiag() {
  const el = $('diag'), s = link.status;
  if (link.state !== 'online' || !s) { el.textContent = 'Chưa kết nối app.'; return; }
  const L = [];
  const d = s.device || {};
  L.push('Thiết bị: ' + (d.model || '?') + ' · Android ' + (d.release || '?') + ' (API ' + (d.sdk || '?') + ')');
  L.push('Chế độ: ' + s.mode + ' · Bộ xử lý ưu tiên: ' + s.enginePref);
  const g = s.global || {};
  L.push('Toàn cục (session 0): ' + (g.state || '-') + (g.kind ? ' [' + g.kind + ']' : '') + (g.message ? ' — ' + g.message : ''));
  if (g.bands) L.push('  Số băng phần cứng: ' + g.bands + (g.rangeDb ? ' · dải ' + g.rangeDb : ''));
  const sess = s.sessions || [];
  L.push('Phiên ứng dụng thấy được: ' + sess.length);
  sess.forEach((x) => L.push('  • ' + (x.pkg || '?') + ' #' + x.id + ' → ' + (x.ok ? 'ok [' + x.kind + ']' : 'lỗi: ' + (x.message || '?'))));
  if (s.fx) L.push(fxLine('Bass Boost', s.fx.bass) + '\n' + fxLine('Vòm', s.fx.virt) + '\n' + fxLine('Loudness', s.fx.loud));
  if (Array.isArray(d.effects)) L.push('Hiệu ứng có trên máy: ' + (d.effects.join('; ') || '(không)'));
  el.textContent = L.join('\n');
}

/* ================= Viên thuốc bật/tắt & bài đang phát ================= */
const APP_NAMES = {
  'com.google.android.youtube': 'YouTube',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.spotify.music': 'Spotify',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.ss.android.ugc.trill': 'TikTok',
  'com.zing.mp3': 'Zing MP3',
  'ht.nct': 'NhacCuaTui',
  'com.soundcloud.android': 'SoundCloud',
  'com.roblox.client': 'Roblox',
  'com.android.chrome': 'Chrome',
  'org.mozilla.firefox': 'Firefox',
  'com.brave.browser': 'Brave',
};
function appName(pkg) { return APP_NAMES[pkg] || (pkg ? String(pkg).split('.').pop() : ''); }
function presetLabel() {
  const all = allPresets();
  for (const n of Object.keys(all)) {
    const g = all[n];
    if (Array.isArray(g) && g.length === 10 && sameGains(state.gains, g)) return n;
  }
  return 'Tuỳ chỉnh';
}
function nowInfo() {
  const s = link.status;
  return link.state === 'online' && s && s.now ? s.now : null;
}
function currentSong() {
  const n = nowInfo();
  return state.showNow && n && n.access && (n.title || n.artist) ? n : null;
}
function renderIsland() {
  const el = $('island'), now = currentSong(), on = state.enabled, n = nowInfo();
  el.classList.toggle('on', on);
  el.classList.toggle('offline', link.state !== 'online');
  el.classList.toggle('song', !!now);
  el.classList.toggle('playing', !!(now && now.playing));
  $('islPower').setAttribute('aria-checked', String(on));
  $('islL1').textContent = now ? (now.title || now.artist) : presetLabel();
  $('islL2').textContent = now ? [now.title ? now.artist : '', now.app || appName(now.pkg)].filter(Boolean).join(' · ') : '';
  $('islSt').textContent = on ? 'BẬT' : 'TẮT';
  $('islSong').textContent = now ? (now.title || now.artist) : 'Chưa có bài đang phát';
  $('islArtist').textContent = now ? (now.title ? now.artist : '') : '';
  $('islApp').textContent = now ? (now.app || appName(now.pkg)) : '';
  $('islPerm').hidden = !(state.showNow && n && n.access === false);
}
function renderNowStatus() {
  const el = $('nowStatus'), n = nowInfo();
  if (!n) { el.textContent = 'Chưa kết nối app.'; return; }
  if (!n.access) {
    el.textContent = 'Chưa có quyền đọc bài đang phát. Bấm nút bên dưới, tìm EQo trong danh sách và bật "Cho phép truy cập thông báo".';
  } else if (n.title || n.artist) {
    el.textContent = 'Đang thấy: ' + (n.title || '?') + (n.artist ? ' — ' + n.artist : '') + ' (' + (n.app || appName(n.pkg)) + ')';
  } else {
    el.textContent = 'Đã có quyền. Chưa thấy ứng dụng nào công bố bài hát (TikTok, Roblox... thường không công bố).';
  }
}
function toggleEq() { state.enabled = !state.enabled; changed(); }
function bindIsland() {
  const isl = $('island');
  $('islPower').addEventListener('click', toggleEq);
  $('islMore').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !isl.classList.contains('open');
    isl.classList.toggle('open', open);
    $('islMore').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (isl.classList.contains('open') && !isl.contains(e.target)) {
      isl.classList.remove('open'); $('islMore').setAttribute('aria-expanded', 'false');
    }
  });
  [['islPrev', 'prev'], ['islPlay', 'toggle'], ['islNext', 'next']].forEach(([id, cmd]) => {
    $(id).addEventListener('click', () => wsSend({ type: 'media', cmd }));
  });
}

/* ================= Kiểm thử trong app (Web Audio, tạo lười) ================= */
let actx = null, chain = null, analyser = null, noiseNode = null, specRaf = 0;
function ensureAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  actx = new AC();
  chain = FREQS.map((f, i) => {
    const b = actx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
    b.frequency.value = f; b.Q.value = 1.41; return b;
  });
  for (let i = 0; i < 9; i++) chain[i].connect(chain[i + 1]);
  analyser = actx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
  chain[9].connect(analyser); analyser.connect(actx.destination);
  const src = actx.createMediaElementSource($('player'));
  src.connect(chain[0]);
  updateAudio();
  return true;
}
function updateAudio() {
  if (!chain) return;
  const g = effectiveGains();
  chain.forEach((b, i) => { b.gain.value = g[i]; });
}
function toggleNoise() {
  if (!ensureAudio()) return;
  if (noiseNode) { noiseNode.stop(); noiseNode.disconnect(); noiseNode = null; $('btnNoise').textContent = 'Phát nhiễu hồng'; return; }
  const len = actx.sampleRate * 4, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.08; b6 = w * 0.115926;
  }
  noiseNode = actx.createBufferSource(); noiseNode.buffer = buf; noiseNode.loop = true;
  noiseNode.connect(chain[0]); noiseNode.start();
  $('btnNoise').textContent = 'Dừng nhiễu hồng';
  startSpectrum();
}
function clearSpectrum() {
  cancelAnimationFrame(specRaf); specRaf = 0;
  const cv = $('spectrum'); if (cv && cv.clientWidth) prep(cv);
}
function startSpectrum() {
  if (specRaf || !analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    const cv = $('spectrum');
    if (!analyser || !cv.clientWidth || $('testCard').open === false) { specRaf = 0; return; }
    const { c, w, h } = prep(cv);
    analyser.getByteFrequencyData(data);
    const nyq = actx.sampleRate / 2, n = 64;
    c.fillStyle = th.accent;
    for (let i = 0; i < n; i++) {
      const f0 = 20 * Math.pow(1000, i / n), f1 = 20 * Math.pow(1000, (i + 1) / n);
      const k0 = Math.floor(f0 / nyq * data.length), k1 = Math.max(k0 + 1, Math.floor(f1 / nyq * data.length));
      let m = 0; for (let k = k0; k < k1 && k < data.length; k++) m = Math.max(m, data[k]);
      const bh = (m / 255) * h;
      c.fillRect(i * (w / n) + 1, h - bh, w / n - 2, bh);
    }
    specRaf = requestAnimationFrame(loop);
  };
  specRaf = requestAnimationFrame(loop);
}
function bindTest() {
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const p = $('player'); if (p.dataset.url) URL.revokeObjectURL(p.dataset.url);
    p.dataset.url = URL.createObjectURL(f); p.src = p.dataset.url;
  });
  $('player').addEventListener('play', () => { if (ensureAudio()) startSpectrum(); });
  $('btnNoise').addEventListener('click', toggleNoise);
  $('testCard').addEventListener('toggle', () => { if ($('testCard').open) startSpectrum(); else clearSpectrum(); });
}

/* ================= Cài đặt ================= */
function openSheet() {
  if (!$('sheet').hidden) return;
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  try { history.pushState({ sheet: 1 }, ''); } catch (e) { /* bỏ qua */ }
}
function hideSheet() {
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}

function segSync(id, value) {
  document.querySelectorAll('#' + id + ' button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === String(value));
  });
}
function buildSwatches() {
  const root = $('swatches'); root.replaceChildren();
  SWATCHES.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.style.background = c; b.dataset.c = c;
    b.setAttribute('aria-label', 'Màu ' + c);
    b.addEventListener('click', () => setAccent(c));
    root.appendChild(b);
  });
  const inp = document.createElement('input');
  inp.type = 'color'; inp.id = 'accentCustom'; inp.value = state.theme.accent; inp.title = 'Chọn màu khác';
  inp.addEventListener('input', () => setAccent(inp.value));
  root.appendChild(inp);
}
function setAccent(c) {
  state.theme.accent = c.toLowerCase();
  applyTheme(); syncTheme(); drawCurve(); saveState();
}
function syncTheme() {
  document.querySelectorAll('#swatches .sw').forEach((b) => {
    b.classList.toggle('on', b.dataset.c === state.theme.accent);
  });
  const inp = $('accentCustom'); if (inp) inp.value = state.theme.accent;
  segSync('bgSeg', state.theme.bg); segSync('radSeg', state.theme.radius);
}

function fillAutoSelects() {
  const names = Object.keys(allPresets());
  DEVICE_KEYS.forEach((k) => {
    const sel = $(SELECT_ID[k]); sel.replaceChildren();
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Giữ nguyên'; sel.appendChild(o0);
    names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    if (state.autoMap[k] && !names.includes(state.autoMap[k])) state.autoMap[k] = null;
    sel.value = state.autoMap[k] || '';
  });
}

function bindRange(id, key, fmtFn) {
  const el = $(id), v = $(id + 'V');
  el.value = state[key]; v.textContent = fmtFn(state[key]);
  el.addEventListener('input', () => { state[key] = Number(el.value); v.textContent = fmtFn(state[key]); changed(); });
}

function bindSettings() {
  $('btnSettings').addEventListener('click', openSheet);
  $('btnCloseSheet').addEventListener('click', () => {
    if (history.state && history.state.sheet) history.back(); else hideSheet();
  });
  window.addEventListener('popstate', hideSheet);

  buildSwatches();
  document.querySelectorAll('#bgSeg button').forEach((b) => b.addEventListener('click', () => {
    state.theme.bg = b.dataset.v; applyTheme(); syncTheme(); saveState();
  }));
  document.querySelectorAll('#radSeg button').forEach((b) => b.addEventListener('click', () => {
    state.theme.radius = Number(b.dataset.v); applyTheme(); syncTheme(); saveState();
  }));

  bindRange('preamp', 'preamp', (v) => fmt(v) + ' dB');
  bindRange('bass', 'bass', (v) => v + '%');
  bindRange('virt', 'virt', (v) => v + '%');
  bindRange('loud', 'loud', (v) => v.toFixed(1) + ' dB');
  $('headroom').checked = state.headroom;
  $('headroom').addEventListener('change', (e) => { state.headroom = e.target.checked; changed(); });

  $('autoOn').checked = state.autoOn;
  $('autoOn').addEventListener('change', (e) => { state.autoOn = e.target.checked; changed(); });
  fillAutoSelects();
  DEVICE_KEYS.forEach((k) => {
    $(SELECT_ID[k]).addEventListener('change', (e) => {
      state.autoMap[k] = e.target.value || null;
      const st = link.status, g = presetGains(state.autoMap[k]);
      if (state.autoOn && g && st && st.auto && st.auto.key === k) state.gains = g.map(clampGain);
      changed();
    });
  });

  $('showNow').checked = state.showNow;
  $('showNow').addEventListener('change', (e) => { state.showNow = e.target.checked; saveState(); renderIsland(); });
  if (NATIVE && NATIVE.openNotificationAccess) {
    $('nowBtns').hidden = false;
    $('btnNotifAccess').addEventListener('click', () => { try { NATIVE.openNotificationAccess(); } catch (e) { /* bỏ qua */ } });
  }

  $('autostart').checked = state.autostart;
  $('autostart').addEventListener('change', (e) => { state.autostart = e.target.checked; saveState(); pushConfig(); });
  $('selMode').value = state.mode; $('selEngine').value = state.engine;
  $('selMode').addEventListener('change', (e) => { state.mode = e.target.value; saveState(); pushConfig(); pushEq(); });
  $('selEngine').addEventListener('change', (e) => { state.engine = e.target.value; saveState(); pushConfig(); pushEq(); });

  if (NATIVE) {
    $('nativeBtns').hidden = false;
    $('btnBattery').addEventListener('click', () => { try { NATIVE.batterySettings(); } catch (e) { /* bỏ qua */ } });
    $('btnExit').addEventListener('click', () => {
      if (confirm('Tắt EQ và thoát? Âm thanh sẽ trở về nguyên bản.')) { try { NATIVE.stopAndExit(); } catch (e) { /* bỏ qua */ } }
    });
  }
  syncTheme();
}

/* ================= Khởi tạo ================= */
function init() {
  loadState();
  applyTheme();
  buildBands();

  $('eqOn').addEventListener('change', (e) => { state.enabled = e.target.checked; changed(); });
  $('btnReset').addEventListener('click', () => { state.gains = Array(10).fill(0); changed(); });
  $('btnSave').addEventListener('click', () => {
    const name = (prompt('Tên cấu hình:') || '').trim().slice(0, 24);
    if (!name) return;
    if (PRESETS[name]) { alert('Tên này trùng preset có sẵn.'); return; }
    state.custom[name] = state.gains.slice(); saveState(); renderPresets(); fillAutoSelects();
  });
  $('linkPill').addEventListener('click', () => { retryDelay = 1500; if (link.state === 'offline') connect(); });
  bindSettings();

  bindIsland(); bindTest();

  window.addEventListener('resize', drawCurve);
  changed(); renderFxStatus();
  connect();
}
init();
