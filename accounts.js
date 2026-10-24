const $ = id => document.getElementById(id);
let user = null, registering = false, busy = false, identityVersion = 0;
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('composer-account') : null;
async function request(action, body) {
  const response = await fetch(`/api/auth?action=${action}`, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
  }).catch(() => { throw new Error('连接失败，请检查网络后重试'); });
  const data = await response.json().catch(() => { throw new Error('账号服务暂时不可用'); });
  if (!response.ok) {
    if (response.status === 401 && action !== 'login') setUser(null, true);
    throw new Error(data.error || '操作失败，请稍后重试');
  }
  return data;
}
function render() {
  $('accountButton').textContent = user ? `账号 · ${user.username}` : '登录 / 注册';
  $('accountHeading').textContent = user ? '我的账号' : registering ? '注册账号' : '登录账号';
  $('accountGuest').hidden = Boolean(user); $('accountMember').hidden = !user;
  $('accountName').textContent = user ? `当前账号：${user.username}` : '';
  $('passwordUsername').value = user?.username || '';
  $('registrationFields').hidden = !registering;
  $('accountPasswordConfirm').disabled = !registering;
  $('accountPasswordConfirm').required = registering;
  $('accountPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('accountSubmit').textContent = registering ? '创建账号并登录' : '登录';
  for (const [id, selected] of [['loginTab', !registering], ['registerTab', registering]]) {
    $(id).classList.toggle('active', selected); $(id).setAttribute('aria-pressed', String(selected));
  }
}
function setUser(next, broadcast = false) {
  ++identityVersion;
  const previous = user?.id; user = next; render();
  if (previous !== user?.id) window.dispatchEvent(new CustomEvent('account-change', { detail: { user } }));
  if (broadcast) channel?.postMessage('changed');
}
async function refresh() {
  const version = identityVersion;
  const data = await request('session');
  if (version === identityVersion) setUser(data.user);
  return user;
}
function open() {
  $('accountMessage').textContent = ''; render();
  if (!$('accountDialog').open) $('accountDialog').showModal();
  (user ? $('accountClose') : $('accountUsername')).focus();
}
async function operation(run) {
  if (busy) return;
  busy = true; $('accountMessage').textContent = '';
  $('accountDialog').querySelectorAll('button').forEach(el => { el.disabled = true; });
  try { await run(); }
  catch (error) { $('accountMessage').textContent = error.message; }
  finally { busy = false; $('accountDialog').querySelectorAll('button').forEach(el => { el.disabled = false; }); }
}
$('accountButton').addEventListener('click', open);
$('accountClose').addEventListener('click', () => $('accountDialog').close());
$('accountDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('accountDialog').addEventListener('close', () => { $('accountForm').reset(); $('passwordForm').reset(); render(); });
for (const [id, value] of [['loginTab', false], ['registerTab', true]]) $(id).addEventListener('click', () => { registering = value; $('accountMessage').textContent = ''; render(); });
$('accountForm').addEventListener('submit', event => {
  event.preventDefault();
  return operation(async () => {
    if (registering && $('accountPassword').value !== $('accountPasswordConfirm').value) throw new Error('两次输入的密码不一致');
    const data = await request(registering ? 'register' : 'login', { username: $('accountUsername').value, password: $('accountPassword').value });
    setUser(data.user, true); $('accountDialog').close();
  });
});
$('passwordForm').addEventListener('submit', event => {
  event.preventDefault();
  return operation(async () => {
    if ($('newPassword').value !== $('newPasswordConfirm').value) throw new Error('两次输入的新密码不一致');
    await request('change-password', { currentPassword: $('currentPassword').value, newPassword: $('newPassword').value });
    $('passwordForm').reset(); render(); channel?.postMessage('changed');
    $('accountMessage').textContent = '密码已修改，其他设备的旧登录已失效。';
  });
});
$('accountLogout').addEventListener('click', () => operation(async () => {
  await request('logout', {}); setUser(null, true); $('accountDialog').close();
}));
$('claimLegacy').addEventListener('click', () => operation(async () => {
  const data = await request('claim-legacy', {});
  $('accountMessage').textContent = `已绑定 ${data.posts} 首作品和 ${data.comments} 条评论。`;
  window.dispatchEvent(new CustomEvent('account-change', { detail: { user } }));
}));
channel?.addEventListener('message', () => { refresh().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) refresh().catch(() => {}); });
export const accounts = {
  get user() { return user; }, open, refresh,
  ready: refresh().catch(() => null),
  async require() {
    await this.ready;
    if (user) return true;
    open(); return false;
  }
};
