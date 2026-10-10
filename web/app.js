'use strict';

/* ================= Hằng số & trạng thái ================= */
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const MIN = -12, MAX = 12, STEP = 0.5;
const WS_URL = 'ws://127.0.0.1:8765';
const EMBED_URL = 'http://127.0.0.1:8766/';
const LS_KEY = 'q14.state.v1';

const PRESETS = {
  'Vocal Clear':   [-4, -3, -2, -1, 0, 1, 3, 4, 2, 0],
  'V-pop Ballad':  [1, 2, 2, 1, 0, 1, 2, 3, 3, 2],
  'Bass Moderate': [4, 4, 3, 1, 0, 0, 0, 0, 1, 1],
  'Neutral':       [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const $ = (id) => document.getElementById(id);
const state = {
  enabled: true,
  headroom: true,
  gains: Array(10).fill(0),
  custom: {},            // { tên: [10 số] }
  mode: 'global',        // global | sessions | both
  engine: 'auto',        // auto | equalizer | dynamics
};

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!s) return;
    if (Array.isArray(s.gains) && s.gains.length === 10) state.gains = s.gains.map(clampGain);
    if (typeof s.enabled === 'boolean') state.enabled = s.enabled;
    if (typeof s.headroom === 'boolean') state.headroom = s.headroom;
    if (s.custom && typeof s.custom === 'object') state.custom = s.custom;
    if (['global', 'sessions', 'both'].includes(s.mode)) state.mode = s.mode;
    if (['auto', 'equalizer', 'dynamics'].includes(s.engine)) state.engine = s.engine;
  } catch (e) { /* localStorage có thể bị chặn */ }
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* bỏ qua */ }
}
function clampGain(g) {
  g = Number(g); if (!isFinite(g)) g = 0;
  return Math.max(MIN, Math.min(MAX, Math.round(g / STEP) * STEP));
}
function fmt(g) { return (g > 0 ? '+' : '') + g.toFixed(1); }

/** Gain thực tế gửi tới audio engine (web + Android). */
function effectiveGains() {
  if (!state.enabled) return Array(10).fill(0);
  const off = state.headroom ? -Math.max(0, ...state.gains) : 0;
  return state.gains.map((g) => g + off);
}

/* ================= Web Audio (chỉ cho âm thanh trong trang) ================= */
let ctx = null, pre = null, filters = [], vizFilters = [], analyser = null;
let noiseSrc = null, noiseBuf = null;

function initAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const mk = (i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking';
    b.frequency.value = FREQS[i];
    if (b.type === 'peaking') b.Q.value = 1.41;
    return b;
  };
  filters = FREQS.map((_, i) => mk(i));
  vizFilters = FREQS.map((_, i) => mk(i));   // chỉ để vẽ đường cong
  pre = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  let node = pre;
  filters.forEach((f) => { node.connect(f); node = f; });
  node.connect(analyser);
  analyser.connect(ctx.destination);
  const src = ctx.createMediaElementSource($('player'));
  src.connect(pre);
}

function applyWebAudio() {
  if (!ctx) return;
  const eff = effectiveGains();
  filters.forEach((f, i) => f.gain.setTargetAtTime(eff[i], ctx.currentTime, 0.02));
}

