// 패밀리가드 부모 웹앱
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $subtitle = document.getElementById('subtitle');
const $back = document.getElementById('back');
const $logout = document.getElementById('logout');
const $toast = document.getElementById('toast');

const DEFAULT_POLICY = {
  dailyLimitsMin: {}, bedtimeEnabled: false, bedtimeStartMin: 22 * 60, bedtimeEndMin: 7 * 60,
  alwaysAllowed: [], blockAdb: false, blockedServices: [], familyFilter: true, mode: 'normal', totalDailyLimitMin: null,
  locationIntervalMin: 10, resetMin: 7 * 60, bonusMin: 0, bonusUntil: 0, dataCycleDay: 1,
};
// 부모가 준 추가 시간: 다음 초기화 시각까지만 유효 (폰의 Policy.withBonus와 같은 규칙)
const activeBonus = (p) => (Date.now() < (p.bonusUntil || 0) ? (p.bonusMin || 0) : 0);
const effTotal = (p) => (p.totalDailyLimitMin == null ? null : p.totalDailyLimitMin + activeBonus(p));
function nextReset(resetMin) {
  const t = new Date();
  const now = t.getTime();
  t.setHours(Math.floor(resetMin / 60), resetMin % 60, 0, 0);
  if (t.getTime() > now) t.setDate(t.getDate() - 1);
  t.setDate(t.getDate() + 1);
  return t.getTime();
}
const resetLabel = (m) => (m === 0 ? '자정' : `${m < 720 ? '아침' : '오후'} ${Math.floor(m / 60) > 12 ? Math.floor(m / 60) - 12 : Math.floor(m / 60)}시${m % 60 ? ` ${m % 60}분` : ''}`);
const RESET_TIMES = [[0, '자정 (0시)'], [5 * 60, '새벽 5시'], [6 * 60, '아침 6시'], [7 * 60, '아침 7시'], [8 * 60, '아침 8시']];
const LOCATION_INTERVALS = [[0, '끄기 (요청할 때만)'], [5, '5분마다'], [10, '10분마다'], [30, '30분마다'], [60, '1시간마다']];
const APP_LIMITS = [[null, '제한 없음'], [0, '차단'], [30, '30분'], [60, '1시간'], [90, '1시간 30분'], [120, '2시간'], [180, '3시간']];
const TOTAL_LIMITS = [[null, '제한 없음'], [60, '1시간'], [90, '1시간 30분'], [120, '2시간'], [150, '2시간 30분'], [180, '3시간'], [240, '4시간'], [300, '5시간']];
const FALLBACK_SERVICES = [
  { id: 'assistant', label: '음성비서' }, { id: 'youtube', label: '유튜브' },
  { id: 'tiktok', label: '틱톡' }, { id: 'instagram', label: '인스타그램' },
];
const SERVICE_DESC = {
  assistant: '구글 앱·Gemini·Voice Access를 정지합니다',
  youtube: '앱과 웹 주소를 함께 막아 카톡·학원앱 속 링크도 차단',
};
const ICONS = {
  normal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  call_only: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h3l1.5 4-2 1.3a11 11 0 0 0 6.1 6.1l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  locked: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
const MODES = [
  { id: 'normal', name: '일반', color: 'var(--ok)', desc: '평소처럼 사용합니다. 아래 \'제한\' 탭의 규칙만 적용됩니다.' },
  { id: 'call_only', name: '통화만', color: 'var(--warn)', desc: '전화와 연락처만 쓸 수 있습니다. 홈 화면·알림창·다른 앱은 막힙니다.' },
  { id: 'locked', name: '잠금', color: 'var(--danger)', desc: '잠금 안내 화면만 보입니다. 걸려 오는 전화와 긴급 전화만 가능합니다.' },
];
const EVENT_ICON = { pin_ok: ['🔑', 'warn'], pin_locked: ['🚨', 'danger'], limit_reached: ['⏰', ''] };
const ONLINE_MS = 3 * 60 * 1000;

const state = {
  session: null, family: null, devices: [], commands: [], events: [],
  view: 'home', deviceId: null, tab: 'overview', authMode: 'login', code: null, push: 'unknown',
  locations: {}, mapView: null,
};
let map = null;
let channel = null;

// ───────── 유틸 ─────────

// 폰이 보고한 앱 이름 등은 신뢰할 수 없는 값이므로 반드시 이스케이프한다.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 2800);
}

