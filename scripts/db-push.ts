/**
 * Applies db/schema.sql to the database in DATABASE_URL (read from the shell or
 * from .env.local). Every statement is idempotent, so running it repeatedly is safe.
 *
 *   npm run db:push
 */
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

async function main() {
  const env = readEnv();
  const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is missing — set it in the shell or in .env.local');
    process.exit(1);
  }

  const sqlText = readFileSync('db/schema.sql', 'utf8');
  const sql = neon(url);

  // the driver sends one statement per call, so split on semicolons at line ends
  const statements = sqlText
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement);
    const label = statement.split('\n').find((line) => line.trim()) ?? statement;
    console.log(`  ok  ${label.trim().slice(0, 72)}`);
  }
  console.log(`\nSchema applied: ${statements.length} statements.`);
}

main().catch((error) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
