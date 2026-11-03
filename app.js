// 패밀리가드 부모 웹앱
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $logout = document.getElementById('logout');
const $toast = document.getElementById('toast');

const DEFAULT_POLICY = {
  dailyLimitsMin: {}, bedtimeEnabled: false, bedtimeStartMin: 22 * 60, bedtimeEndMin: 7 * 60,
  alwaysAllowed: [], blockAdb: false, blockedServices: [], familyFilter: true, mode: 'normal',
};
const MODES = [
  ['normal', '일반', '평소처럼 사용합니다.'],
  ['call_only', '통화만', '전화와 연락처만 쓸 수 있습니다. 홈 화면·알림창·다른 앱은 막힙니다.'],
  ['locked', '잠금', '잠금 안내 화면만 보이고 긴급 전화만 걸 수 있습니다. 걸려 오는 전화는 받을 수 있습니다.'],
];
const modeName = (m) => (MODES.find((x) => x[0] === m) || MODES[0])[1];
const LIMITS = [[null, '제한 없음'], [0, '차단'], [30, '30분'], [60, '1시간'], [90, '1시간 30분'], [120, '2시간'], [180, '3시간']];
const FALLBACK_SERVICES = [
  { id: 'assistant', label: '음성비서' }, { id: 'youtube', label: '유튜브' },
  { id: 'tiktok', label: '틱톡' }, { id: 'instagram', label: '인스타그램' },
];
const ONLINE_MS = 3 * 60 * 1000;

const state = { session: null, family: null, devices: [], commands: [], view: 'home', deviceId: null, authMode: 'login', code: null };
let channel = null;

// ───────── 유틸 ─────────

// 폰이 보고한 앱 이름 등은 신뢰할 수 없는 값이므로 반드시 이스케이프한다.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 2600);
}

