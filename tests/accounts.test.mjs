import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../lib/auth.js';
import { createAuthHandler } from '../lib/auth-handler.js';
import { createPolicy, policySchema, ipNetwork, clientKey } from '../lib/auth-policy.js';
import { communitySchema } from '../lib/community-schema.js';
import { createForumHandler } from '../lib/forum.js';
import { visitor, accountActor } from '../lib/identity.js';
import { postgres } from './helpers/postgres.mjs';
const origin = 'https://composer.example';
const password = 'Test-only-password-47!';
test('trusted client IPs normalize mapped IPv4 and IPv6 /64, and ignore spoofed headers locally', () => {
  assert.equal(ipNetwork('::ffff:192.0.2.1'), ipNetwork('192.0.2.1'));
  assert.equal(ipNetwork('2001:db8:1:2::1'), ipNetwork('2001:db8:1:2:ffff::a'));
  assert.notEqual(ipNetwork('2001:db8:1:3::1'), ipNetwork('2001:db8:1:2::1'));
  assert.throws(() => clientKey(new Request(origin, { headers: { 'x-forwarded-for': '192.0.2.1' } }), 'secret', true), { status: 503 });
  assert.equal(clientKey(new Request(origin), 'secret', false), clientKey(new Request(origin, { headers: { 'x-forwarded-for': '192.0.2.99' } }), 'secret', false));
});
test('account lifecycle and PostgreSQL policies, ownership and legacy migration', async t => {
  const { pool, sql } = await postgres();
  t.after(() => pool.end());
  const options = authOptions(pool, randomBytes(32).toString('hex'), origin);
  await (await getMigrations(options)).runMigrations();
  for (const query of [...communitySchema, ...policySchema]) await pool.query(query);
  const auth = betterAuth(options), policy = createPolicy(pool);
  const handleAuth = createAuthHandler(async () => ({ auth, policy, secret: options.secret }));
  const handleForum = createForumHandler({ getDatabase: () => sql, init: async () => {}, getSession: request => auth.api.getSession({ headers: request.headers }) });
  const client = () => {
    const jar = new Map();
    return {
      jar,
      async call(area, action, body, headers = {}) {
        const request = new Request(`${origin}/api/${area}?action=${action}`, {
          method: body ? 'POST' : 'GET', headers: { cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? { origin, 'Content-Type': 'application/json' } : {}), ...headers },
          body: body ? JSON.stringify(body) : undefined
        });
        const response = await (area === 'auth' ? handleAuth : handleForum)(request);
        const cookies = response.headers.getSetCookie();
        for (const cookie of cookies) { const pair = cookie.split(';')[0]; const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at+1)); }
        return { status: response.status, data: await response.json(), cookies, headers: response.headers };
      }
    };
  };
  const a = client(), b = client(), otherDevice = client(), guest = client();
  let aId;
  await t.test('reject CSRF, large bodies, unexposed endpoints and unauthenticated writes', async () => {
    assert.equal((await guest.call('auth','register',{username:'alice',password},{origin:'https://evil.example'})).status,403);
    assert.equal((await guest.call('auth','register',{username:'alice',password:'x'.repeat(9000)})).status,413);
    assert.equal((await guest.call('auth','sign-up/email',{})).status,404);
    assert.equal((await guest.call('auth','change-password',{currentPassword:password,newPassword:password})).status,401);
    for (const action of ['publish','comment','like','report']) assert.equal((await guest.call('forum',action,{})).status,401);
  });
  await t.test('register and normalize names; hash passwords; only HttpOnly cookie carries session token', async () => {
    const registered = await a.call('auth','register',{username:'Alice',password});
    assert.equal(registered.status,201,JSON.stringify(registered.data));
    aId = registered.data.user.id;
    assert.equal(registered.data.user.username,'alice');
    assert.deepEqual(Object.keys(registered.data.user).sort(),['id','name','username']);
    assert.equal(registered.data.token,undefined);
    assert.match(registered.cookies.join(';'),/HttpOnly/i); assert.match(registered.cookies.join(';'),/Secure/i); assert.match(registered.cookies.join(';'),/SameSite=Lax/i);
    const stored = (await pool.query('SELECT password FROM composer_account WHERE "userId"=$1',[aId])).rows[0].password;
    assert.notEqual(stored,password); assert.match(stored,/^[a-f0-9]+:[a-f0-9]+$/);
    assert.equal((await a.call('auth','session')).data.user.id,aId);
    assert.equal((await otherDevice.call('auth','login',{username:'ALICE',password:'incorrect-password'})).status,401);
    assert.equal((await otherDevice.call('auth','login',{username:'ALICE',password})).data.user.id,aId);
    assert.notEqual([...a.jar.values()][0],[...otherDevice.jar.values()][0]);
    assert.equal((await guest.call('auth','register',{username:'Alice',password})).status,409);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM composer_registrations')).rows[0].n,1);
    assert.equal((await b.call('auth','register',{username:'bob',password})).status,201);
    const storedBob = (await pool.query('SELECT password FROM composer_account WHERE "userId"=$1',[(await b.call('auth','session')).data.user.id])).rows[0].password;
    assert.notEqual(stored,storedBob,'same password has different salt');
  });
  await t.test('cross-device ownership is account-based and author cannot be forged', async () => {
    const id=randomUUID(), commentId=randomUUID();
    const score={notes:[{freq:440,start:0,dur:1}],timbre:'piano',volume:0.5};
    assert.equal((await a.call('forum','publish',{id,title:'test',author:'forged',description:'',score})).status,201);
    const own=await otherDevice.call('forum',`post&id=${id}`);
    assert.equal(own.data.post.mine,true); assert.equal(own.data.post.author,'alice');
    assert.equal((await b.call('forum','withdraw',{id})).status,403);
    assert.equal((await b.call('forum','comment',{id,commentId,author:'forged',content:'hello'})).status,201);
    const comments=await a.call('forum',`comments&id=${id}`);
    assert.equal(comments.data.comments[0].author,'bob');
    assert.equal((await a.call('forum','withdraw-comment',{id,commentId})).status,403);
    assert.equal((await b.call('forum','withdraw-comment',{id,commentId})).status,200);
    assert.equal((await otherDevice.call('forum','withdraw',{id})).status,200);
  });
  await t.test('legacy claims preserve content and can only be claimed once', async () => {
    const raw = randomBytes(32).toString('hex'); a.jar.set('composer_visitor',raw); b.jar.set('composer_visitor',raw);
    const old=visitor(new Request(origin,{headers:{cookie:`composer_visitor=${raw}`}})).actor;
    await pool.query('INSERT INTO composer_actors(token_hash) VALUES($1)',[old]);
    const id=randomUUID();
    await pool.query('INSERT INTO composer_posts(id,actor_hash,title,author,score,duration,note_count) VALUES($1,$2,$3,$4,$5,1,1)',[id,old,'legacy','old nickname','{}']);
    assert.deepEqual((await a.call('auth','claim-legacy',{})).data,{ok:true,posts:1,comments:0});
    assert.equal((await b.call('auth','claim-legacy',{})).status,409);
    assert.equal((await otherDevice.call('forum',`post&id=${id}`)).data.post.mine,true);
    assert.equal((await pool.query('SELECT actor_hash FROM composer_posts WHERE id=$1',[id])).rows[0].actor_hash,accountActor(aId));
  });
  await t.test('wrong current password fails; rotation revokes other sessions; logout revokes current session', async () => {
    assert.equal((await a.call('auth','change-password',{currentPassword:'incorrect-password',newPassword:password+'new'})).status,400);
    assert.equal((await a.call('auth','change-password',{currentPassword:password,newPassword:password+'new'})).status,200);
    assert.equal((await otherDevice.call('auth','session')).data.user,null);
    assert.equal((await a.call('auth','session')).data.user.id,aId);
    assert.equal((await otherDevice.call('auth','login',{username:'alice',password})).status,401);
    assert.equal((await otherDevice.call('auth','login',{username:'alice',password:password+'new'})).status,200);
    const copied = new Map(a.jar);
    assert.equal((await a.call('auth','logout',{})).status,200);
    a.jar.clear(); for(const [key,value] of copied) a.jar.set(key,value);
    assert.equal((await a.call('auth','session')).data.user,null,'copied cookie cannot revive revoked session');
    await pool.query('UPDATE composer_session SET "expiresAt"=now()-interval \'1 hour\' WHERE "userId"=$1',[aId]);
    assert.equal((await otherDevice.call('auth','session')).data.user,null);
  });
  await t.test('registration quota stops fourth account and expires after rolling 24h', async () => {
    assert.equal((await guest.call('auth','register',{username:'carol',password})).status,201);
    const rejected=await client().call('auth','register',{username:'dave',password});
    assert.equal(rejected.status,429); assert.match(rejected.data.error,/24小时/);
    await pool.query('UPDATE composer_registrations SET created_at=now()-interval \'25 hours\'');
    assert.equal((await client().call('auth','register',{username:'dave',password})).status,201);
  });
  await t.test('concurrent reservations cannot exceed three; failed signup frees its reservation', async () => {
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>policy.reserve('concurrent-ip','name'+i)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
    const id=results.find(r=>r.status==='fulfilled').value;
    await policy.releaseFailed(id);
    assert.ok(await policy.reserve('concurrent-ip','replacement'));
  });
  await t.test('login throttling persists in PostgreSQL and cannot be bypassed with another handler instance', async () => {
    for(let i=0;i<10;i++) assert.equal((await client().call('auth','login',{username:'no_such_user',password})).status,401);
    assert.equal((await client().call('auth','login',{username:'no_such_user',password})).status,429);
    const key='shared-limit'; await policy.limit(key,1,60);
    await assert.rejects(createPolicy(pool).limit(key,1,60),{status:429});
    await pool.query('UPDATE composer_auth_limits SET expires_at=now()-interval \'1 second\' WHERE key=$1',[key]);
    await policy.limit(key,1,60);
  });
});
