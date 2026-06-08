import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = path.join(repoRoot, 'server/data/card-lookup.sqlite');
const db = new Database(dbPath, { readonly: true });

const sets = ['MSH', 'HOB', 'HOC', 'MSC'];
for (const setCode of sets) {
  const rows = db.prepare('SELECT payload FROM card_lookup').all() as Array<{ payload: string }>;
  const names: string[] = [];
  let count = 0;
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      const serialized = JSON.stringify(payload);
      if (!serialized.includes(setCode)) continue;
      count += 1;
      if (names.length < 5 && typeof payload.name === 'string') {
        names.push(payload.name);
      }
    } catch {
      // ignore
    }
  }
  console.log(`${setCode}: ${count} lookup rows referencing set; samples: ${names.join(', ')}`);
}

const built = db.prepare("SELECT value FROM card_lookup_meta WHERE key = 'built_at'").get() as { value: string } | undefined;
const oracleSig = db.prepare("SELECT value FROM card_lookup_meta WHERE key = 'oracle_signature'").get() as { value: string } | undefined;
const total = db.prepare('SELECT COUNT(*) as c FROM card_lookup').get() as { c: number };
console.log(`total_rows=${total.c} built_at=${built?.value ?? 'unknown'} oracle_signature=${oracleSig?.value ?? 'unknown'}`);

db.close();
