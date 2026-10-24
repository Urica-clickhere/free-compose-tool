import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('account forms preserve failed input, clear secrets on close, and ignore stale session responses after logout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../accounts.js', import.meta.url), 'utf8');
  const elements = new Map(), events = [], calls = [];
  for (const [,id] of html.matchAll(/\bid="([^"]+)"/g)) {
    const listeners = new Map();
    elements.set(id, {
      value: '', textContent: '', hidden: false, disabled: false, open: false,
      classList: { toggle() {} }, setAttribute() {}, focus() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      dispatch(type) { return listeners.get(type)?.({ preventDefault() {} }); },
      querySelectorAll() { return []; }, showModal() { this.open = true; },
      close() { this.open = false; this.dispatch('close'); },
      reset() { for (const name of id === 'accountForm' ? ['accountUsername','accountPassword','accountPasswordConfirm'] : ['currentPassword','newPassword','newPasswordConfirm']) elements.get(name).value = ''; }
    });
  }
  const el = id => { assert.ok(elements.has(id), `UI element exists: ${id}`); return elements.get(id); };
  let fetchResponse = () => Response.json({ user: null });
  const context = vm.createContext({
    document: { getElementById: el, addEventListener() {} },
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, args) { this.type = type; this.detail = args.detail; } },
    AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return fetchResponse(url, options); }
  });
  vm.runInContext(source.replace('export const accounts =', 'const accounts ='), context);
  const accounts = vm.runInContext('accounts', context);
  await accounts.ready;
  assert.equal(await accounts.require(), false); assert.equal(el('accountDialog').open, true);
  await el('registerTab').dispatch('click');
  assert.equal(el('accountPasswordConfirm').required, true); assert.equal(el('accountPasswordConfirm').disabled, false);
  el('accountUsername').value = 'alice'; el('accountPassword').value = 'test-secret-password'; el('accountPasswordConfirm').value = 'different-secret';
  await el('accountForm').dispatch('submit');
  assert.match(el('accountMessage').textContent, /不一致/); assert.equal(calls.length, 1);
  el('accountPasswordConfirm').value = el('accountPassword').value;
  fetchResponse = () => Response.json({ error: '账号已被使用' }, { status: 409 });
  await el('accountForm').dispatch('submit');
  assert.equal(el('accountDialog').open, true); assert.equal(el('accountUsername').value, 'alice');
  assert.equal(el('accountMessage').textContent, '账号已被使用');
  fetchResponse = () => Response.json({ user: { id: 'alice-id', username: 'alice' } });
  await el('accountForm').dispatch('submit');
  assert.equal(accounts.user.username, 'alice'); assert.equal(el('accountDialog').open, false);
  assert.equal(el('accountPassword').value, ''); assert.equal(el('accountPasswordConfirm').value, '');
  assert.equal(await accounts.require(), true);
  assert.ok(events.some(event => event.detail.user?.id === 'alice-id'));

  let releaseSession;
  fetchResponse = () => new Promise(resolve => { releaseSession = resolve; });
  const stale = accounts.refresh();
  fetchResponse = () => Response.json({ ok: true });
  await el('accountLogout').dispatch('click');
  assert.equal(accounts.user, null);
  releaseSession(Response.json({ user: { id: 'alice-id', username: 'alice' } }));
  await stale;
  assert.equal(accounts.user, null, 'late response cannot restore a logged-out identity');
  assert.equal(el('accountButton').textContent, '登录 / 注册');
});