function fmtDuration(ms) {
  const m = Math.floor((ms || 0) / 60000), h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}시간 ${r}분`;
  if (h) return `${h}시간`;
  return `${r}분`;
}
const fmtShort = (ms) => { const m = Math.floor((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const toClock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromClock = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const limitName = (min) => (TOTAL_LIMITS.find(([v]) => v === min) || [null, `${min}분`])[1];

function ago(ts) {
  if (!ts) return '기록 없음';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
const isOnline = (d) => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;

// 앱 이름 첫 글자로 만든 색 아바타
function avatar(label, key) {
  let h = 0;
  for (const ch of String(key || label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const letter = esc((String(label || '?').trim()[0] || '?').toUpperCase());
  return `<span class="avatar" style="background:hsl(${hue} 55% 48%)">${letter}</span>`;
}

function ring(pct, size, stroke, color, label) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, pct)));
  return `<div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="ring-label">${label}</div>
  </div>`;
}

// 하루 사용 링: 한도가 있으면 한도 대비, 없으면 8시간 대비
function usageRing(d, size, stroke, big) {
  const s = d.state || {};
  const limit = effTotal(policyOf(d));
  const used = limit != null ? (s.limitedMs ?? s.screenTimeMs ?? 0) : (s.screenTimeMs ?? 0);
  const pct = limit != null ? used / (limit * 60000) : used / (8 * 3600000);
  const color = limit == null ? 'var(--accent)' : pct >= 1 ? 'var(--danger)' : pct >= 0.8 ? 'var(--warn)' : 'var(--accent)';
  const label = big
    ? `<div><strong>${fmtShort(used)}</strong><div class="sub">${limit != null ? `/ ${fmtShort(limit * 60000)}` : '오늘'}</div></div>`
    : `<strong style="font-size:13px">${fmtShort(used)}</strong>`;
  return ring(pct, size, stroke, color, label);
}

async function run(promise, okMsg) {
  const { data, error } = await promise;
  if (error) {
    toast(error.message || '오류가 발생했습니다');
    throw error;
  }
  if (okMsg) toast(okMsg);
  return data;
}

// ───────── 데이터 ─────────

async function loadFamily() {
  const fams = await run(sb.from('families').select('id,name').order('created_at').limit(1));
  state.family = fams[0] || null;
  if (state.family) await loadDevices();
}

async function loadDevices() {
  state.devices = await run(sb.from('devices').select('*').eq('family_id', state.family.id).order('created_at'));
  const ids = state.devices.map((d) => d.id);
  const [cmds, evs] = await Promise.all([
    ids.length
      ? run(sb.from('commands').select('id,device_id,type,payload,created_at,done_at,result').in('device_id', ids).order('id', { ascending: false }).limit(30))
      : [],
    run(sb.from('events').select('id,device_id,type,title,body,created_at').eq('family_id', state.family.id).order('id', { ascending: false }).limit(40)),
  ]);
  state.commands = cmds;
  state.events = evs;
}

function subscribe() {
  if (channel || !state.family) return;
  channel = sb.channel(`family-${state.family.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `family_id=eq.${state.family.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commands' }, (e) => {
      if (e.eventType === 'DELETE' || e.new?.type === 'history') return;
      refresh();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `family_id=eq.${state.family.id}` }, refresh)
    .subscribe();
}

let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!state.family) return;
    await loadDevices().catch(() => {});
    // 입력 중이면 화면을 다시 그리지 않는다.
    if (!document.activeElement || !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) render();
  }, 300);
}

const device = () => state.devices.find((d) => d.id === state.deviceId);
const policyOf = (d) => ({ ...DEFAULT_POLICY, ...(d.policy || {}) });

async function savePolicy(d, patch, msg) {
  const policy = { ...policyOf(d), ...patch };
  d.policy = policy;
  render();
  await run(sb.from('devices').update({ policy, policy_updated_at: new Date().toISOString() }).eq('id', d.id),
    msg ?? (isOnline(d) ? '저장했습니다. 폰에 바로 적용됩니다.' : '저장했습니다. 폰이 연결되면 적용됩니다.'));
}

async function sendCommand(d, type, payload = {}, msg) {
  await run(sb.from('commands').insert({ device_id: d.id, type, payload, created_by: state.session.user.id }), msg);
  await loadDevices();
  render();
}

// ───────── 푸시 알림 ─────────

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function checkPush() {
  if (isIOS && !isStandalone) return (state.push = 'ios-install');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return (state.push = 'unsupported');
  if (Notification.permission === 'denied') return (state.push = 'denied');
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  state.push = sub ? 'on' : 'off';
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function enablePush() {
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      state.push = perm === 'denied' ? 'denied' : 'off';
      toast('알림이 허용되지 않았습니다');
      return render();
    }
    const sub = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    await run(sb.from('push_subscriptions').upsert({
      endpoint: sub.endpoint, user_id: state.session.user.id, subscription: sub.toJSON(), user_agent: navigator.userAgent.slice(0, 200),
    }), '이 폰에서 알림을 받습니다');
    state.push = 'on';
  } catch (e) {
    toast(`알림 설정 실패: ${e.message || e}`);
  }
  render();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  state.push = 'off';
  toast('이 폰에서 알림을 끕니다');
  render();
}

function pushBanner(compact) {
  const p = state.push;
  if (p === 'on' || p === 'unknown') return '';
  const msg = {
    off: ['부모 PIN 사용·한도 도달 알림 받기', '자녀 폰에서 부모 PIN이 쓰이면 바로 알려드립니다.'],
    'ios-install': ['아이폰은 홈 화면에 추가해야 알림을 받을 수 있어요', 'Safari 공유 버튼 → 홈 화면에 추가 → 아이콘으로 다시 열기'],
    denied: ['알림이 차단되어 있어요', '브라우저(또는 휴대폰) 설정에서 이 사이트 알림을 허용해 주세요.'],
    unsupported: ['이 브라우저는 알림을 지원하지 않아요', '안드로이드는 Chrome, 아이폰은 홈 화면에 추가한 앱에서 사용하세요.'],
  }[p];
  if (compact && p !== 'off' && p !== 'ios-install') return '';
  return `<div class="banner ${p === 'off' ? '' : 'warn'}">
    <div class="grow"><strong>${msg[0]}</strong>${msg[1]}</div>
    ${p === 'off' ? '<button class="btn primary small" data-act="push-on">켜기</button>' : ''}
  </div>`;
}

// ───────── 앱 잠금 PIN ─────────
// 이 휴대폰에서만 쓰는 4자리 PIN. 서버로 보내지 않고 PBKDF2 해시만 이 브라우저에 저장한다.
// 앱을 열 때와 3분 넘게 다른 앱에 있다가 돌아올 때 잠긴다 (3분 안의 새로고침은 그대로 둔다). 5번 틀리면 로그아웃된다.

const PIN_LEN = 4;
const LOCK_AFTER_MS = 3 * 60 * 1000; // 마지막으로 쓴 뒤 3분 안이면 PIN을 다시 묻지 않는다
const MAX_FAILS = 5;
const lock = { step: null, entry: '', first: '', msg: '', shake: false, hiddenAt: 0, busy: false };

// 잠금이 풀린 채로 쓰고 있었던 마지막 시각. 새로고침(화면 당기기)이나 잠깐 껐다 켠 경우 3분 안에는 PIN을 다시 묻지 않는다.
// 잠겨 있는 동안에는 기록하지 않으므로, 잠금 화면에서 새로고침해도 풀리지 않는다.
const ACTIVE_KEY = 'fg_last_active';
function markActive() {
  if (!state.session || lock.step) return;
  try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch { /* 저장 불가 시 매번 PIN */ }
}
function recentlyActive() {
  try { return Date.now() - Number(localStorage.getItem(ACTIVE_KEY) || 0) < LOCK_AFTER_MS; } catch { return false; }
}
setInterval(() => { if (document.visibilityState === 'visible') markActive(); }, 5000);
addEventListener('pagehide', markActive);

const lockKey = () => `fg_lock_${state.session?.user?.id}`;
function lockConfig() {
  try { return JSON.parse(localStorage.getItem(lockKey()) || 'null'); } catch { return null; }
}
function saveLockConfig(c) {
  try {
    if (c) localStorage.setItem(lockKey(), JSON.stringify(c)); else localStorage.removeItem(lockKey());
  } catch { toast('이 브라우저에 저장할 수 없습니다'); }
}
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

async function pinHash(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations }, key, 256));
}

function startLock(step) {
  Object.assign(lock, { step, entry: '', first: '', msg: '', shake: false });
  render();
}

async function signOutAll(message) {
  saveLockConfig(null);
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* 무시 */ }
  lock.step = null;
  await sb.auth.signOut();
  if (message) toast(message);
}

async function pinDigit(d) {
  if (lock.busy || !lock.step) return;
  if (d === 'del') lock.entry = lock.entry.slice(0, -1);
  else if (lock.entry.length < PIN_LEN) lock.entry += d;
  lock.shake = false;
  if (lock.entry.length < PIN_LEN) return render();
  render();
  lock.busy = true;
  try {
    const pin = lock.entry;
    lock.entry = '';
    if (lock.step === 'unlock') {
      const c = lockConfig();
      if (!c) { lock.step = null; return; }
      if (await pinHash(pin, c.salt, c.iterations) === c.hash) {
        saveLockConfig({ ...c, fails: 0 });
        lock.step = null;
        markActive();
        return;
      }
      const fails = (c.fails || 0) + 1;
      if (fails >= MAX_FAILS) {
        await signOutAll('PIN을 5번 틀려서 로그아웃했습니다. 이메일로 다시 로그인하세요.');
        return;
      }
      saveLockConfig({ ...c, fails });
      Object.assign(lock, { msg: `PIN이 틀렸어요 (${fails}/${MAX_FAILS})`, shake: true });
    } else if (lock.step === 'set1') {
      Object.assign(lock, { step: 'set2', first: pin, msg: '' });
    } else if (lock.step === 'set2') {
      if (pin !== lock.first) {
        Object.assign(lock, { step: 'set1', first: '', msg: 'PIN이 서로 달라요. 처음부터 다시 입력하세요.', shake: true });
      } else {
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        const iterations = 150000;
        saveLockConfig({ salt, iterations, hash: await pinHash(pin, salt, iterations), fails: 0 });
        lock.step = null;
        toast('앱 잠금 PIN을 설정했습니다');
      }
    }
  } finally {
    lock.busy = false;
    render();
  }
}

function renderLock() {
  $title.textContent = '';
  $logout.hidden = true;
  $back.hidden = true;
  const title = { unlock: 'PIN을 입력하세요', set1: '새 PIN 4자리를 입력하세요', set2: '한 번 더 입력하세요' }[lock.step];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', lock.step === 'unlock' ? '' : 'cancel', '0', 'del'];
  $app.innerHTML = `
    <div class="lock-screen">
      <img class="lock-icon" src="icon-192.png" alt="">
      <div class="lock-title">${title}</div>
      <div class="pin-dots ${lock.shake ? 'shake' : ''}" aria-label="${lock.entry.length}자리 입력됨">
        ${Array.from({ length: PIN_LEN }, (_, i) => `<span class="${i < lock.entry.length ? 'on' : ''}"></span>`).join('')}
      </div>
      <div class="lock-msg">${esc(lock.msg)}</div>
      <div class="keypad">
        ${keys.map((k) => k === ''
          ? '<span></span>'
          : `<button data-key="${k}" aria-label="${k === 'del' ? '지우기' : k === 'cancel' ? '취소' : k}">${k === 'del' ? '⌫' : k === 'cancel' ? '<small>취소</small>' : k}</button>`).join('')}
      </div>
      ${lock.step === 'unlock' ? '<button class="text-btn" data-act="forgot">PIN을 잊었어요</button>' : ''}
    </div>`;
  bind('[data-key]', 'click', (e) => {
    const k = e.currentTarget.dataset.key;
    if (k === 'cancel') { lock.step = null; return render(); }
    pinDigit(k);
  });
  bind('[data-act=forgot]', 'click', () => signOutAll('로그아웃했습니다. 이메일로 로그인한 뒤 PIN을 다시 설정하세요.'));
}

document.addEventListener('keydown', (e) => {
  if (!lock.step) return;
  if (/^[0-9]$/.test(e.key)) pinDigit(e.key);
  else if (e.key === 'Backspace') pinDigit('del');
});

function deviceSettingsCard() {
  const c = lockConfig();
  const pushRow = {
    on: '<div class="row"><div class="grow"><div class="row-title">알림 받는 중</div><div class="sub">부모 PIN 사용, PIN 5회 틀림, 하루 한도 도달</div></div><button class="btn small" data-act="push-off">끄기</button></div>',
    off: '<div class="row"><div class="grow"><div class="row-title">알림 받기</div><div class="sub">부모 PIN 사용, PIN 5회 틀림, 하루 한도 도달</div></div><button class="btn primary small" data-act="push-on">켜기</button></div>',
  }[state.push] || '';
  return `
    <div class="section-label">이 폰 설정</div>
    <div class="card">
      <div class="row">
        <div class="grow">
          <div class="row-title">앱 잠금 PIN</div>
          <div class="sub">${c ? '켜짐 · 앱을 열 때 PIN 4자리를 입력합니다' : '꺼짐 · 다른 사람이 이 폰으로 설정을 바꾸지 못하게 막아요'}</div>
        </div>
        ${c
          ? '<button class="btn small" data-act="lock-change">변경</button><button class="btn small danger" data-act="lock-off">끄기</button>'
          : '<button class="btn primary small" data-act="lock-on">켜기</button>'}
      </div>
      ${pushRow}
    </div>`;
}

// ───────── 화면 ─────────

function render() {
  $logout.hidden = !state.session || state.view !== 'home';
  $back.hidden = state.view === 'home' || !state.session;
  $subtitle.textContent = '';
  if (!state.session) return renderAuth();
  if (lock.step) return renderLock();
  if (!state.family) return renderNoFamily();
  if (state.view === 'device' && device()) return renderDevice(device());
  state.view = 'home';
  renderHome();
}

function bind(sel, ev, fn) { $app.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn)); }

function renderAuth() {
  $title.textContent = '';
  const signup = state.authMode === 'signup';
  $app.innerHTML = `
    <div class="auth-hero">
      <img src="icon-192.png" alt="">
      <h1>패밀리가드</h1>
      <div class="muted">아이의 폰 사용을 함께 지키는 보호자 앱</div>
    </div>
    <div class="card">
      <div class="seg">
        <button data-mode="login" aria-pressed="${!signup}">로그인</button>
        <button data-mode="signup" aria-pressed="${signup}">처음 사용</button>
      </div>
      <form id="auth">
        <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>비밀번호${signup ? ' (6자 이상)' : ''}</span>
          <input type="password" name="password" minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary full" type="submit">${signup ? '가입하기' : '로그인'}</button>
      </form>
      <p class="sub center" style="margin-bottom:0">보호자만 가입합니다. 자녀 폰은 연결 코드로 연결해요.</p>
    </div>`;
  bind('[data-mode]', 'click', (e) => { state.authMode = e.currentTarget.dataset.mode; render(); });
  $app.querySelector('#auth').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const creds = { email: f.get('email').trim(), password: f.get('password') };
    lock.justLoggedIn = true;
    const { error } = signup ? await sb.auth.signUp(creds) : await sb.auth.signInWithPassword(creds);
    if (error) toast(error.message.includes('Invalid login') ? '이메일 또는 비밀번호가 틀렸습니다' : error.message);
  };
}

function renderNoFamily() {
  $title.textContent = '시작하기';
  $app.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>가족 만들기</h2></div>
      <p class="sub">처음 사용하는 보호자라면 가족을 만드세요.</p>
      <form id="create">
        <label class="field"><span>가족 이름</span><input type="text" name="name" value="우리 가족" maxlength="30"></label>
        <button class="btn primary full">가족 만들기</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><h2>초대 코드로 합류</h2></div>
      <p class="sub">다른 보호자가 이미 가족을 만들었다면, 받은 6자리 초대 코드를 입력하세요.</p>
      <form id="join">
        <label class="field"><span>초대 코드</span><input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label>
        <button class="btn full">합류하기</button>
      </form>
    </div>`;
  $app.querySelector('#create').onsubmit = async (e) => {
    e.preventDefault();
    await run(sb.rpc('create_family', { family_name: new FormData(e.target).get('name') }), '가족을 만들었습니다');
    await loadFamily(); subscribe(); render();
  };
  $app.querySelector('#join').onsubmit = async (e) => {
    e.preventDefault();
    await run(sb.rpc('redeem_parent_code', { pairing_code: new FormData(e.target).get('code').trim() }), '가족에 합류했습니다');
    await loadFamily(); subscribe(); render();
  };
}

/** 폰 화면 상태: 켜짐(사용 중) / 잠금화면 / 꺼짐 + 그 상태가 된 지 얼마나 됐는지 */
function screenChip(d) {
  const sc = d.state?.screen;
  if (!sc || !sc.state || !isOnline(d)) return '';
  const dur = sc.since ? Date.now() - sc.since : 0;
  const forTime = dur < 60000 ? '방금' : `${fmtDuration(dur)}째`;
  const [icon, name, tone] = { on: ['📱', '화면 켜짐', 'ok'], locked: ['🔒', '잠금화면', ''], off: ['⚫', '화면 꺼짐', ''] }[sc.state] || ['', sc.state, ''];
  return `<span class="chip ${tone}" title="폰 화면 상태">${icon} ${name} · ${forTime}</span>`;
}

function statusChips(d) {
  const s = d.state || {};
  const p = policyOf(d);
  const mode = MODES.find((m) => m.id === p.mode);
  return `
    <span class="chip ${isOnline(d) ? 'ok' : ''}"><span class="dot ${isOnline(d) ? 'on' : ''}"></span>${isOnline(d) ? '온라인' : esc(ago(d.last_seen))}</span>
    ${screenChip(d)}
    ${p.mode !== 'normal' ? `<span class="chip ${p.mode === 'locked' ? 'danger' : 'warn'}">${esc(mode?.name)} 모드</span>` : ''}
    ${s.battery != null ? `<span class="chip">🔋 ${esc(s.battery)}%</span>` : ''}
    ${s.location ? `<span class="chip">📍 ${esc(ago(new Date(s.location.at).toISOString()))}</span>` : ''}
    ${s.mobileData ? `<span class="chip">📶 이번 달 ${esc(fmtBytes(s.mobileData.monthBytes))}</span>` : ''}
    ${s.vpn === false ? '<span class="chip danger">인터넷 필터 꺼짐</span>' : ''}
    ${s.deviceOwner === false ? '<span class="chip danger">관리 권한 없음</span>' : ''}`;
}