function fmtDuration(ms) {
  const m = Math.floor((ms || 0) / 60000), h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h}시간 ${r}분`;
  if (h) return `${h}시간`;
  return `${r}분`;
}
const toClock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromClock = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function ago(ts) {
  if (!ts) return '기록 없음';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
const isOnline = (d) => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS;

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
  state.commands = ids.length
    ? await run(sb.from('commands').select('id,device_id,type,payload,created_at,done_at,result').in('device_id', ids).order('id', { ascending: false }).limit(30))
    : [];
}

function subscribe() {
  if (channel || !state.family) return;
  channel = sb.channel(`family-${state.family.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `family_id=eq.${state.family.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commands' }, refresh)
    .subscribe();
}

let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!state.family) return;
    await loadDevices().catch(() => {});
    // 입력 중인 요소가 있으면 화면을 다시 그리지 않는다.
    if (!document.activeElement || !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) render();
  }, 300);
}

const device = () => state.devices.find((d) => d.id === state.deviceId);
const policyOf = (d) => ({ ...DEFAULT_POLICY, ...(d.policy || {}) });

async function savePolicy(d, patch) {
  const policy = { ...policyOf(d), ...patch };
  d.policy = policy;
  await run(sb.from('devices').update({ policy, policy_updated_at: new Date().toISOString() }).eq('id', d.id),
    isOnline(d) ? '저장했습니다. 폰에 바로 적용됩니다.' : '저장했습니다. 폰이 온라인이 되면 적용됩니다.');
  render();
}

async function sendCommand(d, type, payload = {}, msg) {
  await run(sb.from('commands').insert({ device_id: d.id, type, payload, created_by: state.session.user.id }), msg);
  await loadDevices();
  render();
}

// ───────── 화면 ─────────

function render() {
  $logout.hidden = !state.session;
  $back.hidden = state.view === 'home' || !state.session;
  if (!state.session) return renderAuth();
  if (!state.family) return renderNoFamily();
  if (state.view === 'device' && device()) return renderDevice(device());
  state.view = 'home';
  renderHome();
}

function renderAuth() {
  $title.textContent = '패밀리가드';
  const signup = state.authMode === 'signup';
  $app.innerHTML = `
    <div class="card">
      <div class="tabs">
        <button class="btn" data-mode="login" aria-pressed="${!signup}">로그인</button>
        <button class="btn" data-mode="signup" aria-pressed="${signup}">처음 사용 (가입)</button>
      </div>
      <form id="auth">
        <label class="field"><span>이메일</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>비밀번호 ${signup ? '(6자 이상)' : ''}</span>
          <input type="password" name="password" minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" required></label>
        <button class="btn primary full" type="submit">${signup ? '가입하기' : '로그인'}</button>
      </form>
      <p class="sub">보호자(부모)만 가입합니다. 자녀 폰은 연결 코드로 연결합니다.</p>
    </div>`;
  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { state.authMode = b.dataset.mode; render(); });
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
      <h2>가족 만들기</h2>
      <p class="sub">처음 사용하는 보호자라면 가족을 만드세요.</p>
      <form id="create">
        <label class="field"><span>가족 이름</span><input type="text" name="name" value="우리 가족" maxlength="30"></label>
        <button class="btn primary full">가족 만들기</button>
      </form>
    </div>
    <div class="card">
      <h2>초대 코드로 합류</h2>
      <p class="sub">다른 보호자가 이미 가족을 만들었다면, 그 보호자에게 받은 6자리 초대 코드를 입력하세요.</p>
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

function renderHome() {
  $title.textContent = state.family.name;
  const cards = state.devices.map((d) => {
    const s = d.state || {};
    const fg = (s.foreground || []).map((a) => a.label).join(', ');
    const pending = (s.pending || []).length;
    return `
      <div class="card" role="button" tabindex="0" data-device="${esc(d.id)}" style="cursor:pointer">
        <div class="row">
          <div class="grow">
            <h2><span class="dot ${isOnline(d) ? 'on' : 'off'}"></span>${esc(d.name)} ${pending ? `<span class="badge">${pending}</span>` : ''}</h2>
            <div class="sub">${isOnline(d) ? '온라인' : `마지막 연결 ${ago(d.last_seen)}`}${s.battery != null ? ` · 배터리 ${esc(s.battery)}%` : ''}${d.policy?.mode && d.policy.mode !== 'normal' ? ` · <strong>${modeName(d.policy.mode)} 모드</strong>` : ''}</div>
          </div>
          <div style="text-align:right"><div class="sub">오늘 사용</div><strong>${fmtDuration(s.screenTimeMs)}</strong></div>
        </div>
        ${fg ? `<div class="sub">지금 사용 중: ${esc(fg)}</div>` : ''}
        ${pending ? `<div class="sub danger-text">승인 대기 앱 ${pending}개</div>` : ''}
      </div>`;
  }).join('');

  $app.innerHTML = `
    ${cards || '<div class="card"><h2>연결된 자녀 폰이 없습니다</h2><p class="sub">아래 \'자녀 폰 연결\'을 눌러 코드를 만든 뒤, 자녀 폰의 패밀리가드 > 부모 설정 > 부모 앱 연결에 입력하세요.</p></div>'}
    ${codeCard()}
    <div class="btns">
      <button class="btn primary" id="pairDevice">자녀 폰 연결</button>
      <button class="btn" id="inviteParent">보호자 초대</button>
    </div>`;
  $app.querySelectorAll('[data-device]').forEach((el) => {
    const open = () => { state.view = 'device'; state.deviceId = el.dataset.device; render(); scrollTo(0, 0); };
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  $app.querySelector('#pairDevice').onclick = () => makeCode('device');
  $app.querySelector('#inviteParent').onclick = () => makeCode('parent');
}

function codeCard() {
  const c = state.code;
  if (!c || Date.now() > c.expires) return '';
  const left = Math.max(0, Math.round((c.expires - Date.now()) / 60000));
  return `
    <div class="card center">
      <h2>${c.kind === 'device' ? '자녀 폰 연결 코드' : '보호자 초대 코드'}</h2>
      <div class="code">${esc(c.code)}</div>
      <p class="sub">${c.kind === 'device'
        ? '자녀 폰의 패밀리가드 > 부모 설정 > 부모 앱 연결에 입력하세요.'
        : '다른 보호자가 이 웹앱에 가입한 뒤 \'초대 코드로 합류\'에 입력합니다.'}<br>약 ${left}분 동안 유효합니다.</p>
    </div>`;
}

async function makeCode(kind) {
  const code = await run(sb.rpc('create_pairing_code', { fid: state.family.id, code_kind: kind }));
  state.code = { code, kind, expires: Date.now() + 10 * 60 * 1000 };
  render();
}

function sw(id, checked, label, sub = '') {
  return `<div class="row"><div class="grow"><div>${label}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function renderDevice(d) {
  $title.textContent = d.name;
  const s = d.state || {};
  const p = policyOf(d);
  const services = s.services?.length ? s.services : FALLBACK_SERVICES;
  const apps = new Map((s.apps || []).map((a) => [a.pkg, a.label]));
  Object.keys(p.dailyLimitsMin).forEach((pkg) => { if (!apps.has(pkg)) apps.set(pkg, pkg); });
  const appList = [...apps.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  const usage = s.usage || [];
  const hits = s.hits || [];
  const pending = s.pending || [];
  const myCommands = state.commands.filter((c) => c.device_id === d.id).slice(0, 5);
  const pendingCmd = new Set(state.commands.filter((c) => c.device_id === d.id && !c.done_at).map((c) => `${c.type}:${c.payload?.pkg || ''}`));

  $app.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="grow">
          <div class="sub"><span class="dot ${isOnline(d) ? 'on' : 'off'}"></span>${isOnline(d) ? '온라인' : `마지막 연결 ${ago(d.last_seen)}`}</div>
          <div class="stat">${fmtDuration(s.screenTimeMs)}</div>
          <div class="sub">오늘 사용 · 잠금 해제 ${esc(s.unlocks ?? 0)}회</div>
        </div>
        <button class="btn" id="lockNow">화면 끄기</button>
      </div>
      <div class="chips">
        ${s.battery != null ? `<span class="chip">배터리 ${esc(s.battery)}%</span>` : ''}
        <span class="chip">${s.vpn ? '인터넷 필터 작동 중' : '⚠️ 인터넷 필터 꺼짐'}</span>
        ${s.deviceOwner === false ? '<span class="chip danger-text">⚠️ 관리 권한 없음</span>' : ''}
        ${(s.foreground || []).map((a) => `<span class="chip">사용 중: ${esc(a.label)}</span>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>모드</h2>
      <div class="tabs">
        ${MODES.map(([m, t]) => `<button class="btn" data-mode-set="${m}" aria-pressed="${p.mode === m}">${t}</button>`).join('')}
      </div>
      <p class="sub">${(MODES.find((x) => x[0] === p.mode) || MODES[0])[2]}
        ${isOnline(d) && s.mode && s.mode !== p.mode ? '<br>폰에 적용하는 중…' : ''}
        ${!isOnline(d) && p.mode !== (s.mode || 'normal') ? '<br>폰이 오프라인이라 연결되면 적용됩니다.' : ''}</p>
    </div>

    ${pending.length ? `
    <div class="card">
      <h2>승인 대기 중인 앱</h2>
      <p class="sub">새로 설치된 앱은 승인하기 전까지 사용할 수 없습니다.</p>
      ${pending.map((a) => `
        <div class="row">
          <div class="grow"><div class="name">${esc(a.label)}</div><div class="sub name">${esc(a.pkg)}</div></div>
          ${pendingCmd.has(`approve:${a.pkg}`) || pendingCmd.has(`uninstall:${a.pkg}`)
            ? '<span class="sub">처리 중…</span>'
            : `<button class="btn primary" data-approve="${esc(a.pkg)}">승인</button><button class="btn danger" data-uninstall="${esc(a.pkg)}">삭제</button>`}
        </div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>차단</h2>
      ${sw('familyFilter', p.familyFilter, '유해사이트 차단', '성인·도박·악성 사이트, 구글 세이프서치 강제')}
      ${services.map((sv) => sw(`svc-${esc(sv.id)}`, p.blockedServices.includes(sv.id), `${esc(sv.label)} 항상 차단`,
        sv.id === 'assistant' ? '구글 앱·Gemini·Voice Access 정지' : '앱과 웹 주소를 함께 차단 (카톡 링크 등 포함)')).join('')}
    </div>

    <div class="card">
      <h2>취침시간</h2>
      ${sw('bedtime', p.bedtimeEnabled, '취침시간 사용', '이 시간에는 아래 \'항상 허용\' 앱과 전화·문자만 사용')}
      <div class="row">
        <div class="grow">시작</div><input type="time" id="bedStart" value="${toClock(p.bedtimeStartMin)}">
      </div>
      <div class="row">
        <div class="grow">종료</div><input type="time" id="bedEnd" value="${toClock(p.bedtimeEndMin)}">
      </div>
    </div>

    <div class="card">
      <h2>앱별 하루 사용 한도</h2>
      <p class="sub">체크한 앱은 취침시간에도 사용할 수 있습니다.</p>
      ${appList.length ? appList.map(([pkg, label]) => {
        const lim = p.dailyLimitsMin[pkg] ?? null;
        return `<div class="row">
          <input type="checkbox" data-allow="${esc(pkg)}" ${p.alwaysAllowed.includes(pkg) ? 'checked' : ''} aria-label="취침시간에도 허용" style="width:20px;height:20px">
          <div class="grow name">${esc(label)}</div>
          <select data-limit="${esc(pkg)}">${LIMITS.map(([v, t]) => `<option value="${v ?? ''}" ${v === lim ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>`;
      }).join('') : '<p class="sub">폰에서 앱 목록을 아직 받지 못했습니다.</p>'}
    </div>

    <div class="card">
      <h2>오늘 앱 사용</h2>
      ${usage.length ? usage.map((u) => `<div class="row"><div class="grow name">${esc(u.label)}</div><div>${fmtDuration(u.ms)}</div></div>`).join('') : '<p class="sub">기록이 없습니다.</p>'}
    </div>

    <div class="card">
      <h2>오늘 차단된 접속 시도</h2>
      ${hits.length ? hits.map((h) => `<div class="row"><div class="grow name">${esc(h.app)} → ${esc(h.domain)}</div><div class="sub">${esc(h.count)}회</div></div>`).join('') : '<p class="sub">없습니다.</p>'}
    </div>

    ${myCommands.length ? `
    <div class="card">
      <h2>최근 명령</h2>
      ${myCommands.map((c) => `<div class="row"><div class="grow">${esc(cmdLabel(c))}</div><div class="sub">${c.done_at ? esc(c.result || '완료') : '대기 중'}</div></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>기기 관리</h2>
      <p class="sub">마지막 보고 ${ago(d.last_seen)} · 앱 버전 ${esc(s.appVersion || '-')}</p>
      <div class="btns"><button class="btn danger" id="removeDevice">이 기기 연결 끊기</button></div>
      <p class="sub">연결을 끊어도 폰의 제한은 그대로 남습니다. 완전히 해제하려면 폰의 부모 설정에서 '관리 해제'를 누르세요.</p>
    </div>`;

  const q = (sel) => $app.querySelector(sel);
  q('#lockNow').onclick = () => sendCommand(d, 'lock_now', {}, '화면을 껐습니다 (자녀가 비밀번호로 다시 켤 수 있음)');
  $app.querySelectorAll('[data-mode-set]').forEach((b) => b.onclick = () => {
    if (b.dataset.modeSet !== p.mode) savePolicy(d, { mode: b.dataset.modeSet });
  });
  $app.querySelectorAll('[data-approve]').forEach((b) => b.onclick = () => sendCommand(d, 'approve', { pkg: b.dataset.approve }, '승인했습니다'));
  $app.querySelectorAll('[data-uninstall]').forEach((b) => b.onclick = () => sendCommand(d, 'uninstall', { pkg: b.dataset.uninstall }, '삭제 명령을 보냈습니다'));
  q('#familyFilter').onchange = (e) => savePolicy(d, { familyFilter: e.target.checked });
  services.forEach((sv) => {
    const el = q(`#svc-${CSS.escape(sv.id)}`);
    if (el) el.onchange = (e) => savePolicy(d, {
      blockedServices: e.target.checked ? [...new Set([...p.blockedServices, sv.id])] : p.blockedServices.filter((x) => x !== sv.id),
    });
  });
  q('#bedtime').onchange = (e) => savePolicy(d, { bedtimeEnabled: e.target.checked });
  q('#bedStart').onchange = (e) => e.target.value && savePolicy(d, { bedtimeStartMin: fromClock(e.target.value) });
  q('#bedEnd').onchange = (e) => e.target.value && savePolicy(d, { bedtimeEndMin: fromClock(e.target.value) });
  $app.querySelectorAll('[data-limit]').forEach((sel) => sel.onchange = () => {
    const limits = { ...p.dailyLimitsMin };
    if (sel.value === '') delete limits[sel.dataset.limit]; else limits[sel.dataset.limit] = Number(sel.value);
    savePolicy(d, { dailyLimitsMin: limits });
  });
  $app.querySelectorAll('[data-allow]').forEach((cb) => cb.onchange = () => {
    const pkg = cb.dataset.allow;
    savePolicy(d, { alwaysAllowed: cb.checked ? [...new Set([...p.alwaysAllowed, pkg])] : p.alwaysAllowed.filter((x) => x !== pkg) });
  });
  q('#removeDevice').onclick = async () => {
    if (q('#removeDevice').dataset.confirm !== '1') {
      q('#removeDevice').dataset.confirm = '1';
      q('#removeDevice').textContent = '한 번 더 누르면 연결을 끊습니다';
      return;
    }
    await run(sb.from('devices').delete().eq('id', d.id), '연결을 끊었습니다');
    state.view = 'home';
    await loadDevices();
    render();
  };
}

function cmdLabel(c) {
  const names = { approve: '앱 승인', uninstall: '앱 삭제', lock_now: '화면 끄기' };
  const d = device();
  const label = c.payload?.pkg ? ((d?.state?.pending || []).find((a) => a.pkg === c.payload.pkg)?.label || c.payload.pkg) : '';
  return `${names[c.type] || c.type}${label ? `: ${label}` : ''}`;
}

// ───────── 시작 ─────────

$back.onclick = () => { state.view = 'home'; render(); };
$logout.onclick = async () => { await sb.auth.signOut(); };

sb.auth.onAuthStateChange(async (event, session) => {
  const changedUser = state.session?.user?.id !== session?.user?.id;
  state.session = session;
  if (!session) {
    state.family = null; state.devices = [];
    if (channel) { sb.removeChannel(channel); channel = null; }
    return render();
  }
  if (changedUser) {
    // 콜백 안에서 바로 Supabase를 호출하면 교착될 수 있어서 다음 틱으로 미룬다.
    setTimeout(async () => {
      try { await loadFamily(); subscribe(); } catch { /* run()이 이미 알림 */ }
      render();
    }, 0);
  }
});

// 실시간 연결이 끊긴 경우를 대비한 주기적 새로고침, 연결 코드 남은 시간 갱신
setInterval(() => { if (state.family && document.visibilityState === 'visible') refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
