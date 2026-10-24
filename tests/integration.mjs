import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const base = process.env.FORUM_BASE_URL;
if (!base) throw new Error('Set FORUM_BASE_URL to the deployment under test.');
if (!process.env.TEST_ACCOUNTS_FILE) throw new Error('Set TEST_ACCOUNTS_FILE to a private JSON file containing two dedicated test accounts.');
const credentials = JSON.parse(await readFile(process.env.TEST_ACCOUNTS_FILE, 'utf8'));
function client() {
  let cookie = process.env.FORUM_BYPASS_COOKIE || '';
  return async (action, params={}, body, origin=new URL(base).origin, area='forum') => {
    const response = await fetch(`${base}/api/${area}?${new URLSearchParams({action,...params})}`, {
      method:body?'POST':'GET', headers:{...(cookie?{Cookie:cookie}:{}), ...(body?{Origin:origin,'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(30000)
    });
    for(const raw of response.headers.getSetCookie()) {
      const value = raw.split(';')[0]; const key=value.split('=')[0];
      cookie = cookie.split('; ').filter(c=>!c.startsWith(key+'=')).concat(value).filter(Boolean).join('; ');
    }
    const data = await response.json();
    return {status:response.status,data};
  };
}
test('real database: publish, read as another visitor, preserve sound, like, comment and enforce ownership', async () => {
  const owner=client(),other=client(),device=client(),guest=client(),id=randomUUID(),commentId=randomUUID();
  for (const [call, credential] of [[owner,credentials.owner],[other,credentials.other]]) {
    if(process.env.TEST_REGISTER_ACCOUNTS==='1') {
      const signup=await call('register',{},credential,undefined,'auth');
      assert.ok([201,409].includes(signup.status),JSON.stringify(signup));
    }
    const login=await call('login',{},credential,undefined,'auth');
    assert.equal(login.status,200,JSON.stringify(login));
    assert.equal(login.data.user.username,credential.username.toLowerCase());
    assert.equal(login.data.token,undefined);
  }
  assert.equal((await device('login',{},credentials.owner,undefined,'auth')).status,200);
  assert.equal((await guest('publish',{},{})).status,401);
  const score={notes:[{freq:440,start:0,dur:0.2,timbre:'piano'},{freq:523,start:0,dur:0.2,timbre:'strings'},{freq:659.25,start:0.1,dur:0.2,timbre:'guitar'}],timbre:'flute',volume:0.4};
  let created=false;
  try {
    const pub=await owner('publish',{}, {id,title:'[临时功能验证] '+id.slice(0,8),author:'功能验证',description:'自动验证完成后撤回',score});
    assert.equal(pub.status,201);created=true;
    assert.equal((await owner('publish',{}, {id,title:'不会重复发布',author:'功能验证',description:'',score})).status,200);
    const read=await other('post',{id});assert.equal(read.status,200);assert.deepEqual(read.data.post.score,score);assert.equal(read.data.post.mine,false);
    assert.equal((await owner('post',{id})).data.post.mine,true);
    assert.equal((await device('post',{id})).data.post.mine,true);
    assert.equal((await owner('post',{id})).data.post.author,credentials.owner.username.toLowerCase());
    const feed=await other('list',{q:id.slice(0,8)});assert.equal(feed.status,200);assert.equal(feed.data.posts.filter(p=>p.id===id).length,1);
    assert.deepEqual([...feed.data.posts.find(p=>p.id===id).timbres].sort(),['guitar','piano','strings']);
    assert.equal((await other('withdraw',{}, {id})).status,403);
    assert.equal((await other('like',{}, {id,liked:true})).data.post.likes,1);
    assert.equal((await other('like',{}, {id,liked:true})).data.post.likes,1);
    assert.equal((await other('like',{}, {id,liked:false})).data.post.likes,0);
    assert.equal((await other('comment',{}, {id,commentId,author:'试听者',content:'<script>这是纯文本测试</script>'})).status,201);
    assert.equal((await other('comment',{}, {id,commentId,author:'试听者',content:'重复请求'})).status,200);
    const comments=await owner('comments',{id});assert.equal(comments.data.comments.length,1);assert.equal(comments.data.comments[0].mine,false);
    assert.equal((await owner('withdraw-comment',{}, {id,commentId})).status,403);
    assert.equal((await other('withdraw-comment',{}, {id,commentId})).status,200);
    assert.equal((await owner('comments',{id})).data.comments.length,0);
    assert.equal((await owner('comment',{}, {id,commentId:randomUUID(),author:'验证',content:'csrf'},'https://evil.example')).status,403);
    assert.equal((await other('report',{}, {id,reason:'临时验证举报记录'})).status,200);
    assert.equal((await owner('withdraw',{}, {id})).status,200);created=false;
    assert.equal((await other('post',{id})).status,404);
    // Changing to the same test password exercises credential verification and revocation
    // without storing a second set of test credentials between runs.
    assert.equal((await owner('change-password',{}, {currentPassword:credentials.owner.password,newPassword:credentials.owner.password},undefined,'auth')).status,200);
    assert.equal((await device('session',{},undefined,undefined,'auth')).data.user,null);
    assert.equal((await owner('session',{},undefined,undefined,'auth')).data.user.username,credentials.owner.username.toLowerCase());
    console.log('Cloud accounts, cross-device ownership, sharing, CSRF and session revocation verified.');
  } finally {
    if(created)await owner('withdraw',{}, {id});
    for(const call of [owner,other,device]) await call('logout',{}, {},undefined,'auth');
  }
});
