import { Database } from 'bun:sqlite';

// 检查 models.db
try {
  const d = new Database('data/agent/models.db', { readonly: true });
  const tables = d.query("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('=== models.db tables ===');
  console.log(tables.map(t => t.name).join(', '));
  
  for (const t of tables) {
    try {
      const rows = d.query(`SELECT * FROM ${t.name} LIMIT 10`).all();
      if (rows.length > 0) {
        console.log(`\n--- ${t.name} (${rows.length} rows) ---`);
        for (const r of rows) {
          const str = JSON.stringify(r);
          console.log(str.substring(0, 200));
        }
      }
    } catch (e) {
      console.log(`${t.name}: ${e.message}`);
    }
  }
  d.close();
} catch (e) {
  console.log('models.db error:', e.message);
}

// 检查 agent.db 中所有 settings
console.log('\n=== agent.db ALL settings ===');
const d2 = new Database('data/agent/agent.db', { readonly: true });
const all = d2.query("SELECT key, value FROM settings ORDER BY key").all();
for (const r of all) {
  console.log(`${r.key} = ${r.value}`);
}
d2.close();
