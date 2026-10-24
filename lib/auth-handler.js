import { getAuthService } from './auth.js';
import { isAPIError } from 'better-auth/api';
import { usernameInput, passwordInput, clientKey } from './auth-policy.js';
import { visitor } from './identity.js';
import { ForumError, checkOrigin, readBody } from './validation.js';

const publicUser = user => user ? { id: user.id, username: user.username, name: user.name } : null;
function result(data, status = 200, cookies = []) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return Response.json(data, { status, headers });
}
export function createAuthHandler(service = getAuthService) {
  return async request => {
    try {
      const action = new URL(request.url).searchParams.get('action');
      if (request.method === 'GET' && action === 'session') {
        const { auth } = await service();
        const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
        return result({ user: publicUser(session?.user) });
      }
      if (request.method !== 'POST') return result({ error: '不支持的操作' }, 405);
      checkOrigin(request);
      if (!['register','login','logout','change-password','claim-legacy'].includes(action)) return result({ error: '操作不存在' }, 404);
      const body = await readBody(request, 8192);
      let username, password;
      if (action === 'register' || action === 'login') {
        username = usernameInput(body.username);
        password = passwordInput(body.password);
      }
      const { auth, policy, secret } = await service();
      const ip = clientKey(request, secret);
      let response;
      if (action === 'register') {
        await policy.limit('register:' + ip, 10, 3600);
        await policy.cleanup();
        const reservation = await policy.reserve(ip, username);
        try {
          // The internal address satisfies the auth schema; email login/recovery is not exposed.
          response = await auth.api.signUpEmail({ headers: request.headers, asResponse: true, body: { username, name: username, email: `${username}@accounts.invalid`, password } });
          if (!response.ok) await policy.releaseFailed(reservation);
        } catch (error) { await policy.releaseFailed(reservation); throw error; }
      } else if (action === 'login') {
        await policy.limit('login-ip:' + ip, 30, 900);
        await policy.limit('login-name:' + ip + ':' + username, 10, 900);
        response = await auth.api.signInUsername({ headers: request.headers, asResponse: true, body: { username, password } });
      } else if (action === 'logout') {
        response = await auth.api.signOut({ headers: request.headers, asResponse: true });
      } else {
        const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
        if (!session) throw new ForumError(401, '请先登录账号');
        await policy.limit(action + ':' + session.user.id, 5, 900);
        if (action === 'claim-legacy') return result({ ok: true, ...await policy.claim(visitor(request).actor, session.user.id) });
        response = await auth.api.changePassword({ headers: request.headers, asResponse: true, body: { currentPassword: passwordInput(body.currentPassword), newPassword: passwordInput(body.newPassword), revokeOtherSessions: true } });
      }
      const data = await response.json();
      if (!response.ok) {
        const message = action === 'login' ? '账号或密码不正确' : action === 'register' ? '注册未成功，账号可能已被使用，请更换账号或稍后重试' : action === 'change-password' ? '修改失败，请检查当前密码后重试' : '操作失败，请稍后重试';
        return result({ error: message }, response.status >= 500 ? 503 : response.status, response.headers.getSetCookie());
      }
      // Never send session tokens, password hashes, or internal email addresses to JS.
      return result({ ok: true, user: publicUser(data.user) }, action === 'register' ? 201 : 200, response.headers.getSetCookie());
    } catch (error) {
      if (error instanceof ForumError) return result({ error: error.message }, error.status);
      if (isAPIError(error) && error.statusCode < 500) return result({ error: '账号信息不正确或账号已被使用，请检查后重试' }, error.statusCode);
      console.error('auth_request_failed', { code: typeof error.code === 'string' ? error.code : 'unknown' });
      return result({ error: '账号服务暂时不可用，请稍后重试' }, 503);
    }
  };
}
export const handleAuth = createAuthHandler();