function renderHome() {
  $title.textContent = state.family.name;
  $subtitle.textContent = state.devices.length ? `자녀 폰 ${state.devices.length}대` : '';
  const cards = state.devices.map((d) => {
    const s = d.state || {};
    const fg = (s.foreground || []).map((a) => a.label).join(', ');
    const pending = (s.pending || []).length;
    return `
      <div class="card device-card" role="button" tabindex="0" data-device="${esc(d.id)}">
        ${usageRing(d, 64, 7, false)}
        <div style="flex:1;min-width:0">
          <h3>${esc(d.name)} ${pending ? `<span class="badge">${pending}</span>` : ''}</h3>
          <div class="sub ellipsis">${fg ? `지금 ${esc(fg)} 사용 중` : `오늘 ${fmtDuration(s.screenTimeMs)} 사용`}</div>
          <div class="chips" style="margin-top:8px">${statusChips(d)}</div>
        </div>
        <svg class="chev" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;
  }).join('');

  const recent = state.events.slice(0, 3);
  $app.innerHTML = `
    ${pushBanner(true)}
    ${cards || `<div class="card center">
      <div style="font-size:40px">📱</div>
      <h2 style="margin:6px 0">연결된 자녀 폰이 없어요</h2>
      <p class="sub">아래 '자녀 폰 연결'로 코드를 만든 뒤, 자녀 폰의 패밀리가드 → 부모 설정 → 부모 앱 연결에 입력하세요.</p>
    </div>`}
    ${recent.length ? `
      <div class="section-label">최근 알림</div>
      <div class="card">
        ${recent.map(eventRow).join('')}
        <div style="text-align:right;margin-top:6px"><button class="link" data-clear-events="all">알림 비우기</button></div>
      </div>` : ''}
    ${familyPanel()}
    ${deviceSettingsCard()}`;
  bind('[data-act=family]', 'click', () => { state.familyOpen = !state.familyOpen; render(); });
  bind('[data-clear-events]', 'click', (e) => clearEvents(e.currentTarget, null));
  bind('[data-act=lock-on]', 'click', () => startLock('set1'));
  bind('[data-act=lock-change]', 'click', () => startLock('set1'));
  bind('[data-act=lock-off]', 'click', () => { saveLockConfig(null); toast('앱 잠금을 껐습니다'); render(); });
  bind('[data-act=push-off]', 'click', disablePush);
  bind('[data-device]', 'click', (e) => openDevice(e.currentTarget.dataset.device));
  bind('[data-device]', 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDevice(e.currentTarget.dataset.device); } });
  bind('[data-act=pair]', 'click', () => makeCode('device'));
  bind('[data-act=invite]', 'click', () => makeCode('parent'));
  bind('[data-act=push-on]', 'click', enablePush);
}

function openDevice(id) {
  state.view = 'device';
  state.deviceId = id;
  state.tab = 'overview';
  render();
  scrollTo(0, 0);
}

function codeCard() {
  const c = state.code;
  if (!c || Date.now() > c.expires) return '';
  const left = Math.max(1, Math.round((c.expires - Date.now()) / 60000));
  return `
    <div class="card center">
      <div class="sub" style="font-weight:700">${c.kind === 'device' ? '자녀 폰 연결 코드' : '보호자 초대 코드'}</div>
      <div class="code">${esc(c.code)}</div>
      <p class="sub" style="margin:0">${c.kind === 'device'
        ? '자녀 폰의 패밀리가드 → 부모 설정 → 부모 앱 연결에 입력하세요.'
        : '다른 보호자가 가입한 뒤 \'초대 코드로 합류\'에 입력합니다.'}<br>약 ${left}분 동안 유효합니다.</p>
    </div>`;
}

/**
 * 가족 관리 (자녀 폰 연결·보호자 초대): 처음 한 번만 쓰는 기능이라 평소엔 접어 둔다.
 * 연결된 자녀 폰이 없거나 방금 코드를 만든 경우에는 펼쳐 둔다.
 */
function familyPanel() {
  const codeLive = state.code && Date.now() < state.code.expires;
  const open = state.familyOpen || !state.devices.length || codeLive;
  return `
    <div class="card fold ${open ? 'open' : ''}">
      <button class="fold-head" data-act="family" aria-expanded="${open}">
        <span>👨‍👩‍👧 가족 관리</span>
        <span class="sub">자녀 폰 연결 · 보호자 초대</span>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      ${open ? `
      <div class="fold-body">
        <div class="btns">
          <button class="btn primary" data-act="pair">자녀 폰 연결</button>
          <button class="btn" data-act="invite">보호자 초대</button>
        </div>
        ${codeCard()}
      </div>` : ''}
    </div>`;
}

async function makeCode(kind) {
  const code = await run(sb.rpc('create_pairing_code', { fid: state.family.id, code_kind: kind }));
  state.code = { code, kind, expires: Date.now() + 10 * 60 * 1000 };
  render();
}

/** 알림 기록 비우기. d가 있으면 그 기기만, 없으면 가족 전체. 실수 방지로 두 번 눌러야 지운다. */
async function clearEvents(btn, d) {
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = '한 번 더 누르면 비워요';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.confirm; btn.textContent = d ? '비우기' : '알림 비우기'; } }, 4000);
    return;
  }
  let q = sb.from('events').delete().eq('family_id', state.family.id);
  if (d) q = q.eq('device_id', d.id);
  await run(q, '알림을 비웠습니다');
  state.events = d ? state.events.filter((e) => e.device_id !== d.id) : [];
  render();
}

function eventRow(e) {
  const [ico, tone] = EVENT_ICON[e.type] || ['🔔', ''];
  const dev = state.devices.find((d) => d.id === e.device_id);
  return `<div class="event">
    <div class="ico ${tone}">${ico}</div>
    <div style="flex:1;min-width:0">
      <div class="row-title">${esc(e.title)}</div>
      <div class="sub">${esc(e.body)}</div>
      <div class="sub">${dev ? `${esc(dev.name)} · ` : ''}${esc(ago(e.created_at))}</div>
    </div>
  </div>`;
}

function sw(id, checked, label, sub = '') {
  return `<div class="row"><div class="grow"><div class="row-title">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function usageList(usage, limit) {
  if (!usage.length) return '<div class="empty">오늘 사용 기록이 없습니다.</div>';
  const max = Math.max(...usage.map((u) => u.ms), 1);
  return usage.slice(0, limit).map((u) => `
    <div class="row">
      ${avatar(u.label, u.pkg)}
      <div class="grow">
        <div style="display:flex;gap:8px"><span class="ellipsis" style="flex:1">${esc(u.label)}</span><span class="sub">${fmtDuration(u.ms)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (u.ms / max) * 100)}%"></div></div>
      </div>
    </div>`).join('');
}

function renderDevice(d) {
  const s = d.state || {};
  const p = policyOf(d);
  $title.textContent = d.name;
  $subtitle.textContent = isOnline(d) ? '온라인' : `마지막 연결 ${ago(d.last_seen)}`;
  const pending = s.pending || [];
  const tabs = [['overview', '개요'], ['location', '위치'], ['limits', '제한'], ['activity', '기록'], ['settings', '설정']];
  const limited = s.limitedMs ?? 0;

  const hero = `
    <div class="card">
      <div class="hero">
        ${usageRing(d, 112, 11, true)}
        <div style="flex:1;min-width:0">
          <div class="sub">오늘 사용</div>
          <div class="big">${fmtDuration(s.screenTimeMs)}</div>
          <div class="sub">${effTotal(p) != null
            ? `하루 한도 ${esc(limitName(p.totalDailyLimitMin))}${activeBonus(p) ? ` <b style="color:var(--accent)">+${fmtDuration(activeBonus(p) * 60000)}</b>` : ''} · ${limited >= effTotal(p) * 60000 ? '<b style="color:var(--danger)">다 사용함</b>' : `남은 시간 ${fmtDuration(effTotal(p) * 60000 - limited)}`}`
            : '하루 한도 없음'} · 잠금 해제 ${esc(s.unlocks ?? 0)}회</div>
        </div>
      </div>
      <div class="chips">${statusChips(d)}${(s.foreground || []).map((a) => `<span class="chip">▶ ${esc(a.label)}</span>`).join('')}</div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([id, name]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${name}${id === 'overview' && pending.length ? ` <span class="badge">${pending.length}</span>` : ''}</button>`).join('')}
    </div>`;

  const body = { overview: tabOverview, location: tabLocation, limits: tabLimits, activity: tabActivity, settings: tabSettings }[state.tab](d, s, p);
  saveMapView();
  $app.innerHTML = hero + body;
  bind('[data-tab]', 'click', (e) => { state.tab = e.currentTarget.dataset.tab; state.mapView = null; render(); });
  bindDevice(d, s, p);
  if (state.tab === 'location') showMap(d).catch((e) => toast(`지도 표시 실패: ${e.message || e}`));
  if (state.tab === 'activity') showPatterns(d).catch((e) => toast(`패턴 표시 실패: ${e.message || e}`));
  if (state.tab === 'activity') showSites(d).catch((e) => toast(`사이트 기록 표시 실패: ${e.message || e}`));
}

function tabOverview(d, s, p) {
  const pending = s.pending || [];
  const pendingCmd = new Set(state.commands.filter((c) => c.device_id === d.id && !c.done_at).map((c) => `${c.type}:${c.payload?.pkg || ''}`));
  const mode = MODES.find((m) => m.id === p.mode) || MODES[0];
  const devEvents = state.events.filter((e) => e.device_id === d.id).slice(0, 3);
  return `
    <div class="card">
      <div class="card-head"><h2>🎁 오늘 추가 시간</h2>${activeBonus(p) ? `<span class="chip ok">+${fmtDuration(activeBonus(p) * 60000)}</span>` : ''}</div>
      <p class="sub" style="margin-top:-4px">하루 한도와 앱별 한도에 더해집니다. ${esc(resetLabel(p.resetMin))}에 자동으로 사라져요.</p>
      <div class="btns">
        <button class="btn soft" data-bonus="15">+15분</button>
        <button class="btn soft" data-bonus="30">+30분</button>
        <button class="btn soft" data-bonus="60">+1시간</button>
      </div>
      ${activeBonus(p) ? '<button class="text-btn" data-bonus="cancel" style="margin-top:6px">추가 시간 취소</button>' : ''}
    </div>

    <div class="card">
      <div class="card-head"><h2>모드</h2></div>
      <div class="modes">
        ${MODES.map((m) => `<button class="mode" data-mode-set="${m.id}" aria-pressed="${p.mode === m.id}" style="--mode-color:${m.color}">${ICONS[m.id]}${m.name}</button>`).join('')}
      </div>
      <p class="mode-desc">${mode.desc}
        ${isOnline(d) && s.mode && s.mode !== p.mode ? '<br><b>폰에 적용하는 중…</b>' : ''}
        ${!isOnline(d) && p.mode !== (s.mode || 'normal') ? '<br>폰이 오프라인이라 연결되면 적용됩니다.' : ''}</p>
    </div>

    ${pending.length ? `
    <div class="card">
      <div class="card-head"><h2>승인 대기 중인 앱</h2><span class="badge">${pending.length}</span></div>
      <p class="sub" style="margin-top:-4px">새로 설치된 앱은 승인하기 전까지 사용할 수 없어요.</p>
      ${pending.map((a) => `
        <div class="row">
          ${avatar(a.label, a.pkg)}
          <div class="grow"><div class="row-title ellipsis">${esc(a.label)}</div><div class="sub ellipsis">${esc(a.pkg)}</div></div>
          ${pendingCmd.has(`approve:${a.pkg}`) || pendingCmd.has(`uninstall:${a.pkg}`)
            ? '<span class="sub">처리 중…</span>'
            : `<button class="btn primary small" data-approve="${esc(a.pkg)}">승인</button><button class="btn danger small" data-uninstall="${esc(a.pkg)}">삭제</button>`}
        </div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="card-head"><h2>많이 쓴 앱</h2><button class="link" data-tab="activity">전체 보기</button></div>
      ${usageList(s.usage || [], 5)}
    </div>

    ${devEvents.length ? `
    <div class="card">
      <div class="card-head"><h2>최근 알림</h2><button class="link" data-clear-events="device">비우기</button><button class="link" data-tab="activity">전체 보기</button></div>
      ${devEvents.map(eventRow).join('')}
    </div>` : ''}

    <div class="btns">
      ${s.ringing
        ? '<button class="btn danger" data-ring="stop">🔕 소리 끄기</button>'
        : '<button class="btn soft" data-ring="start">🔔 소리 울리기</button>'}
      <button class="btn" id="lockNow">화면 끄기</button>
    </div>
    <p class="sub center">소리 울리기: 무음이어도 30초 동안 "삐빅" 소리가 나요. 화면 끄기: 화면만 꺼요 (계속 막으려면 '잠금' 모드).</p>`;
}

// ───────── 위치 ─────────

function saveMapView() {
  if (!map) return;
  state.mapView = { deviceId: state.deviceId, day: state.locDay || 0, center: map.getCenter(), zoom: map.getZoom() };
  map.remove();
  map = null;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loadLeaflet.p) return loadLeaflet.p;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  document.head.append(css);
  loadLeaflet.p = new Promise((resolve, reject) => {
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { loadLeaflet.p = null; reject(new Error('지도 라이브러리를 불러오지 못했습니다')); };
    document.head.append(js);
  });
  return loadLeaflet.p;
}

const DAY_MS = 24 * 3600000;
const LOC_DAYS = 35;

// offset일 전의 [자정, 다음 자정)
function locDayRange(offset) {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - offset);
  return [t.getTime(), t.getTime() + DAY_MS];
}
function locDayLabel(offset) {
  if (offset === 0) return '오늘';
  if (offset === 1) return '어제';
  const t = new Date(locDayRange(offset)[0]);
  return `${t.getMonth() + 1}/${t.getDate()}(${'일월화수목금토'[t.getDay()]})`;
}
const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

// 지난 기록(이동 경로, 사용 패턴)은 서버가 아니라 자녀 폰에 있다.
// 폰에 'history' 명령으로 요청하고, 응답을 받는 즉시 take_history가 서버에서 지운다.
const historyInflight = new Map();
function requestHistory(d, payload) {
  if (!isOnline(d)) {
    return Promise.reject(new Error(`폰이 꺼져 있거나 인터넷에 연결되어 있지 않아 기록을 가져올 수 없어요. (마지막 연결 ${ago(d.last_seen)})`));
  }
  const key = d.id + JSON.stringify(payload);
  if (historyInflight.has(key)) return historyInflight.get(key);
  const p = (async () => {
    const { data, error } = await sb.from('commands')
      .insert({ device_id: d.id, type: 'history', payload, created_by: state.session.user.id }).select('id').single();
    if (error) throw new Error(error.message);
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: res, error: e2 } = await sb.rpc('take_history', { command_id: data.id });
      if (e2) throw new Error(e2.message);
      if (res != null) {
        if (!String(res).startsWith('{')) throw new Error(`폰이 기록을 보내지 못했어요 (${res})`);
        return JSON.parse(res);
      }
    }
    throw new Error('폰이 응답하지 않아요. 폰이 잠들어 있으면 늦을 수 있어요. 잠시 후 다시 열어 주세요.');
  })().finally(() => historyInflight.delete(key));
  historyInflight.set(key, p);
  return p;
}

const localDate = (t) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/** offset일 전 하루치 위치 (오래된 것 → 최근). 지난 날은 바뀌지 않으므로 계속 캐시한다. */
async function loadLocations(d, offset = 0) {
  const key = `${d.id}:${offset}`;
  const cached = state.locations[key];
  if (cached && (offset > 0 || Date.now() - cached.at < 60000)) return cached.list;
  let list;
  try {
    const res = await requestHistory(d, { kind: 'locations', day: localDate(locDayRange(offset)[0]) });
    list = res.points || [];
  } catch (e) {
    if (offset !== 0) throw e;
    list = await loadRecentFromServer(d);
    if (!list.length) throw e;
  }
  state.locations[key] = { at: Date.now(), list };
  return list;
}

/** 비상용: 서버에 남아 있는 마지막 12시간 위치 (폰이 꺼져도 남아 있다) */
async function loadRecentFromServer(d) {
  const rows = await run(sb.from('recent_locations').select('lat,lng,accuracy,source,captured_at')
    .eq('device_id', d.id).order('captured_at', { ascending: true }).limit(500));
  rows.fromServer = true;
  return rows;
}

function meters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`);

/**
 * 하루 위치에서 '머문 곳'과 이동 거리를 뽑는다.
 * 머문 곳: 약 150m(또는 그 지점의 오차) 안에 연속으로 있었고 10분 이상 + 기록 2개 이상.
 * 이동 거리: 오차보다 크게 움직인 구간만 더한다 (제자리 오차로 거리가 쌓이지 않게).
 */
function analyzeDay(points) {
  const pts = points.filter((p) => (p.accuracy ?? 0) <= 300).map((p) => ({ ...p, t: new Date(p.captured_at).getTime() }));
  const clusters = [];
  let cur = null;
  for (const p of pts) {
    if (cur && meters(cur, p) <= Math.max(150, p.accuracy || 0)) {
      cur.n++;
      cur.lat += (p.lat - cur.lat) / cur.n;
      cur.lng += (p.lng - cur.lng) / cur.n;
      cur.end = p.t;
    } else {
      if (cur) clusters.push(cur);
      cur = { lat: p.lat, lng: p.lng, start: p.t, end: p.t, n: 1 };
    }
  }
  if (cur) clusters.push(cur);
  const stays = clusters.filter((c) => c.n >= 2 && c.end - c.start >= 10 * 60000);
  let distance = 0;
  let prev = null;
  for (const p of pts) {
    if (prev) {
      const m = meters(prev, p);
      if (m > Math.max(prev.accuracy || 0, p.accuracy || 0, 50)) { distance += m; prev = p; }
    } else prev = p;
  }
  return { pts, stays, distance };
}

const addrCache = new Map();
async function address(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (addrCache.has(key)) return addrCache.get(key);
  // 오픈스트리트맵 Nominatim (가끔만 호출, 결과는 캐시)
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=ko&lat=${lat}&lon=${lng}`);
  const j = await r.json();
  const a = j.address || {};
  const text = [a.city || a.county || a.state, a.borough || a.city_district || a.suburb, a.quarter || a.neighbourhood || a.village, a.road, a.amenity || a.building]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' ') || j.display_name || '';
  addrCache.set(key, text);
  return text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * '지금 위치 확인': 폰이 지금 위치를 새로 측정해 저장하고, 끝나면 지도를 그 위치로 옮긴다.
 * (좌표는 명령 결과에 담지 않는다. 폰이 끝나자마자 보고하는 상태의 '마지막 위치'로 받는다)
 */
async function locateNow(d) {
  if (state.locating) return;
  const requestedAt = Date.now();
  state.locating = d.id;
  render();
  try {
    const { data, error } = await sb.from('commands')
      .insert({ device_id: d.id, type: 'locate', payload: {}, created_by: state.session.user.id }).select('id').single();
    if (error) throw new Error(error.message);
    let result = null;
    const until = Date.now() + 75000;
    while (Date.now() < until) {
      await sleep(2000);
      const { data: c } = await sb.from('commands').select('done_at,result').eq('id', data.id).single();
      if (c?.done_at) { result = c.result || ''; break; }
    }
    if (result == null) {
      throw new Error(isOnline(d)
        ? '폰이 아직 응답하지 않아요. 폰이 잠들어 있으면 몇 분 걸릴 수 있어요. 응답하면 지도에 표시됩니다.'
        : '폰이 오프라인이에요. 연결되면 바로 위치를 확인합니다.');
    }
    if (!result.startsWith('현재 위치 확인')) throw new Error(result);
    // 폰은 명령을 끝낸 직후 새 위치가 담긴 상태를 보고한다
    for (let i = 0; i < 6; i++) {
      await loadDevices();
      const nd = state.devices.find((x) => x.id === d.id);
      if ((nd?.state?.location?.at || 0) >= requestedAt - 60000) break;
      await sleep(1500);
    }
    delete state.locations[`${d.id}:0`];
    state.locDay = 0;
    state.mapView = null;
    toast(`지금 위치를 확인했어요 · ${result.replace('현재 위치 확인 ', '')}`);
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    state.locating = null;
    render();
  }
}

function tabLocation(d, s, p) {
  const last = s.location;
  const day = state.locDay || 0;
  const pendingLocate = state.commands.some((c) => c.device_id === d.id && c.type === 'locate' && !c.done_at);
  const [minDate, maxDate] = [locDayRange(LOC_DAYS - 1)[0], locDayRange(0)[0]].map((t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const selDate = new Date(locDayRange(day)[0] - new Date(locDayRange(day)[0]).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `
    <div class="chips day-chips" style="margin:0 0 10px">
      ${Array.from({ length: 7 }, (_, i) => `<button class="chip ${i === day ? 'sel' : ''}" data-locday="${i}">${esc(locDayLabel(i))}</button>`).join('')}
      <input type="date" id="locDate" value="${selDate}" min="${minDate}" max="${maxDate}" aria-label="날짜 선택" class="chip date-chip ${day >= 7 ? 'sel' : ''}">
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div id="map" class="map"><div class="map-empty">폰에서 기록을 가져오는 중…</div></div>
      <div style="padding:16px 18px">
        ${day === 0 ? `
        <div class="row" style="min-height:0;padding:0 0 10px">
          <div class="grow">
            <div class="row-title" id="addr">${last ? '주소 확인 중…' : '아직 위치 기록이 없어요'}</div>
            <div class="sub">${last ? `${esc(ago(new Date(last.at).toISOString()))} · 오차 약 ${Math.round(last.accuracy)}m` : '폰이 위치를 보내면 여기에 표시됩니다.'}</div>
          </div>
        </div>
        <button class="btn primary full" id="locate" ${pendingLocate || state.locating ? 'disabled' : ''}>${state.locating === d.id ? '📡 지금 위치를 찾는 중… (최대 30초)' : pendingLocate ? '폰에 위치를 요청하는 중…' : '📍 지금 위치 확인'}</button>
        <button class="btn soft full" data-ring="${s.ringing ? 'stop' : 'start'}" style="margin-top:8px">${s.ringing ? '🔕 소리 끄기' : '🔔 소리 울리기 (30초)'}</button>
        <p class="sub" style="margin:8px 0 0">폰이 오래 잠들어 있으면 응답까지 몇 분 걸릴 수 있어요.</p>` : `
        <div class="row-title">${esc(locDayLabel(day))} 이동 경로</div>
        <div class="sub" id="daySummary">불러오는 중…</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${esc(locDayLabel(day))} 타임라인</h2><span class="sub" id="dayDistance"></span></div>
      <div id="locList"><div class="empty">폰에서 기록을 가져오는 중…</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>위치 기록</h2></div>
      <div class="row">
        <div class="grow sub">정기적으로 위치를 기록합니다. 지난 이동 경로는 서버가 아니라 <b>따님 폰에 ${LOC_DAYS}일</b> 보관되고, 볼 때마다 폰에서 가져와요.</div>
        <select id="locInterval" aria-label="위치 기록 간격">${LOCATION_INTERVALS.map(([v, t]) => `<option value="${v}" ${v === p.locationIntervalMin ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      ${s.locationPermission === false ? '<div class="banner warn" style="margin:8px 0 0"><div class="grow"><strong>폰에 위치 권한이 없어요</strong>폰 앱을 최신 버전으로 업데이트해 주세요.</div></div>' : ''}
    </div>`;
}

// 주소는 차례대로 1초 간격으로 묻는다 (Nominatim 사용 정책)
async function fillAddresses(items) {
  for (const { el, lat, lng } of items) {
    if (!el.isConnected) return;
    try { el.textContent = (await address(lat, lng)) || '주소를 찾지 못했어요'; } catch { el.textContent = '주소를 찾지 못했어요'; }
    await new Promise((r) => setTimeout(r, 1100));
  }
}

async function showMap(d) {
  const day = state.locDay || 0;
  let L, list;
  try {
    [L, list] = await Promise.all([loadLeaflet(), loadLocations(d, day)]);
  } catch (e) {
    const msg = esc(e.message || e);
    const m = document.querySelector('#map .map-empty'); if (m) m.innerHTML = msg;
    const l = document.getElementById('locList'); if (l) l.innerHTML = `<div class="empty">${msg}</div>`;
    const sm = document.getElementById('daySummary'); if (sm) sm.textContent = '기록을 가져오지 못했어요';
    return;
  }
  const el = document.getElementById('map');
  if (!el || state.tab !== 'location' || state.deviceId !== d.id || (state.locDay || 0) !== day) return;
  el.innerHTML = '';
  const { pts, stays, distance } = analyzeDay(list);
  const fromServer = !!list.fromServer;

  // 타임라인
  const listEl = document.getElementById('locList');
  const distEl = document.getElementById('dayDistance');
  if (distEl) distEl.textContent = pts.length ? `이동 거리 약 ${fmtKm(distance)}` : '';
  const sumEl = document.getElementById('daySummary');
  if (sumEl) sumEl.textContent = pts.length ? `기록 ${pts.length}개 · 머문 곳 ${stays.length}곳 · 이동 약 ${fmtKm(distance)}` : '이 날은 위치 기록이 없어요.';
  if (listEl) {
    if (!pts.length) listEl.innerHTML = '<div class="empty">이 날은 위치 기록이 없어요.</div>';
    else if (fromServer && !stays.length) listEl.innerHTML = '';
    else if (!stays.length) listEl.innerHTML = `<div class="empty">10분 넘게 머문 곳이 없어요. (${hhmm(pts[0].t)} ~ ${hhmm(pts[pts.length - 1].t)} 기록)</div>`;
    else {
      const lastPt = pts[pts.length - 1];
      listEl.innerHTML = stays.map((st, i) => {
        const ongoing = day === 0 && i === stays.length - 1 && st.end === lastPt.t && Date.now() - st.end < 30 * 60000;
        const move = i > 0 ? `<div class="move-row">↓ 이동 약 ${fmtKm(meters(stays[i - 1], st))}</div>` : '';
        return `${move}
          <div class="row stay">
            <span class="stay-no">${i + 1}</span>
            <div class="grow">
              <div class="row-title">${hhmm(st.start)} ~ ${ongoing ? '지금' : hhmm(st.end)} <span class="sub">(${fmtDuration((ongoing ? Date.now() : st.end) - st.start)})</span></div>
              <div class="sub ellipsis" data-stay="${i}">주소 확인 중…</div>
            </div>
          </div>`;
      }).join('');
    }
  }

  if (fromServer && listEl) {
    const lastT = pts.length ? pts[pts.length - 1].t : null;
    listEl.insertAdjacentHTML('afterbegin', `<div class="banner warn" style="margin:0 0 10px"><div class="grow">
      <strong>폰이 꺼져 있거나 연결이 끊겼어요</strong>
      서버에 남아 있는 <b>마지막 12시간</b> 기록을 보여드려요.${lastT ? ` 마지막 위치: ${esc(new Date(lastT).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} (${esc(ago(new Date(lastT).toISOString()))})` : ''}
    </div></div>`);
    if (stays.length === 0 && pts.length) listEl.insertAdjacentHTML('beforeend', `<div class="empty">${hhmm(pts[0].t)} ~ ${hhmm(pts[pts.length - 1].t)} 기록 ${pts.length}개</div>`);
  }

  // 지도
  const latest = pts[pts.length - 1] || (day === 0 && d.state?.location ? { lat: d.state.location.lat, lng: d.state.location.lng, accuracy: d.state.location.accuracy } : null);
  map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  if (!latest) {
    map.setView([36.5, 127.8], 7);
    return;
  }
  const path = pts.map((l) => [l.lat, l.lng]);
  if (path.length > 1) L.polyline(path, { color: '#3a7bf0', weight: 4, opacity: 0.6 }).addTo(map);
  pts.forEach((l) => L.circleMarker([l.lat, l.lng], { radius: 3, color: '#3a7bf0', weight: 1, fillOpacity: 0.5 }).addTo(map));
  stays.forEach((st, i) => L.marker([st.lat, st.lng], {
    icon: L.divIcon({ className: '', html: `<div class="stay-pin">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
  }).bindTooltip(`${hhmm(st.start)} ~ ${hhmm(st.end)}`).addTo(map));
  if (day === 0) {
    L.circle([latest.lat, latest.lng], { radius: latest.accuracy || 50, color: '#3a7bf0', weight: 1, fillOpacity: 0.12 }).addTo(map);
    L.marker([latest.lat, latest.lng], {
      icon: L.divIcon({ className: '', html: '<div class="me-pin"><img src="icon-192.png" alt=""></div>', iconSize: [44, 44], iconAnchor: [22, 22] }),
    }).addTo(map);
  }
  const mv = state.mapView;
  if (mv && mv.deviceId === d.id && mv.day === day) map.setView(mv.center, mv.zoom);
  else if (day === 0) map.setView([latest.lat, latest.lng], 16);
  else if (path.length > 1) map.fitBounds(L.latLngBounds(path), { padding: [30, 30], maxZoom: 16 });
  else map.setView([latest.lat, latest.lng], 16);

  const items = [];
  if (day === 0) { const a = document.getElementById('addr'); if (a) items.push({ el: a, lat: latest.lat, lng: latest.lng }); }
  stays.forEach((st, i) => { const e = document.querySelector(`[data-stay="${i}"]`); if (e) items.push({ el: e, lat: st.lat, lng: st.lng }); });
  fillAddresses(items);
}

function tabLimits(d, s, p) {
  const services = s.services?.length ? s.services : FALLBACK_SERVICES;
  const apps = new Map((s.apps || []).map((a) => [a.pkg, a.label]));
  Object.keys(p.dailyLimitsMin).forEach((pkg) => { if (!apps.has(pkg)) apps.set(pkg, pkg); });
  const appList = [...apps.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  return `
    <div class="card">
      <div class="card-head"><h2>하루 전체 사용 한도</h2></div>
      <div class="row">
        <div class="grow sub">한도를 다 쓰면 '항상 허용' 앱과 전화·문자만 쓸 수 있어요. 5분 전에 아이에게 알려 줍니다.</div>
        <select id="totalLimit" aria-label="하루 전체 사용 한도">${TOTAL_LIMITS.map(([v, t]) => `<option value="${v ?? ''}" ${v === (p.totalDailyLimitMin ?? null) ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      <div class="row">
        <div class="grow"><div class="row-title">모바일 데이터 기준일</div><div class="sub">요금제가 갱신되는 날로 맞추면 '이번 달' 사용량이 정확해요.</div></div>
        <select id="dataCycleDay" aria-label="모바일 데이터 기준일">${Array.from({ length: 28 }, (_, i) => i + 1).map((v) => `<option value="${v}" ${v === p.dataCycleDay ? 'selected' : ''}>매월 ${v}일</option>`).join('')}</select>
      </div>
      <div class="row">
        <div class="grow"><div class="row-title">초기화 시각</div><div class="sub">하루 한도·앱별 한도·사용시간이 이 시각에 새로 시작돼요.</div></div>
        <select id="resetMin" aria-label="초기화 시각">${RESET_TIMES.map(([v, t]) => `<option value="${v}" ${v === p.resetMin ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>취침시간</h2></div>
      ${sw('bedtime', p.bedtimeEnabled, '취침시간 사용', '이 시간에는 \'항상 허용\' 앱과 전화·문자만 사용')}
      <div class="row"><div class="grow">시작</div><input type="time" id="bedStart" value="${toClock(p.bedtimeStartMin)}"></div>
      <div class="row"><div class="grow">종료</div><input type="time" id="bedEnd" value="${toClock(p.bedtimeEndMin)}"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>차단</h2></div>
      ${sw('familyFilter', p.familyFilter, '유해사이트 차단', '성인·도박·악성 사이트, 구글 세이프서치 강제')}
      ${services.map((sv) => sw(`svc-${esc(sv.id)}`, p.blockedServices.includes(sv.id), `${esc(sv.label)} 항상 차단`,
        esc(SERVICE_DESC[sv.id] || '앱과 웹 주소를 함께 차단합니다'))).join('')}
    </div>

    <div class="card">
      <div class="card-head"><h2>앱별 한도</h2><span class="sub">${appList.length}개</span></div>
      <p class="sub" style="margin-top:-4px">☑ 항상 허용: 취침시간과 하루 전체 한도에서 빠집니다 (학원앱, 사전 등).</p>
      ${appList.length ? `
      <div class="bulk">
        <div class="btns">
          <button class="btn small" data-bulk="check-all">☑ 전체 체크</button>
          <button class="btn small" data-bulk="uncheck-all">☐ 전체 해제</button>
        </div>
        <div class="row" style="border:0">
          <select id="bulkLimit" aria-label="일괄 적용할 한도">${APP_LIMITS.map(([v, t]) => `<option value="${v ?? ''}">${t}</option>`).join('')}</select>
          <button class="btn small primary" data-bulk="apply" style="flex:1">모든 앱에 적용</button>
        </div>
        <div class="sub">체크한 앱(항상 허용)은 일괄 적용에서 빠집니다. '제한 없음'을 고르면 모든 한도를 풉니다.</div>
        <input type="search" id="appSearch" placeholder="앱 이름 검색" value="${esc(state.appSearch || '')}" autocomplete="off">
      </div>` : ''}
      ${appList.length ? appList.map(([pkg, label]) => {
        const lim = p.dailyLimitsMin[pkg] ?? null;
        const q = (state.appSearch || '').trim().toLowerCase();
        const hidden = q && !label.toLowerCase().includes(q) && !pkg.toLowerCase().includes(q);
        return `<div class="row" data-app-row="${esc(`${label} ${pkg}`.toLowerCase())}" ${hidden ? 'hidden' : ''}>
          <input type="checkbox" class="check" data-allow="${esc(pkg)}" ${p.alwaysAllowed.includes(pkg) ? 'checked' : ''} aria-label="${esc(label)} 항상 허용">
          ${avatar(label, pkg)}
          <div class="grow ellipsis">${esc(label)}</div>
          <select data-limit="${esc(pkg)}" aria-label="${esc(label)} 하루 한도">${APP_LIMITS.map(([v, t]) => `<option value="${v ?? ''}" ${v === lim ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>`;
      }).join('') : '<div class="empty">폰에서 앱 목록을 아직 받지 못했습니다.</div>'}
    </div>`;
}


// ───────── 사용 패턴 · 모바일 데이터 ─────────
// 색: dataviz 기본 팔레트의 범주색 1~5번(고정 순서, 검증 통과) + 회색 '기타'. 히트맵은 파랑 한 가지의 진하기.

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const OTHER = 'var(--series-other)';
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const fmtMinutes = (ms) => (ms > 0 && ms < 60000 ? '1분 미만' : fmtDuration(ms));

function fmtBytes(b) {
  if (!b) return '0MB';
  if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)}GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)}MB`;
  return `${Math.max(1, Math.round(b / 1e3))}KB`;
}

async function loadUsageDays(d) {
  state.usageDays = state.usageDays || {};
  const c = state.usageDays[d.id];
  if (c && Date.now() - c.at < 120000) return c.list;
  const res = await requestHistory(d, { kind: 'usage', days: 7 });
  const list = res.days || [];
  state.usageDays[d.id] = { at: Date.now(), list };
  return list;
}

function dayLabel(dayStart, i) {
  if (i === 0) return '오늘';
  if (i === 1) return '어제';
  const t = new Date(dayStart);
  return `${t.getMonth() + 1}/${t.getDate()}(${WEEKDAY[t.getDay()]})`;
}
const hourOf = (dayStart, i) => (new Date(dayStart).getHours() + i) % 24;
const hourName = (h) => `${h}시`;

function dataCard(s) {
  const m = s.mobileData;
  if (!m) return '';
  const since = new Date(m.cycleStart);
  const apps = m.apps || [];
  const max = Math.max(...apps.map((a) => a.bytes), 1);
  return `
    <div class="card">
      <div class="card-head"><h2>📶 모바일 데이터</h2><span class="sub">${since.getMonth() + 1}/${since.getDate()}부터</span></div>
      <div class="stat-row">
        <div><div class="sub">이번 달</div><div class="stat-big">${fmtBytes(m.monthBytes)}</div></div>
        <div><div class="sub">오늘</div><div class="stat-big">${fmtBytes(m.todayBytes)}</div></div>
      </div>
      <p class="sub" style="margin:6px 0 4px">와이파이는 빼고 모바일 데이터만 셉니다. 기준일은 '제한' 탭에서 바꿀 수 있어요.</p>
      ${apps.length ? apps.slice(0, 8).map((a) => `
        <div class="row">
          ${avatar(a.label, a.pkg)}
          <div class="grow">
            <div style="display:flex;gap:8px"><span class="ellipsis" style="flex:1">${esc(a.label)}</span><span class="sub">${fmtBytes(a.bytes)}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (a.bytes / max) * 100)}%"></div></div>
          </div>
        </div>`).join('') : '<div class="empty">이번 달 모바일 데이터 사용이 거의 없어요.</div>'}
    </div>`;
}

function patternPlaceholders() {
  return `
    <div class="card viz" id="hourCard"><div class="card-head"><h2>시간대별 사용</h2></div><div class="empty">폰에서 기록을 가져오는 중…</div></div>
    <div class="card viz" id="weekCard"><div class="card-head"><h2>최근 7일 패턴</h2></div><div class="empty">폰에서 기록을 가져오는 중…</div></div>`;
}

// 툴팁: 카드 안 절대 위치 div 하나를 재사용한다
function showTip(card, html, evt) {
  let tip = card.querySelector('.viz-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    card.append(tip);
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = card.getBoundingClientRect();
  const x = (evt.clientX ?? r.left + r.width / 2) - r.left;
  const y = (evt.clientY ?? r.top) - r.top;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(8, x - w / 2), r.width - w - 8)}px`;
  tip.style.top = `${Math.max(8, y - tip.offsetHeight - 14)}px`;
}
function hideTip(card) { const t = card.querySelector('.viz-tip'); if (t) t.hidden = true; }

function renderHourChart(card, days, idx) {
  const day = days[idx];
  const data = day.data;
  const hours = data.hours || [];
  const labels = Object.fromEntries(Object.entries(data.apps || {}).map(([k, v]) => [k, v.label]));
  // 그날 많이 쓴 앱 5개에 색을 고정 배정 (순위가 아니라 앱에 색이 붙는다)
  const top = Object.entries(data.apps || {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([k]) => k);
  const colorOf = (pkg) => (top.includes(pkg) ? SERIES[top.indexOf(pkg)] : OTHER);
  const stacks = hours.map((h) => {
    const segs = top.map((pkg) => ({ pkg, ms: h.a?.[pkg] || 0 })).filter((x) => x.ms > 0);
    const known = segs.reduce((n, x) => n + x.ms, 0);
    const other = Math.max(0, Object.values(h.a || {}).reduce((n, v) => n + v, 0) - known);
    if (other > 0) segs.push({ pkg: '__other', ms: other });
    return segs;
  });
  const maxMin = Math.max(60, ...stacks.map((st) => st.reduce((n, x) => n + x.ms, 0) / 60000));
  const W = 360, H = 190, L = 30, B = 22, T = 8, plotW = W - L - 4, plotH = H - B - T;
  const band = plotW / 24, bw = Math.max(4, band - 3);
  const y = (min) => T + plotH - (min / maxMin) * plotH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(dayLabel(day.day_start, idx))} 시간대별 사용">`;
  [0, 30, 60].forEach((m) => {
    svg += `<line x1="${L}" x2="${W - 4}" y1="${y(m)}" y2="${y(m)}" class="grid"/><text x="${L - 6}" y="${y(m) + 4}" class="axis" text-anchor="end">${m}분</text>`;
  });
  stacks.forEach((st, i) => {
    const x = L + i * band + (band - bw) / 2;
    let acc = 0;
    st.forEach((seg, j) => {
      const m = seg.ms / 60000;
      const y1 = y(acc + m), y0 = y(acc);
      const h = Math.max(0, y0 - y1 - (j < st.length - 1 ? 2 : 0)); // 조각 사이 2px 간격
      if (h > 0.3) svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" rx="${j === st.length - 1 ? 2 : 0}" fill="${seg.pkg === '__other' ? OTHER : colorOf(seg.pkg)}"/>`;
      acc += m;
    });
    if (i % 3 === 0) svg += `<text x="${L + i * band + band / 2}" y="${H - 6}" class="axis" text-anchor="middle">${hourOf(day.day_start, i)}시</text>`;
    svg += `<rect class="hit" data-h="${i}" x="${L + i * band}" y="${T}" width="${band}" height="${plotH}"/>`;
  });
  svg += '</svg>';

  const totals = Object.entries(data.apps || {}).sort((a, b) => b[1].ms - a[1].ms);
  card.innerHTML = `
    <div class="card-head"><h2>시간대별 사용</h2><span class="sub">${fmtDuration(data.screenMs)}</span></div>
    <div class="chips day-chips">${days.map((dd, i) => `<button class="chip ${i === idx ? 'sel' : ''}" data-day="${i}">${esc(dayLabel(dd.day_start, i))}</button>`).join('')}</div>
    ${svg}
    <div class="legend">
      ${top.map((pkg, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(labels[pkg] || pkg)}</span>`).join('')}
      ${stacks.some((st) => st.some((x) => x.pkg === '__other')) ? `<span><i style="background:${OTHER}"></i>기타</span>` : ''}
    </div>
    <p class="sub" style="margin:4px 0 8px">막대를 누르면 그 시간에 쓴 앱이 보여요.</p>
    ${totals.slice(0, 8).map(([pkg, v]) => `<div class="row"><span class="swatch" style="background:${colorOf(pkg)}"></span><div class="grow ellipsis">${esc(v.label)}</div><span class="sub">${fmtMinutes(v.ms)}</span></div>`).join('') || '<div class="empty">이 날은 사용 기록이 없어요.</div>'}`;

  card.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    state.patternDay = Number(b.dataset.day);
    renderHourChart(card, days, state.patternDay);
  }));
  const tipFor = (e) => {
    const i = Number(e.currentTarget.dataset.h);
    const st = stacks[i];
    const total = (hours[i]?.s || 0);
    const rows = st.slice().sort((a, b) => b.ms - a.ms).map((seg) => `<div><i style="background:${seg.pkg === '__other' ? OTHER : colorOf(seg.pkg)}"></i>${esc(seg.pkg === '__other' ? '기타' : labels[seg.pkg] || seg.pkg)} <b>${fmtMinutes(seg.ms)}</b></div>`).join('');
    showTip(card, `<strong>${hourOf(day.day_start, i)}시~${(hourOf(day.day_start, i) + 1) % 24}시 · ${fmtDuration(total)}</strong>${rows || '<div>사용 없음</div>'}`, e);
  };
  card.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('pointerenter', tipFor);
    r.addEventListener('click', tipFor);
  });
  card.querySelector('svg').addEventListener('pointerleave', () => hideTip(card));
}

function renderWeek(card, days) {
  const list = days.slice().reverse(); // 오래된 날 → 최근
  const W = 360, L = 58, cell = (W - L - 4) / 24, ch = 18, gap = 2;
  const bucket = (ms) => { const m = ms / 60000; return m <= 0 ? 0 : m < 10 ? 1 : m < 20 ? 2 : m < 40 ? 3 : 4; };
  const H = list.length * (ch + gap) + 24;
  // 시간대별 합계로 '주로 쓰는 시간'과 '늦은 밤 사용'을 계산
  const byHour = Array(24).fill(0);
  let night = 0;
  list.forEach((dd) => (dd.data.hours || []).forEach((h, i) => {
    const hh = hourOf(dd.day_start, i);
    byHour[hh] += h.s || 0;
    if (hh >= 23 || hh < 7) night += h.s || 0;
  }));
  let best = 0;
  for (let h = 0; h < 24; h++) if (byHour[h] + byHour[(h + 1) % 24] > byHour[best] + byHour[(best + 1) % 24]) best = h;
  const totalWeek = list.reduce((n, dd) => n + (dd.data.screenMs || 0), 0);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="최근 7일 시간대별 사용 히트맵">`;
  list.forEach((dd, r) => {
    const yy = r * (ch + gap);
    const i0 = days.indexOf(dd);
    svg += `<text x="${L - 6}" y="${yy + ch - 5}" class="axis" text-anchor="end">${esc(dayLabel(dd.day_start, i0))}</text>`;
    (dd.data.hours || []).forEach((h, i) => {
      svg += `<rect class="cell" data-r="${r}" data-h="${i}" x="${L + i * cell}" y="${yy}" width="${cell - gap}" height="${ch}" rx="3" fill="var(--seq-${bucket(h.s || 0)})"/>`;
    });
  });
  const firstStartHour = list.length ? new Date(list[0].day_start).getHours() : 7;
  for (let i = 0; i < 24; i += 3) svg += `<text x="${L + i * cell + cell / 2}" y="${H - 6}" class="axis" text-anchor="middle">${(firstStartHour + i) % 24}시</text>`;
  svg += '</svg>';

  const maxDay = Math.max(...list.map((dd) => dd.data.screenMs || 0), 1);
  card.innerHTML = `
    <div class="card-head"><h2>최근 7일 패턴</h2></div>
    <div class="stat-row">
      <div><div class="sub">하루 평균</div><div class="stat-big">${fmtDuration(totalWeek / Math.max(1, list.length))}</div></div>
      <div><div class="sub">주로 쓰는 시간</div><div class="stat-big">${totalWeek ? `${best}~${(best + 2) % 24}시` : '-'}</div></div>
      <div><div class="sub">밤 11시~아침 7시</div><div class="stat-big">${fmtDuration(night)}</div></div>
    </div>
    ${svg}
    <div class="legend heat-legend"><span>적음</span>${[1, 2, 3, 4].map((k) => `<i style="background:var(--seq-${k})"></i>`).join('')}<span>많음 (시간당 40분+)</span></div>
    <div class="section-label" style="margin:14px 0 6px">하루 총 사용시간</div>
    ${list.slice().reverse().map((dd) => `
      <div class="row" style="min-height:40px">
        <div style="width:64px" class="sub">${esc(dayLabel(dd.day_start, days.indexOf(dd)))}</div>
        <div class="grow"><div class="bar-track" style="height:10px;margin:0"><div class="bar-fill" style="width:${Math.max(1, ((dd.data.screenMs || 0) / maxDay) * 100)}%"></div></div></div>
        <div class="sub" style="width:70px;text-align:right">${fmtDuration(dd.data.screenMs)}</div>
      </div>`).join('')}
    ${list.length < 7 ? `<p class="sub" style="margin:8px 0 0">기록이 쌓이는 중이에요 (${list.length}일). 일주일이 지나면 패턴이 더 잘 보여요.</p>` : ''}`;

  const tip = (e) => {
    const r = Number(e.currentTarget.dataset.r), i = Number(e.currentTarget.dataset.h);
    const dd = list[r];
    const h = dd.data.hours?.[i] || {};
    const labels = Object.fromEntries(Object.entries(dd.data.apps || {}).map(([k, v]) => [k, v.label]));
    const apps = Object.entries(h.a || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([pkg, ms]) => `<div>${esc(labels[pkg] || pkg)} <b>${fmtDuration(ms)}</b></div>`).join('');
    showTip(card, `<strong>${esc(dayLabel(dd.day_start, days.indexOf(dd)))} ${hourOf(dd.day_start, i)}시 · ${fmtDuration(h.s || 0)}</strong>${apps}`, e);
  };
  card.querySelectorAll('.cell').forEach((c) => { c.addEventListener('pointerenter', tip); c.addEventListener('click', tip); });
  card.querySelector('svg').addEventListener('pointerleave', () => hideTip(card));
}

