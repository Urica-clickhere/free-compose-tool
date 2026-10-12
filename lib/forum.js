import { randomBytes, createHash } from 'node:crypto';
import { database, initialize } from './db.js';
import { ForumError, text, uuid, offset, postInput, checkOrigin, readBody } from './validation.js';
const COOKIE = 'composer_visitor';
const hash = value => createHash('sha256').update(value).digest('hex');
export function visitor(request, create = false) {
  const raw = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const known = typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw);
  const token = known ? raw : create ? randomBytes(32).toString('hex') : null;
  return { actor: token ? hash(token) : '', cookie: !known && token ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` : null };
}
function result(data, status = 200, cookie = null) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
}
async function limit(db, actor, request, kind) {
  const period = kind === 'post' ? 86400 : 3600;
  const max = kind === 'post' ? 10 : kind === 'comment' ? 60 : 120;
  // On Vercel this header is set by the platform. Local development uses a single IP bucket.
  const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || 'unknown' : 'local';
  const bucket = Math.floor(Date.now() / 1000 / period);
  const counters = await db.transaction([actor, hash(ip)].map(key => db`
    INSERT INTO composer_rate_limits(key, bucket, count) VALUES (${kind + ':' + key}, ${bucket}, 1)
    ON CONFLICT(key, bucket) DO UPDATE SET count = composer_rate_limits.count + 1
    RETURNING count
  `));
  if (counters.some(rows => rows[0].count > max)) throw new ForumError(429, '操作太频繁，请稍后再试');
}
async function visiblePost(db, id, actor, includeScore = true) {
  const rows = await db`SELECT p.id, p.title, p.author, p.description, p.duration, p.note_count, p.created_at,
    ${includeScore} AS include_score, CASE WHEN ${includeScore} THEN p.score ELSE NULL END AS score,
    (p.actor_hash = ${actor}) AS mine,
    (SELECT count(*)::int FROM composer_likes l WHERE l.post_id = p.id) AS likes,
    EXISTS(SELECT 1 FROM composer_likes l WHERE l.post_id=p.id AND l.actor_hash=${actor}) AS liked,
    (SELECT count(*)::int FROM composer_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comments
    FROM composer_posts p WHERE p.id = ${id} AND p.deleted_at IS NULL`;
  if (!rows.length) throw new ForumError(404, '这首作品不存在或已撤回');
  return rows[0];
}
export async function handleForum(request) {
  let cookie;
  try {
    const url = new URL(request.url);
    if (!['GET', 'POST'].includes(request.method)) return result({ error: '不支持的操作' }, 405);
    const action = url.searchParams.get('action') || 'list';
    if (request.method === 'POST') checkOrigin(request);
    const body = request.method === 'POST' ? await readBody(request) : null;
    const identity = visitor(request, request.method === 'POST');
    cookie = identity.cookie;
    const actor = identity.actor;
    await initialize();
    const db = database();
    if (request.method === 'GET') {
      if (action === 'list') {
        const q = text(url.searchParams.get('q') || '', 80, '搜索词', false);
        const at = offset(url.searchParams.get('offset'));
        const mine = url.searchParams.get('mine') === '1';
        const posts = await db`SELECT p.id, p.title, p.author, p.description, p.duration, p.note_count, p.created_at,
          p.score->>'timbre' AS timbre, (p.actor_hash=${actor}) AS mine,
          (SELECT count(*)::int FROM composer_likes l WHERE l.post_id=p.id) AS likes,
          EXISTS(SELECT 1 FROM composer_likes l WHERE l.post_id=p.id AND l.actor_hash=${actor}) AS liked,
          (SELECT count(*)::int FROM composer_comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comments
          FROM composer_posts p WHERE p.deleted_at IS NULL AND (NOT ${mine} OR p.actor_hash=${actor})
          AND (${q} = '' OR strpos(lower(p.title || ' ' || p.author || ' ' || p.description), lower(${q})) > 0)
          ORDER BY p.created_at DESC, p.id DESC LIMIT 21 OFFSET ${at}`;
        return result({ posts: posts.slice(0, 20), hasMore: posts.length > 20 });
      }
      const id = uuid(url.searchParams.get('id'));
      if (action === 'post') return result({ post: await visiblePost(db, id, actor) });
      if (action === 'comments') {
        await visiblePost(db, id, actor, false);
        const at = offset(url.searchParams.get('offset'));
        const comments = await db`SELECT id, author, content, created_at, actor_hash=${actor} AS mine
          FROM composer_comments WHERE post_id=${id} AND deleted_at IS NULL ORDER BY created_at, id LIMIT 31 OFFSET ${at}`;
        return result({ comments: comments.slice(0, 30), hasMore: comments.length > 30 });
      }
      throw new ForumError(404, '页面不存在');
    }
    await db`INSERT INTO composer_actors(token_hash) VALUES (${actor}) ON CONFLICT DO NOTHING`;
    if (action === 'publish') {
      const data = postInput(body);
      const previous = await db`SELECT id, actor_hash=${actor} AS mine, deleted_at FROM composer_posts WHERE id=${data.id}`;
      if (previous.length) {
        if (!previous[0].mine || previous[0].deleted_at) throw new ForumError(409, '作品编号已使用，请重新发布');
        return result({ id: data.id }, 200, cookie);
      }
      await limit(db, actor, request, 'post');
      const duration = Math.max(...data.score.notes.map(n => n.start + n.dur));
      const created = await db`INSERT INTO composer_posts(id, actor_hash, title, author, description, score, duration, note_count)
        VALUES (${data.id}, ${actor}, ${data.title}, ${data.author}, ${data.description}, ${JSON.stringify(data.score)}::jsonb, ${duration}, ${data.score.notes.length}) ON CONFLICT(id) DO NOTHING RETURNING id`;
      if (!created.length) {
        const same = await db`SELECT id FROM composer_posts WHERE id=${data.id} AND actor_hash=${actor} AND deleted_at IS NULL`;
        if (!same.length) throw new ForumError(409, '作品编号已使用');
      }
      return result({ id: data.id }, 201, cookie);
    }
    const id = uuid(body.id);
    const post = await visiblePost(db, id, actor, false);
    if (action === 'comment') {
      const commentId = uuid(body.commentId);
      const author = text(body.author, 24, '昵称');
      const content = text(body.content, 1000, '评论');
      const existing = await db`SELECT id FROM composer_comments WHERE id=${commentId} AND actor_hash=${actor} AND post_id=${id} AND deleted_at IS NULL`;
      if (existing.length) return result({ ok: true }, 200, cookie);
      await limit(db, actor, request, 'comment');
      const added = await db`INSERT INTO composer_comments(id, post_id, actor_hash, author, content) SELECT ${commentId}, ${id}, ${actor}, ${author}, ${content} FROM composer_posts WHERE id=${id} AND deleted_at IS NULL ON CONFLICT(id) DO NOTHING RETURNING id`;
      if (!added.length) throw new ForumError(409, '评论未提交，请刷新后再试');
      return result({ ok: true }, 201, cookie);
    }
    if (action === 'like') {
      if (typeof body.liked !== 'boolean') throw new ForumError(400, '点赞参数不正确');
      await limit(db, actor, request, 'reaction');
      if (body.liked) await db`INSERT INTO composer_likes(post_id,actor_hash) SELECT ${id},${actor} FROM composer_posts WHERE id=${id} AND deleted_at IS NULL ON CONFLICT DO NOTHING`;
      else await db`DELETE FROM composer_likes WHERE post_id=${id} AND actor_hash=${actor}`;
      return result({ post: await visiblePost(db, id, actor, false) }, 200, cookie);
    }
    if (action === 'withdraw') {
      if (!post.mine) throw new ForumError(403, '只能撤回自己发布的作品');
      await db`UPDATE composer_posts SET deleted_at=now() WHERE id=${id} AND actor_hash=${actor} AND deleted_at IS NULL`;
      return result({ ok: true }, 200, cookie);
    }
    if (action === 'withdraw-comment') {
      const commentId = uuid(body.commentId);
      const removed = await db`UPDATE composer_comments SET deleted_at=now() WHERE id=${commentId} AND post_id=${id} AND actor_hash=${actor} AND deleted_at IS NULL RETURNING id`;
      if (!removed.length) throw new ForumError(403, '只能撤回自己的评论');
      return result({ ok: true }, 200, cookie);
    }
    if (action === 'report') {
      const reason = text(body.reason, 500, '举报原因');
      await limit(db, actor, request, 'reaction');
      await db`INSERT INTO composer_reports(post_id, actor_hash, reason) VALUES (${id},${actor},${reason}) ON CONFLICT(post_id,actor_hash) DO UPDATE SET reason=EXCLUDED.reason`;
      return result({ ok: true }, 200, cookie);
    }
    throw new ForumError(404, '操作不存在');
  } catch (error) {
    if (error instanceof ForumError) return result({ error: error.message }, error.status, cookie);
    // Do not log connection strings, submitted scores, visitor tokens, or database error details.
    console.error('forum_request_failed', { code: typeof error.code === 'string' ? error.code : 'unknown' });
    return result({ error: '社区暂时不可用，请稍后重试' }, 503, cookie);
  }
}
