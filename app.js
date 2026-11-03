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
};
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
};
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
  const limit = policyOf(d).totalDailyLimitMin;
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commands' }, refresh)
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

// ───────── 화면 ─────────

function render() {
  $logout.hidden = !state.session || state.view !== 'home';
  $back.hidden = state.view === 'home' || !state.session;
  $subtitle.textContent = '';
  if (!state.session) return renderAuth();
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

function statusChips(d) {
  const s = d.state || {};
  const p = policyOf(d);
  const mode = MODES.find((m) => m.id === p.mode);
  return `
    <span class="chip ${isOnline(d) ? 'ok' : ''}"><span class="dot ${isOnline(d) ? 'on' : ''}"></span>${isOnline(d) ? '온라인' : esc(ago(d.last_seen))}</span>
    ${p.mode !== 'normal' ? `<span class="chip ${p.mode === 'locked' ? 'danger' : 'warn'}">${esc(mode?.name)} 모드</span>` : ''}
    ${s.battery != null ? `<span class="chip">🔋 ${esc(s.battery)}%</span>` : ''}
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
    ${codeCard()}
    ${recent.length ? `
      <div class="section-label">최근 알림</div>
      <div class="card">${recent.map(eventRow).join('')}</div>` : ''}
    <div class="section-label">가족 관리</div>
    <div class="btns">
      <button class="btn primary" data-act="pair">자녀 폰 연결</button>
      <button class="btn" data-act="invite">보호자 초대</button>
    </div>`;
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

async function makeCode(kind) {
  const code = await run(sb.rpc('create_pairing_code', { fid: state.family.id, code_kind: kind }));
  state.code = { code, kind, expires: Date.now() + 10 * 60 * 1000 };
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
  const tabs = [['overview', '개요'], ['limits', '제한'], ['activity', '기록'], ['settings', '설정']];
  const limited = s.limitedMs ?? 0;

  const hero = `
    <div class="card">
      <div class="hero">
        ${usageRing(d, 112, 11, true)}
        <div style="flex:1;min-width:0">
          <div class="sub">오늘 사용</div>
          <div class="big">${fmtDuration(s.screenTimeMs)}</div>
          <div class="sub">${p.totalDailyLimitMin != null
            ? `하루 한도 ${esc(limitName(p.totalDailyLimitMin))} · ${limited >= p.totalDailyLimitMin * 60000 ? '<b style="color:var(--danger)">다 사용함</b>' : `남은 시간 ${fmtDuration(p.totalDailyLimitMin * 60000 - limited)}`}`
            : '하루 한도 없음'} · 잠금 해제 ${esc(s.unlocks ?? 0)}회</div>
        </div>
      </div>
      <div class="chips">${statusChips(d)}${(s.foreground || []).map((a) => `<span class="chip">▶ ${esc(a.label)}</span>`).join('')}</div>
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([id, name]) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}">${name}${id === 'overview' && pending.length ? ` <span class="badge">${pending.length}</span>` : ''}</button>`).join('')}
    </div>`;

  const body = { overview: tabOverview, limits: tabLimits, activity: tabActivity, settings: tabSettings }[state.tab](d, s, p);
  $app.innerHTML = hero + body;
  bind('[data-tab]', 'click', (e) => { state.tab = e.currentTarget.dataset.tab; render(); });
  bindDevice(d, s, p);
}

function tabOverview(d, s, p) {
  const pending = s.pending || [];
  const pendingCmd = new Set(state.commands.filter((c) => c.device_id === d.id && !c.done_at).map((c) => `${c.type}:${c.payload?.pkg || ''}`));
  const mode = MODES.find((m) => m.id === p.mode) || MODES[0];
  const devEvents = state.events.filter((e) => e.device_id === d.id).slice(0, 3);
  return `
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
      <div class="card-head"><h2>최근 알림</h2><button class="link" data-tab="activity">전체 보기</button></div>
      ${devEvents.map(eventRow).join('')}
    </div>` : ''}

    <div class="btns"><button class="btn" id="lockNow">화면 끄기</button></div>
    <p class="sub center">화면만 끕니다. 계속 막으려면 위에서 '잠금' 모드를 쓰세요.</p>`;
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
      <div class="card-head"><h2>앱별 한도</h2></div>
      <p class="sub" style="margin-top:-4px">☑ 항상 허용: 취침시간과 하루 전체 한도에서 빠집니다 (학원앱, 사전 등).</p>
      ${appList.length ? appList.map(([pkg, label]) => {
        const lim = p.dailyLimitsMin[pkg] ?? null;
        return `<div class="row">
          <input type="checkbox" class="check" data-allow="${esc(pkg)}" ${p.alwaysAllowed.includes(pkg) ? 'checked' : ''} aria-label="${esc(label)} 항상 허용">
          ${avatar(label, pkg)}
          <div class="grow ellipsis">${esc(label)}</div>
          <select data-limit="${esc(pkg)}" aria-label="${esc(label)} 하루 한도">${APP_LIMITS.map(([v, t]) => `<option value="${v ?? ''}" ${v === lim ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>`;
      }).join('') : '<div class="empty">폰에서 앱 목록을 아직 받지 못했습니다.</div>'}
    </div>`;
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
      <div class="card-head"><h2>알림 기록</h2></div>
      ${devEvents.length ? devEvents.map(eventRow).join('') : '<div class="empty">아직 알림이 없습니다.</div>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>오늘 차단된 접속</h2></div>
      ${hits.length ? hits.map((h) => `<div class="row">${avatar(h.app, h.app)}<div class="grow"><div class="ellipsis">${esc(h.app)}</div><div class="sub ellipsis">${esc(h.domain)}</div></div><span class="sub">${esc(h.count)}회</span></div>`).join('') : '<div class="empty">없습니다.</div>'}
    </div>
    ${cmds.length ? `
    <div class="card">
      <div class="card-head"><h2>보낸 명령</h2></div>
      ${cmds.map((c) => `<div class="row"><div class="grow"><div>${esc(cmdLabel(c, d))}</div><div class="sub">${esc(ago(c.created_at))}</div></div><span class="sub">${c.done_at ? esc(c.result || '완료') : '대기 중'}</span></div>`).join('')}
    </div>` : ''}`;
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
  bind('[data-approve]', 'click', (e) => sendCommand(d, 'approve', { pkg: e.currentTarget.dataset.approve }, '승인했습니다'));
  bind('[data-uninstall]', 'click', (e) => sendCommand(d, 'uninstall', { pkg: e.currentTarget.dataset.uninstall }, '삭제 명령을 보냈습니다'));
  q('#lockNow')?.addEventListener('click', () => sendCommand(d, 'lock_now', {}, '화면을 껐습니다'));

  // 제한
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
  const names = { approve: '앱 승인', uninstall: '앱 삭제', lock_now: '화면 끄기', set_pin: 'PIN 변경' };
  const label = c.payload?.pkg ? ((d?.state?.pending || []).find((a) => a.pkg === c.payload.pkg)?.label || c.payload.pkg) : '';
  return `${names[c.type] || c.type}${label ? `: ${label}` : ''}`;
}

// ───────── 시작 ─────────

$back.onclick = () => { state.view = 'home'; render(); scrollTo(0, 0); };
$logout.onclick = async () => { await sb.auth.signOut(); };

sb.auth.onAuthStateChange((event, session) => {
  const changedUser = state.session?.user?.id !== session?.user?.id;
  state.session = session;
  if (!session) {
    state.family = null; state.devices = []; state.events = [];
    if (channel) { sb.removeChannel(channel); channel = null; }
    return render();
  }
  if (changedUser) {
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
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