async function showPatterns(d) {
  let days;
  try {
    days = await loadUsageDays(d);
  } catch (e) {
    const h = document.getElementById('hourCard');
    if (h) h.innerHTML = `<div class="card-head"><h2>시간대별 사용</h2></div><div class="empty">${esc(e.message || e)}</div>`;
    document.getElementById('weekCard')?.remove();
    return;
  }
  const hourCard = document.getElementById('hourCard');
  const weekCard = document.getElementById('weekCard');
  if (!hourCard || state.tab !== 'activity' || state.deviceId !== d.id) return;
  if (!days.length) {
    hourCard.innerHTML = '<div class="card-head"><h2>시간대별 사용</h2></div><div class="empty">아직 기록이 없어요. 따님 폰에 5분마다 쌓입니다.</div>';
    weekCard.remove();
    return;
  }
  renderHourChart(hourCard, days, Math.min(state.patternDay || 0, days.length - 1));
  renderWeek(weekCard, days);
}

// 방문한 사이트: 폰의 인터넷 필터가 본 사이트 이름 (검색어·페이지 주소는 알 수 없음). 기록은 폰에 있다.
const BROWSERS = new Set(['com.android.chrome', 'com.sec.android.app.sbrowser', 'org.mozilla.firefox', 'com.naver.whale', 'com.microsoft.emmx', 'com.opera.browser', 'com.brave.browser', 'com.duckduckgo.mobile.android']);
const SITES_SHOWN = 60;

