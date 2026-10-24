export const communitySchema = [
  "CREATE TABLE IF NOT EXISTS composer_actors (token_hash text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())",
  "CREATE TABLE IF NOT EXISTS composer_posts (id uuid PRIMARY KEY, actor_hash text NOT NULL REFERENCES composer_actors(token_hash), title text NOT NULL, author text NOT NULL, description text NOT NULL DEFAULT '', score jsonb NOT NULL, duration double precision NOT NULL, note_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)",
  "CREATE INDEX IF NOT EXISTS composer_posts_latest ON composer_posts(created_at DESC, id DESC) WHERE deleted_at IS NULL",
  "CREATE TABLE IF NOT EXISTS composer_comments (id uuid PRIMARY KEY, post_id uuid NOT NULL REFERENCES composer_posts(id), actor_hash text NOT NULL REFERENCES composer_actors(token_hash), author text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)",
  "CREATE INDEX IF NOT EXISTS composer_comments_post ON composer_comments(post_id, created_at, id) WHERE deleted_at IS NULL",
  "CREATE TABLE IF NOT EXISTS composer_likes (post_id uuid NOT NULL REFERENCES composer_posts(id), actor_hash text NOT NULL REFERENCES composer_actors(token_hash), PRIMARY KEY (post_id, actor_hash))",
  "CREATE TABLE IF NOT EXISTS composer_reports (post_id uuid NOT NULL REFERENCES composer_posts(id), actor_hash text NOT NULL REFERENCES composer_actors(token_hash), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(post_id, actor_hash))",
  "CREATE TABLE IF NOT EXISTS composer_rate_limits (key text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, PRIMARY KEY (key, bucket))"
];
