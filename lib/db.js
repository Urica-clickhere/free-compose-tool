import { communitySchema } from './community-schema.js';
import { neon } from '@neondatabase/serverless';
import { ForumError } from './validation.js';
let sql;
let ready;
export function database() {
  if (!process.env.DATABASE_URL) throw new ForumError(503, '社区暂时不可用，请稍后重试');
  return sql ||= neon(process.env.DATABASE_URL);
}
export async function initialize() {
  const db = database();
  ready ||= db.transaction(communitySchema.map(statement => db.query(statement, []))).catch(error => { ready = undefined; throw error; });
  await ready;
}