function sitesCard() {
  const day = state.siteDay || 0;
  const only = state.siteBrowserOnly !== false;
  return `
    <div class="card" id="sitesCard">
      <div class="card-head"><h2>🌐 방문한 사이트</h2></div>
      <div class="chips day-chips" style="margin-top:0">
        ${Array.from({ length: 7 }, (_, i) => `<button class="chip ${i === day ? 'sel' : ''}" data-siteday="${i}">${esc(locDayLabel(i))}</button>`).join('')}
      </div>
      <div class="chips day-chips">
        <button class="chip ${only ? 'sel' : ''}" data-sitefilter="browser">브라우저</button>
        <button class="chip ${only ? '' : 'sel'}" data-sitefilter="all">모든 앱</button>
      </div>
      <p class="sub" style="margin:8px 0 4px">사이트 이름까지만 보여요. 검색어나 읽은 글은 알 수 없어요. 화면을 쓰는 동안의 접속만 기록합니다.</p>
      <div id="sitesList"><div class="empty">폰에서 기록을 가져오는 중…</div></div>
    </div>`;
}

async function loadSites(d, offset) {
  state.sites = state.sites || {};
  const key = `${d.id}:${offset}`;
  const c = state.sites[key];
  if (c && (offset > 0 || Date.now() - c.at < 60000)) return c.list;
  const res = await requestHistory(d, { kind: 'sites', day: localDate(locDayRange(offset)[0]) });
  const list = res.visits || [];
  state.sites[key] = { at: Date.now(), list };
  return list;
}

