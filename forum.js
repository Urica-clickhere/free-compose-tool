import { accounts } from './accounts.js';
const $ = id => document.getElementById(id);
const composer = window.ComposerForum;
const { MAX_COMMUNITY_DURATION_SECONDS, TIMBRE_KEYS, scoreTimbres } = window.ComposerScoreModel;
const state = { page: 0, posts: new Map(), detail: null, generation: 0, mine: false, query: '', playing: null, timer: null, publish: null, commentDraft: null };
const date = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const duration = value => `${Number(value).toFixed(1)} 秒`;
function node(tag, cls, content) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (content !== undefined) el.textContent = content;
  return el;
}
function button(label, action, cls = 'btn btn-secondary') {
  const el = node('button', cls, label); el.type = 'button';
  el.addEventListener('click', () => Promise.resolve(action(el)).catch(error => notice(error.message)));
  return el;
}
let noticeTimer;
function notice(message) {
  $('forumNotice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('forumNotice').textContent = ''; }, 6000);
}
function confirmAction(title, message, label) {
  const dialog = $('confirmDialog');
  if (dialog.open) return Promise.resolve(false);
  $('confirmHeading').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmAccept').textContent = label;
  return new Promise(resolve => {
    const finish = accepted => {
      dialog.close();
      $('confirmAccept').removeEventListener('click', accept);
      $('confirmCancel').removeEventListener('click', cancel);
      dialog.removeEventListener('cancel', cancel);
      resolve(accepted);
    };
    const accept = () => finish(true);
    const cancel = event => { event?.preventDefault(); finish(false); };
    $('confirmAccept').addEventListener('click', accept);
    $('confirmCancel').addEventListener('click', cancel);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
    $('confirmCancel').focus();
  });
}
async function api(action, params = {}, body) {
  if (body && !['withdraw','withdraw-comment'].includes(action) && !await accounts.require()) throw new Error('登录后请再次提交，内容已保留');
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/forum?${query}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  }).catch(() => { throw new Error('网络连接失败，请检查网络后重试'); });
  const data = await response.json().catch(() => { throw new Error('社区暂时不可用，请稍后重试'); });
  if (!response.ok) {
    if (response.status === 401) { await accounts.refresh().catch(() => {}); accounts.open(); }
    throw new Error(data.error || '操作失败，请稍后重试');
  }
  return data;
}
function stopPreview() {
  clearTimeout(state.timer);
  state.playing = null;
  document.querySelectorAll('[data-preview]').forEach(el => { el.textContent = '▶ 试听'; el.setAttribute('aria-pressed', 'false'); });
}
window.addEventListener('composer-stop', stopPreview);
function validScore(score) {
  return score && Array.isArray(score.notes) && score.notes.length > 0 && score.notes.length <= 512 && typeof score.volume === 'number' && score.volume >= 0 && score.volume <= 1 &&
    TIMBRE_KEYS.includes(score.timbre) &&
    score.notes.every(n => n && TIMBRE_KEYS.includes(n.timbre ?? score.timbre) && [n.freq,n.start,n.dur].every(x => typeof x === 'number' && Number.isFinite(x)) && n.freq >= 20 && n.freq <= 20000 && n.start >= 0 && n.dur > 0 && n.start + n.dur <= MAX_COMMUNITY_DURATION_SECONDS);
}
async function fetchPost(id) {
  const cached = state.posts.get(id);
  if (cached?.score) return cached;
  const { post } = await api('post', { id });
  if (!validScore(post.score)) throw new Error('这首作品的乐谱格式不正确');
  state.posts.set(id, post);
  return post;
}
async function preview(id, el) {
  if (state.playing === id) { composer.stop(); return; }
  await composer.unlock();
  const generation = state.generation;
  const original = el.textContent;
  el.disabled = true; el.textContent = '准备试听…';
  try {
    const post = await fetchPost(id);
    if (generation !== state.generation || !el.isConnected) return;
    const seconds = await composer.preview(post.score);
    if (!seconds) return;
    state.playing = id;
    document.querySelectorAll('[data-preview]').forEach(btn => {
      const playing = btn.dataset.preview === id;
      btn.textContent = playing ? '■ 停止试听' : '▶ 试听'; btn.setAttribute('aria-pressed', String(playing));
    });
    state.timer = setTimeout(() => { composer.stop(); }, seconds * 1000);
  } catch (error) { el.textContent = original; throw error; }
  finally { el.disabled = false; }
}
async function importPost(id, el) {
  el.disabled = true;
  try {
    const post = await fetchPost(id);
    if (!await confirmAction('导入社区乐谱', '导入后会替换工作台的当前音符。建议先导出保存当前编曲。', '确认导入')) return;
    composer.import(post.score);
    location.hash = 'compose';
    notice(`已导入「${post.title}」，可以继续编曲或导出音频`);
  } finally { el.disabled = false; }
}
async function copyLink(id) {
  const url = new URL(location.href); url.hash = `work/${id}`;
  try { await navigator.clipboard.writeText(url.href); notice('作品链接已复制'); }
  catch { prompt('复制这个作品链接分享给朋友：', url.href); }
}
function metadata(post) {
  const el = node('div', 'forum-meta');
  el.append(node('span', '', post.author), node('span', '', date(post.created_at)));
  if (post.mine) el.append(node('span', '', '你发布的'));
  return el;
}
function badges(post) {
  const el = node('div');
  const timbres = post.score ? scoreTimbres(post.score) : post.timbres?.length ? post.timbres : [post.timbre];
  const sound = node('span', 'forum-chip', timbres.length > 1 ? `混合音色 · ${timbres.length}种` : composer.timbreName(timbres[0]));
  sound.title = timbres.map(key => composer.timbreName(key)).join(' / ');
  el.append(sound, node('span', 'forum-chip', duration(post.duration)), node('span', 'forum-chip', `${post.note_count} 个音符`));
  return el;
}
function previewButton(post) {
  const el = button('▶ 试听', btn => preview(post.id, btn), 'btn btn-success');
  el.dataset.preview = post.id; el.setAttribute('aria-pressed', 'false');
  return el;
}
function card(post) {
  const el = node('article', 'forum-card');
  el.append(node('h3', '', post.title), metadata(post), badges(post), node('p', 'forum-description', post.description || '作者留下了一段旋律，等你来听。'));
  const actions = node('div', 'forum-card-actions');
  actions.append(previewButton(post), button('查看作品', () => { location.hash = `work/${post.id}`; }), button('导入编曲器', btn => importPost(post.id, btn)));
  el.append(actions, node('div', 'forum-stats', `♡ ${post.likes} 赞　 ·　 ${post.comments} 条评论`));
  return el;
}
async function loadFeed(append = false) {
  const generation = ++state.generation;
  if (!append) { state.page = 0; $('forumList').replaceChildren(node('p', 'forum-empty', '正在加载作品…')); }
  $('forumMore').hidden = true;
  const at = state.page;
  try {
    const data = await api('list', { q: state.query, mine: state.mine ? '1' : '0', offset: String(at) });
    if (generation !== state.generation) return;
    if (!append) $('forumList').replaceChildren();
    if (!data.posts.length && !append) {
      const empty = node('div', 'forum-empty');
      empty.append(node('strong', '', state.query || state.mine ? '还没有找到作品' : '社区的第一首作品，等你来发布'), node('p', '', state.query || state.mine ? '试试其他关键词，或分享你的第一段旋律。' : '在工作台完成编曲，点击“发布当前编曲”，把灵感分享给大家。'), button('发布当前编曲', openPublish, 'btn btn-success'));
      $('forumList').append(empty);
    }
    for (const post of data.posts) { state.posts.set(post.id, post); $('forumList').append(card(post)); }
    state.page = at + data.posts.length;
    $('forumMore').hidden = !data.hasMore;
  } catch (error) {
    if (generation !== state.generation) return;
    if (append) { $('forumMore').hidden = false; notice(error.message); }
    else {
      const empty = node('div', 'forum-empty');
      empty.append(node('strong', '', '作品暂时没有加载成功'), node('p', '', error.message), button('重新加载', () => loadFeed()));
      $('forumList').replaceChildren(empty);
    }
  }
}
function field(form, label, id, type, max, placeholder) {
  const text = node('label', '', label); text.htmlFor = id;
  const input = node(type === 'textarea' ? 'textarea' : 'input');
  input.id = id; input.required = true; input.maxLength = max; input.placeholder = placeholder;
  if (type !== 'textarea') input.type = type;
  form.append(text, input);
  return input;
}
async function loadDetail(id) {
  const generation = ++state.generation;
  state.detail = id;
  const view = $('forumDetail'); view.replaceChildren(node('p', 'forum-empty', '正在加载作品…'));
  try {
    const [{ post }, initialComments] = await Promise.all([api('post', { id }), api('comments', { id })]);
    if (generation !== state.generation) return;
    if (!validScore(post.score)) throw new Error('作品的乐谱格式不正确');
    state.posts.set(id, post);
    view.replaceChildren(button('← 返回作品社区', () => { location.hash = 'community'; }, 'btn btn-secondary forum-back'));
    const work = node('article', 'forum-detail-card');
    work.append(node('h2', 'work-title', post.title), metadata(post), badges(post), node('p', 'forum-description', post.description || '作者没有填写介绍，直接听听这段旋律吧。'));
    const actions = node('div', 'forum-card-actions');
    const like = button(`${post.liked ? '♥ 已赞' : '♡ 点赞'} ${post.likes}`, async el => {
      el.disabled = true;
      try {
        const data = await api('like', {}, { id, liked: !post.liked });
        post.liked = data.post.liked; post.likes = data.post.likes;
        el.textContent = `${post.liked ? '♥ 已赞' : '♡ 点赞'} ${post.likes}`;
        el.setAttribute('aria-pressed', String(post.liked));
      } finally { el.disabled = false; }
    });
    like.setAttribute('aria-pressed', String(post.liked));
    actions.append(previewButton(post), button('导入编曲器', el => importPost(id, el)), like, button('复制分享链接', () => copyLink(id)));
    if (post.mine) actions.append(button('撤回作品', async el => {
      if (!await confirmAction('撤回这首作品', '撤回后，其他人将无法查看或试听这首作品。', '确认撤回作品')) return;
      el.disabled = true;
      try { await api('withdraw', {}, { id }); state.posts.delete(id); location.hash = 'community'; notice('作品已撤回'); }
      finally { el.disabled = false; }
    }, 'btn btn-danger'));
    else actions.append(button('举报', async el => {
      const reason = prompt('请说明举报原因（最多500个字符），管理员可在数据库中查看：');
      if (!reason?.trim()) return;
      el.disabled = true;
      try { await api('report', {}, { id, reason }); notice('举报已记录，感谢你的反馈'); }
      finally { el.disabled = false; }
    }));
    work.append(actions); view.append(work);
    const commentsSection = node('section', 'section forum-comments');
    const heading = node('h3', '', `评论 · ${post.comments}`);
    const commentsList = node('div');
    let commentAt = 0;
    function appendComments(data) {
      if (commentAt === 0) commentsList.replaceChildren();
      for (const c of data.comments) {
        const row = node('article', 'forum-comment');
        row.append(metadata(c), node('p', 'forum-description', c.content));
        if (c.mine) row.append(button('撤回评论', async el => {
          if (!await confirmAction('撤回这条评论', '撤回后，其他人将无法看到这条评论。', '确认撤回评论')) return;
          el.disabled = true;
          try { await api('withdraw-comment', {}, { id, commentId: c.id }); await loadDetail(id); }
          finally { el.disabled = false; }
        }));
        commentsList.append(row);
      }
      commentAt += data.comments.length;
      if (!commentAt) commentsList.append(node('p', 'forum-muted', '还没有评论，来聊聊这段旋律吧。'));
      more.hidden = !data.hasMore;
    }
    const more = button('加载更多评论', async el => {
      el.disabled = true;
      try { const data = await api('comments', { id, offset: String(commentAt) }); if (generation === state.generation) appendComments(data); }
      finally { el.disabled = false; }
    });
    appendComments(initialComments);
    const form = node('form', 'comment-form');
    const author = field(form, '评论账号', 'commentAuthor', 'text', 24, '登录后可发表评论'); author.value = accounts.user?.username || ''; author.readOnly = true; author.required = false;
    const content = field(form, '写下评论', 'commentContent', 'textarea', 1000, '说说你听到的灵感，或者给作者一些建议');
    if (state.commentDraft?.id === id) content.value = state.commentDraft.content;
    const info = node('p', 'forum-muted', '登录后发表评论，换设备也能管理自己的评论。');
    const errorEl = node('p', 'forum-error'); errorEl.setAttribute('role', 'alert');
    const submit = node('button', 'btn btn-primary', '发表评论'); submit.type = 'submit';
    let commentId = crypto.randomUUID();
    form.addEventListener('submit', async event => {
      event.preventDefault(); errorEl.textContent = ''; submit.disabled = true;
      try {
        await api('comment', {}, { id, commentId, author: author.value, content: content.value });
        state.commentDraft = null; commentId = crypto.randomUUID(); composer.stop();
        await loadDetail(id); notice('评论已发布');
      } catch (error) { errorEl.textContent = error.message; }
      finally { submit.disabled = false; }
    });
    form.append(info, errorEl, submit);
    commentsSection.append(heading, commentsList, more, form); view.append(commentsSection);
  } catch (error) {
    if (generation !== state.generation) return;
    const empty = node('div', 'forum-empty');
    empty.append(node('strong', '', error.message), button('返回社区', () => { location.hash = 'community'; }), button('重试', () => loadDetail(id)));
    view.replaceChildren(empty);
  }
}
async function openPublish() {
  if (!await accounts.require()) return;
  const score = composer.snapshot();
  if (!validScore(score)) { notice(`请先完成有效乐谱：1–512个音符，频率20–20000 Hz，总时长不超过4分钟（${MAX_COMMUNITY_DURATION_SECONDS}秒）`); return; }
  state.publish = { id: crypto.randomUUID(), score };
  $('publishAuthor').value = accounts.user.username;
  $('publishError').textContent = '';
  $('publishSummary').textContent = `本次分享：${score.notes.length} 个音符 · ${duration(Math.max(...score.notes.map(n => n.start + n.dur)))} · ${scoreTimbres(score).map(key => composer.timbreName(key)).join(' / ')}`;
  $('publishDialog').showModal();
  $('publishTitle').focus();
}
$('publishForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.publish) return;
  $('publishSubmit').disabled = true; $('publishError').textContent = '';
  try {
    const { id } = await api('publish', {}, { ...state.publish, title: $('publishTitle').value, author: $('publishAuthor').value, description: $('publishDescription').value });
    $('publishDialog').close(); $('publishForm').reset(); state.publish = null;
    location.hash = `work/${id}`; notice('作品已发布，可以复制链接分享给朋友');
  } catch (error) { $('publishError').textContent = error.message; }
  finally { $('publishSubmit').disabled = false; }
});
$('closePublish').addEventListener('click', () => { if (!$('publishSubmit').disabled) $('publishDialog').close(); });
$('publishDialog').addEventListener('cancel', event => { if ($('publishSubmit').disabled) event.preventDefault(); });
$('shareCurrent').addEventListener('click', openPublish);
$('sharePlayback').addEventListener('click', openPublish);
$('composeTab').addEventListener('click', () => { location.hash = 'compose'; });
$('communityTab').addEventListener('click', () => { if (location.hash === '#community') loadFeed(); else location.hash = 'community'; });
$('forumSearch').addEventListener('submit', event => { event.preventDefault(); state.query = $('forumQuery').value.trim(); composer.stop(); loadFeed(); });
$('forumMine').addEventListener('change', () => { state.mine = $('forumMine').checked; composer.stop(); loadFeed(); });
$('forumRefresh').addEventListener('click', () => { composer.stop(); loadFeed(); });
$('forumMore').addEventListener('click', async () => { $('forumMore').disabled = true; try { await loadFeed(true); } finally { $('forumMore').disabled = false; } });
function route() {
  composer.stop();
  const match = location.hash.match(/^#work\/([0-9a-f-]{36})$/i);
  const community = location.hash === '#community' || Boolean(match);
  $('composerView').hidden = community; $('forumView').hidden = !community;
  $('composeTab').classList.toggle('active', !community); $('composeTab').setAttribute('aria-pressed', String(!community));
  $('communityTab').classList.toggle('active', community); $('communityTab').setAttribute('aria-pressed', String(community));
  $('forumFeed').hidden = Boolean(match); $('forumDetail').hidden = !match;
  if (match) loadDetail(match[1]);
  else if (community) loadFeed();
  else { ++state.generation; state.detail = null; composer.refresh(); }
}
window.addEventListener('hashchange', route);
window.addEventListener('account-change', () => {
  state.posts.clear();
  const draft = $('commentContent');
  if (draft && state.detail) state.commentDraft = { id: state.detail, content: draft.value };
  $('publishAuthor').value = accounts.user?.username || '';
  if (location.hash === '#community' || location.hash.startsWith('#work/')) route();
});
accounts.ready.then(route);