function makeNoise() {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

async function toggleNoise() {
  if (!ctx) return;
  if (noiseSrc) {
    noiseSrc.stop(); noiseSrc.disconnect(); noiseSrc = null;
    $('btnNoise').classList.remove('on'); $('btnNoise').textContent = 'Phát nhiễu hồng';
  } else {
    await ctx.resume();
    noiseBuf = noiseBuf || makeNoise();
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.5;
    noiseSrc.connect(g); g.connect(pre); noiseSrc.start();
    $('btnNoise').classList.add('on'); $('btnNoise').textContent = 'Dừng nhiễu hồng';
  }
  updateSpectrumLoop();
}

/* ================= Canvas helpers ================= */
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

/* ================= Đường cong EQ ================= */
const CURVE_RANGE = 15;
const curveFreqs = (() => {
  const n = 180, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 20 * Math.pow(1000, i / (n - 1));
  return a;
})();

function drawCurve() {
  if (!ctx) return;
  const { c, w, h } = prep($('curve'));
  const padL = 26, padR = 8, padT = 8, padB = 16;
  const pw = w - padL - padR, ph = h - padT - padB;
  const xOf = (f) => padL + (Math.log(f / 20) / Math.log(1000)) * pw;
  const yOf = (db) => padT + ph / 2 - (db / CURVE_RANGE) * (ph / 2);

  c.font = '10px system-ui'; c.textBaseline = 'middle';
  [-12, -6, 0, 6, 12].forEach((db) => {
    c.strokeStyle = db === 0 ? '#3b4666' : '#222b42';
    c.beginPath(); c.moveTo(padL, yOf(db)); c.lineTo(w - padR, yOf(db)); c.stroke();
    c.fillStyle = '#6f7a96'; c.textAlign = 'right'; c.fillText(String(db), padL - 4, yOf(db));
  });
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  FREQS.forEach((f, i) => {
    c.strokeStyle = '#1d2539';
    c.beginPath(); c.moveTo(xOf(f), padT); c.lineTo(xOf(f), padT + ph); c.stroke();
    if (i % 2 === 0 || w > 380) { c.fillStyle = '#6f7a96'; c.fillText(LABELS[i], xOf(f), h - 3); }
  });

  vizFilters.forEach((f, i) => { f.gain.value = state.gains[i]; });
  const total = new Float32Array(curveFreqs.length);
  const mag = new Float32Array(curveFreqs.length), ph2 = new Float32Array(curveFreqs.length);
  vizFilters.forEach((f) => {
    f.getFrequencyResponse(curveFreqs, mag, ph2);
    for (let i = 0; i < total.length; i++) total[i] += 20 * Math.log10(mag[i] || 1e-6);
  });

  const col = state.enabled ? '#37d6c4' : '#5d6785';
  const grad = c.createLinearGradient(0, padT, 0, padT + ph);
  grad.addColorStop(0, state.enabled ? 'rgba(55,214,196,.35)' : 'rgba(93,103,133,.25)');
  grad.addColorStop(1, 'rgba(55,214,196,0)');
  c.beginPath();
  total.forEach((db, i) => {
    const x = xOf(curveFreqs[i]), y = yOf(Math.max(-CURVE_RANGE, Math.min(CURVE_RANGE, db)));
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.strokeStyle = col; c.lineWidth = 2; c.stroke();
  c.lineTo(xOf(20000), yOf(0)); c.lineTo(xOf(20), yOf(0)); c.closePath();
  c.fillStyle = grad; c.fill();
  state.gains.forEach((g, i) => {
    c.beginPath(); c.arc(xOf(FREQS[i]), yOf(g), 3.5, 0, Math.PI * 2);
    c.fillStyle = '#fff'; c.fill();
  });
}

/* ================= Spectrum ================= */
let raf = 0;
function updateSpectrumLoop() {
  const active = !$('player').paused || !!noiseSrc;
  if (active && !raf) raf = requestAnimationFrame(drawSpectrum);
  if (!active && raf) { cancelAnimationFrame(raf); raf = 0; setTimeout(clearSpectrum, 60); }
}
function clearSpectrum() {
  if ($('player').paused && !noiseSrc) {
    const { c, w, h } = prep($('spectrum'));
    c.fillStyle = '#6f7a96'; c.font = '12px system-ui'; c.textAlign = 'center';
    c.fillText('Spectrum chỉ hiển thị khi phát âm thanh trong trang này', w / 2, h / 2);
  }
}
function drawSpectrum() {
  raf = requestAnimationFrame(drawSpectrum);
  const { c, w, h } = prep($('spectrum'));
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const nyq = ctx.sampleRate / 2, n = 40, bw = w / n;
  const grad = c.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#6c8cff'); grad.addColorStop(1, '#37d6c4');
  c.fillStyle = grad;
  for (let k = 0; k < n; k++) {
    const f0 = 20 * Math.pow(1000, k / n), f1 = 20 * Math.pow(1000, (k + 1) / n);
    const i0 = Math.floor((f0 / nyq) * data.length);
    const i1 = Math.max(i0 + 1, Math.floor((f1 / nyq) * data.length));
    let m = 0;
    for (let i = i0; i < i1 && i < data.length; i++) m = Math.max(m, data[i]);
    const bh = (m / 255) * (h - 4);
    c.fillRect(k * bw + 1, h - bh, bw - 2, bh);
  }
}

/* ================= Giao diện thanh trượt ================= */
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
    b.type = 'button'; b.textContent = name;
    b.style.cssText = 'background:none;border:0;color:inherit;font:inherit;padding:0';
    b.addEventListener('click', () => { state.gains = gains.map(clampGain); changed(); });
    chip.appendChild(b);
    if (deletable) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.title = 'Xoá cấu hình';
      x.addEventListener('click', () => {
        if (confirm('Xoá cấu hình "' + name + '"?')) { delete state.custom[name]; saveState(); renderPresets(); }
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
  $('headroom').checked = state.headroom;
  applyWebAudio(); drawCurve(); saveState(); scheduleSend(); renderLink();
}

/* ================= Kết nối app Android (WebSocket) ================= */
const link = { state: 'offline', status: null, lastStatusAt: 0 };
let ws = null, retryTimer = 0, sendTimer = 0, retryDelay = 1500;

function wsSend(obj) {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function scheduleSend() {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(pushEq, 40);
}
function pushEq() {
  wsSend({ type: 'setEq', enabled: state.enabled, gains: effectiveGains() });
}
function pushConfig() {
  wsSend({ type: 'config', mode: state.mode, engine: state.engine });
}
function connect() {
  if (ws && ws.readyState <= 1) return;
  clearTimeout(retryTimer);
  link.state = 'connecting'; renderLink();
  try { ws = new WebSocket(WS_URL); } catch (e) { return failed(); }
  ws.onopen = () => {
    link.state = 'online'; link.status = null; retryDelay = 1500;
    wsSend({ type: 'hello', client: 'q14-web', protocol: 1 });
    pushConfig(); pushEq(); wsSend({ type: 'getStatus' });
    renderLink();
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m && m.type === 'status') { link.status = m; link.lastStatusAt = Date.now(); renderLink(); renderDiag(); }
  };
  ws.onclose = failed;
  ws.onerror = () => { /* onclose sẽ xử lý */ };
}
function failed() {
  link.state = 'offline'; link.status = null; ws = null;
  renderLink(); renderDiag();
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
  const pill = $('linkPill'), b = $('banner');
  b.replaceChildren();
  const add = (t) => { const p = document.createElement('p'); p.textContent = t; b.appendChild(p); return p; };
  const embedded = location.origin === 'http://127.0.0.1:8766';

  if (link.state !== 'online') {
    pill.className = 'pill offline';
    pill.textContent = link.state === 'connecting' ? 'Đang kết nối…' : 'Chưa kết nối app';
    b.className = 'banner warn';
    add('Chưa kết nối app Android Q14. EQ hiện CHỈ áp dụng cho âm thanh phát trong trang này (mục Kiểm thử), chưa tác động lên TikTok, YouTube, Roblox hay ứng dụng khác.');
    add('Mở app Q14 Audio Lab trên điện thoại và bấm "Bật dịch vụ EQ". Nếu Chrome hỏi quyền truy cập thiết bị trong mạng cục bộ, hãy chọn Cho phép.');
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
    add('App đã kết nối nhưng CHƯA tạo được hiệu ứng EQ hệ thống, nên EQ chưa áp dụng ngoài website.');
    if (g.state === 'error' && g.message) add('Lý do (toàn cục): ' + g.message);
    if (s.mode !== 'global' && sess.length === 0) add('Chưa có ứng dụng nào mở phiên hiệu ứng âm thanh (nhiều ứng dụng như TikTok, Roblox có thể không gửi tín hiệu này).');
    add('Thử đổi "Phạm vi áp dụng" hoặc "Bộ xử lý" trong mục Nâng cao.');
    return;
  }
  pill.className = 'pill ok'; pill.textContent = 'Đã gửi tới app';
  b.className = 'banner ok';
  const parts = [];
  if (g.state === 'ok') parts.push('toàn cục (' + g.kind + ')');
  if (okSess.length) parts.push(okSess.length + ' phiên ứng dụng');
  add('App đã nhận EQ và khởi tạo hiệu ứng: ' + parts.join(' + ') + '.');
  add('Lưu ý: việc tạo hiệu ứng thành công chưa chứng minh âm thanh của ứng dụng khác thật sự bị tác động. Hãy nghe thử: phát YouTube rồi bật/tắt EQ hoặc dùng preset Bass Moderate.');
  if (!state.enabled) add('EQ đang TẮT: app nhận đường phẳng (0 dB).');
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
  if (Array.isArray(d.effects)) L.push('Hiệu ứng có trên máy: ' + (d.effects.join('; ') || '(không)'));
  el.textContent = L.join('\n');
}

/* ================= Khởi tạo & sự kiện ================= */
function init() {
  loadState();
  buildBands();
  initAudio();

  $('eqOn').addEventListener('change', (e) => { state.enabled = e.target.checked; changed(); });
  $('headroom').addEventListener('change', (e) => { state.headroom = e.target.checked; changed(); });
  $('btnReset').addEventListener('click', () => { state.gains = Array(10).fill(0); changed(); });
  $('btnSave').addEventListener('click', () => {
    const name = (prompt('Tên cấu hình:') || '').trim().slice(0, 24);
    if (!name) return;
    if (PRESETS[name]) { alert('Tên này trùng preset có sẵn.'); return; }
    state.custom[name] = state.gains.slice(); saveState(); renderPresets();
  });
  $('btnNoise').addEventListener('click', toggleNoise);
  $('linkPill').addEventListener('click', () => { retryDelay = 1500; if (link.state === 'offline') connect(); });

  $('selMode').value = state.mode; $('selEngine').value = state.engine;
  $('selMode').addEventListener('change', (e) => { state.mode = e.target.value; saveState(); pushConfig(); pushEq(); });
  $('selEngine').addEventListener('change', (e) => { state.engine = e.target.value; saveState(); pushConfig(); pushEq(); });

  const player = $('player');
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (player.dataset.url) URL.revokeObjectURL(player.dataset.url);
    const url = URL.createObjectURL(f);
    player.dataset.url = url; player.src = url; player.load();
  });
  player.addEventListener('play', async () => { if (ctx) await ctx.resume(); updateSpectrumLoop(); });
  ['pause', 'ended'].forEach((ev) => player.addEventListener(ev, updateSpectrumLoop));

  window.addEventListener('resize', () => { drawCurve(); clearSpectrum(); });
  changed(); clearSpectrum();
  connect();
}
init();