async function showSites(d) {
  const day = state.siteDay || 0;
  let list;
  try {
    list = await loadSites(d, day);
  } catch (e) {
    const el = document.getElementById('sitesList');
    const msg = String(e.message || e).includes('알 수 없는 기록') ? '폰 앱을 업데이트하면 볼 수 있어요.' : (e.message || e);
    if (el) el.innerHTML = `<div class="empty">${esc(msg)}</div>`;
    return;
  }
  const el = document.getElementById('sitesList');
  if (!el || state.tab !== 'activity' || state.deviceId !== d.id || (state.siteDay || 0) !== day) return;
  const only = state.siteBrowserOnly !== false;
  const rows = list.filter((v) => !only || BROWSERS.has(v.pkg)).sort((a, b) => b.start - a.start);
  if (!rows.length) {
    el.innerHTML = `<div class="empty">${only ? '브라우저로 연 사이트가 없어요.' : '기록이 없어요.'}</div>`;
    return;
  }
  // 많이 간 사이트
  const bySite = new Map();
  rows.forEach((v) => bySite.set(v.site, (bySite.get(v.site) || 0) + 1));
  const top = [...bySite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const shown = state.sitesAll ? rows : rows.slice(0, SITES_SHOWN);
  const span = (v) => (v.last - v.start >= 60000 ? `${hhmm(v.start)}–${hhmm(v.last)}` : hhmm(v.start));
  el.innerHTML = `
    <div class="chips" style="margin:4px 0 8px">${top.map(([site, n]) => `<span class="chip">${esc(site)} · ${n}회</span>`).join('')}</div>
    ${shown.map((v) => `
      <div class="row">
        <span class="sub" style="min-width:78px">${esc(span(v))}</span>
        <div class="grow"><div class="ellipsis">${esc(v.site)}</div><div class="sub ellipsis">${esc((v.hosts || []).filter((h) => h !== v.site && h !== `www.${v.site}`).slice(0, 3).join(', ') || ' ')}</div></div>
        <span class="sub ellipsis" style="max-width:30%">${esc(v.app)}</span>
      </div>`).join('')}
    ${rows.length > shown.length ? `<button class="btn soft full" id="sitesMore" style="margin-top:8px">${rows.length - shown.length}개 더 보기</button>` : ''}`;
  document.getElementById('sitesMore')?.addEventListener('click', () => { state.sitesAll = true; showSites(d); });
}

function tabActivity(d, s) {
  const hits = s.hits || [];
  const devEvents = state.events.filter((e) => e.device_id === d.id);
  const cmds = state.commands.filter((c) => c.device_id === d.id).slice(0, 8);
  return `
    <div class="card">
      <div class="card-head"><h2>오늘 앱 사용</h2></div>
      ${usageList(s.usage || [], 30)}
    </div>
    <div class="card">
      <div class="card-head"><h2>알림 기록</h2>${devEvents.length ? '<button class="link" data-clear-events="device">비우기</button>' : ''}</div>
      ${devEvents.length ? devEvents.map(eventRow).join('') : '<div class="empty">아직 알림이 없습니다.</div>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>오늘 차단된 접속</h2></div>
      ${hits.length ? hits.map((h) => `<div class="row">${avatar(h.app, h.app)}<div class="grow"><div class="ellipsis">${esc(h.app)}</div><div class="sub ellipsis">${esc(h.domain)}</div></div><span class="sub">${esc(h.count)}회</span></div>`).join('') : '<div class="empty">없습니다.</div>'}
    </div>
    ${sitesCard()}
    ${cmds.length ? `
    <div class="card">
      <div class="card-head"><h2>보낸 명령</h2></div>
      ${cmds.map((c) => `<div class="row"><div class="grow"><div>${esc(cmdLabel(c, d))}</div><div class="sub">${esc(ago(c.created_at))}</div></div><span class="sub">${c.done_at ? esc(c.result || '완료') : '대기 중'}</span></div>`).join('')}
    </div>` : ''}
    ${patternPlaceholders()}
    ${dataCard(s)}`;
}

function tabSettings(d, s) {
  const pushRow = {
    on: '<div class="row"><div class="grow"><div class="row-title">이 폰에서 알림 받는 중</div><div class="sub">부모 PIN 사용, PIN 5회 틀림, 하루 한도 도달</div></div><button class="btn small" data-act="push-off">끄기</button></div>',
    off: '<div class="row"><div class="grow"><div class="row-title">이 폰에서 알림 받기</div><div class="sub">부모 PIN 사용, PIN 5회 틀림, 하루 한도 도달</div></div><button class="btn primary small" data-act="push-on">켜기</button></div>',
  }[state.push] || pushBanner(false);
  return `
    <div class="card">
      <div class="card-head"><h2>알림</h2></div>
      ${pushRow}
    </div>
    <div class="card">
      <div class="card-head"><h2>폰의 부모 PIN 변경</h2></div>
      <p class="sub" style="margin-top:-4px">PIN 원문은 서버에 보내지 않고, 암호화한 값만 폰에 전달합니다.</p>
      <form id="pinForm" class="row" autocomplete="off">
        <input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" placeholder="새 PIN (숫자 4~8자리)" required style="flex:1">
        <button class="btn primary">변경</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><h2>기기 정보</h2></div>
      <div class="row"><div class="grow">마지막 보고</div><span class="sub">${esc(ago(d.last_seen))}</span></div>
      <div class="row"><div class="grow">앱 버전</div><span class="sub">${esc(s.appVersion || '-')}</span></div>
      <div class="row"><div class="grow">인터넷 필터</div><span class="sub">${s.vpn ? '작동 중' : '꺼짐'}</span></div>
      <div class="row"><div class="grow">관리 권한</div><span class="sub">${s.deviceOwner === false ? '없음' : '정상'}</span></div>
    </div>
    <div class="card">
      <button class="btn danger full" id="removeDevice">이 기기 연결 끊기</button>
      <p class="sub" style="margin-bottom:0">연결을 끊어도 폰의 제한은 그대로 남습니다. 완전히 해제하려면 폰의 부모 설정에서 '관리 해제'를 누르세요.</p>
    </div>`;
}

function bindDevice(d, s, p) {
  const q = (sel) => $app.querySelector(sel);
  // 개요
  bind('[data-mode-set]', 'click', (e) => {
    const m = e.currentTarget.dataset.modeSet;
    if (m !== p.mode) savePolicy(d, { mode: m }, `${MODES.find((x) => x.id === m).name} 모드로 바꿨습니다`);
  });
  bind('[data-clear-events]', 'click', (e) => clearEvents(e.currentTarget, d));
  bind('[data-bonus]', 'click', (e) => {
    const v = e.currentTarget.dataset.bonus;
    if (v === 'cancel') return savePolicy(d, { bonusMin: 0, bonusUntil: 0 }, '추가 시간을 취소했습니다');
    const m = Number(v);
    savePolicy(d, { bonusMin: Math.min(activeBonus(p) + m, 720), bonusUntil: nextReset(p.resetMin) },
      `${fmtDuration(m * 60000)}을 더 줬습니다 (오늘 총 +${fmtDuration((activeBonus(p) + m) * 60000)})`);
  });
  bind('[data-approve]', 'click', (e) => sendCommand(d, 'approve', { pkg: e.currentTarget.dataset.approve }, '승인했습니다'));
  bind('[data-uninstall]', 'click', (e) => sendCommand(d, 'uninstall', { pkg: e.currentTarget.dataset.uninstall }, '삭제 명령을 보냈습니다'));
  q('#lockNow')?.addEventListener('click', () => sendCommand(d, 'lock_now', {}, '화면을 껐습니다'));
  bind('[data-ring]', 'click', (e) => {
    if (e.currentTarget.dataset.ring === 'stop') sendCommand(d, 'ring_stop', {}, '소리를 끄라고 보냈습니다');
    else sendCommand(d, 'ring', { seconds: 30 }, isOnline(d) ? '폰에서 소리가 울립니다 (30초)' : '폰이 오프라인이라 연결되면 울립니다');
  });

  // 위치
  q('#locate')?.addEventListener('click', () => locateNow(d));
  q('#locInterval')?.addEventListener('change', (e) => savePolicy(d, { locationIntervalMin: Number(e.target.value) }));
  bind('[data-siteday]', 'click', (e) => { state.siteDay = Number(e.currentTarget.dataset.siteday); state.sitesAll = false; render(); });
  bind('[data-sitefilter]', 'click', (e) => { state.siteBrowserOnly = e.currentTarget.dataset.sitefilter === 'browser'; state.sitesAll = false; render(); });
  bind('[data-locday]', 'click', (e) => { state.locDay = Number(e.currentTarget.dataset.locday); state.mapView = null; render(); });
  q('#locDate')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [y, m, dd] = e.target.value.split('-').map(Number);
    const offset = Math.round((locDayRange(0)[0] - new Date(y, m - 1, dd).getTime()) / DAY_MS);
    state.locDay = Math.min(Math.max(0, offset), LOC_DAYS - 1);
    state.mapView = null;
    render();
  });

  // 제한
  q('#dataCycleDay')?.addEventListener('change', (e) => savePolicy(d, { dataCycleDay: Number(e.target.value) }));
  q('#resetMin')?.addEventListener('change', (e) => savePolicy(d, { resetMin: Number(e.target.value) }));
  q('#totalLimit')?.addEventListener('change', (e) => savePolicy(d, { totalDailyLimitMin: e.target.value === '' ? null : Number(e.target.value) }));
  q('#familyFilter')?.addEventListener('change', (e) => savePolicy(d, { familyFilter: e.target.checked }));
  (s.services?.length ? s.services : FALLBACK_SERVICES).forEach((sv) => {
    q(`#svc-${CSS.escape(sv.id)}`)?.addEventListener('change', (e) => savePolicy(d, {
      blockedServices: e.target.checked ? [...new Set([...p.blockedServices, sv.id])] : p.blockedServices.filter((x) => x !== sv.id),
    }));
  });
  q('#bedtime')?.addEventListener('change', (e) => savePolicy(d, { bedtimeEnabled: e.target.checked }));
  q('#bedStart')?.addEventListener('change', (e) => e.target.value && savePolicy(d, { bedtimeStartMin: fromClock(e.target.value) }));
  q('#bedEnd')?.addEventListener('change', (e) => e.target.value && savePolicy(d, { bedtimeEndMin: fromClock(e.target.value) }));
  bind('[data-limit]', 'change', (e) => {
    const limits = { ...p.dailyLimitsMin };
    if (e.target.value === '') delete limits[e.target.dataset.limit]; else limits[e.target.dataset.limit] = Number(e.target.value);
    savePolicy(d, { dailyLimitsMin: limits });
  });
  bind('[data-allow]', 'change', (e) => {
    const pkg = e.target.dataset.allow;
    savePolicy(d, { alwaysAllowed: e.target.checked ? [...new Set([...p.alwaysAllowed, pkg])] : p.alwaysAllowed.filter((x) => x !== pkg) });
  });

  // 앱별 한도 일괄 처리
  const allPkgs = [...$app.querySelectorAll('[data-allow]')].map((el) => el.dataset.allow);
  bind('[data-bulk=check-all]', 'click', () => savePolicy(d, { alwaysAllowed: [...new Set([...p.alwaysAllowed, ...allPkgs])] }, '모든 앱을 항상 허용으로 체크했습니다'));
  bind('[data-bulk=uncheck-all]', 'click', () => savePolicy(d, { alwaysAllowed: p.alwaysAllowed.filter((x) => !allPkgs.includes(x)) }, '모든 체크를 해제했습니다'));
  bind('[data-bulk=apply]', 'click', (e) => {
    const b = e.currentTarget;
    const raw = q('#bulkLimit').value;
    const name = APP_LIMITS.find(([v]) => String(v ?? '') === raw)[1];
    const targets = allPkgs.filter((pkg) => !p.alwaysAllowed.includes(pkg));
    // 실수 방지: 두 번 눌러야 적용
    if (b.dataset.confirm !== raw) {
      b.dataset.confirm = raw;
      b.textContent = `${targets.length}개 앱을 '${name}'(으)로 — 한 번 더 누르세요`;
      return;
    }
    const limits = { ...p.dailyLimitsMin };
    targets.forEach((pkg) => { if (raw === '') delete limits[pkg]; else limits[pkg] = Number(raw); });
    // 체크한 앱의 한도도 '제한 없음'일 때는 함께 푼다 (전체 풀기)
    if (raw === '') allPkgs.forEach((pkg) => delete limits[pkg]);
    savePolicy(d, { dailyLimitsMin: limits }, raw === '' ? '모든 앱의 한도를 풀었습니다' : `${targets.length}개 앱에 '${name}'을(를) 적용했습니다`);
  });
  q('#bulkLimit')?.addEventListener('change', () => {
    const b = $app.querySelector('[data-bulk=apply]');
    delete b.dataset.confirm;
    b.textContent = '모든 앱에 적용';
  });
  q('#appSearch')?.addEventListener('input', (e) => {
    state.appSearch = e.target.value;
    const term = e.target.value.trim().toLowerCase();
    $app.querySelectorAll('[data-app-row]').forEach((row) => { row.hidden = !!term && !row.dataset.appRow.includes(term); });
  });

  // 설정
  bind('[data-act=push-on]', 'click', enablePush);
  bind('[data-act=push-off]', 'click', disablePush);
  q('#pinForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = new FormData(e.target).get('pin');
    if (!/^[0-9]{4,8}$/.test(pin)) return toast('숫자 4~8자리로 입력하세요');
    // PIN 원문은 보내지 않는다. 폰과 같은 방식(SHA-256(salt + PIN))으로 해시한 값만 보낸다.
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pin));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await sendCommand(d, 'set_pin', { salt, hash }, '폰의 PIN 변경을 요청했습니다');
  });
  q('#removeDevice')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = '한 번 더 누르면 연결을 끊습니다';
      return;
    }
    await run(sb.from('devices').delete().eq('id', d.id), '연결을 끊었습니다');
    state.view = 'home';
    await loadDevices();
    render();
  });
}

function cmdLabel(c, d) {
  const names = { approve: '앱 승인', uninstall: '앱 삭제', lock_now: '화면 끄기', set_pin: 'PIN 변경', locate: '위치 요청', ring: '소리 울리기', ring_stop: '소리 끄기' };
  const label = c.payload?.pkg ? ((d?.state?.pending || []).find((a) => a.pkg === c.payload.pkg)?.label || c.payload.pkg) : '';
  return `${names[c.type] || c.type}${label ? `: ${label}` : ''}`;
}

// ───────── 시작 ─────────

$back.onclick = () => { state.view = 'home'; render(); scrollTo(0, 0); };
$logout.onclick = () => signOutAll();

sb.auth.onAuthStateChange((event, session) => {
  const changedUser = state.session?.user?.id !== session?.user?.id;
  state.session = session;
  if (!session) {
    state.family = null; state.devices = []; state.events = [];
    lock.step = null;
    if (channel) { sb.removeChannel(channel); channel = null; }
    return render();
  }
  if (changedUser) {
    // 이미 로그인된 상태로 앱을 열면 PIN부터 묻는다 (방금 이메일로 로그인한 경우는 제외).
    if (lockConfig() && !lock.justLoggedIn && !recentlyActive()) Object.assign(lock, { step: 'unlock', entry: '', msg: '' });
    lock.justLoggedIn = false;
    // 콜백 안에서 바로 Supabase를 호출하면 교착될 수 있어서 다음 틱으로 미룬다.
    setTimeout(async () => {
      try { await Promise.all([loadFamily(), checkPush()]); subscribe(); } catch { /* run()이 이미 알림 */ }
      render();
    }, 0);
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// 실시간 연결이 끊긴 경우를 대비한 주기적 새로고침
setInterval(() => { if (state.family && document.visibilityState === 'visible') refresh(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lock.hiddenAt = Date.now();
    markActive();
    return;
  }
  // 3분 넘게 다른 앱에 있다가 돌아오면 다시 잠근다.
  if (state.session && lockConfig() && !lock.step && lock.hiddenAt && Date.now() - lock.hiddenAt > LOCK_AFTER_MS) startLock('unlock');
  refresh();
});
