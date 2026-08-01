import { Database } from 'bun:sqlite';

const d = new Database('data/agent/models.db', { readonly: true });

// 查看 ollama 和 llama 相关的缓存
const providers = ['ollama', 'llama.cpp', 'llama-local', 'home-models'];
for (const p of providers) {
  const row = d.query('SELECT models, updated_at FROM model_cache WHERE provider_id = ?').get(p);
  if (row) {
    console.log(`\n=== ${p} (updated: ${new Date(row.updated_at).toISOString()}) ===`);
    try {
      const models = JSON.parse(row.models);
      for (const m of models.slice(0, 5)) {
        console.log(`  ${m.id}: contextWindow=${m.contextWindow}, maxTokens=${m.maxTokens}`);
      }
      if (models.length > 5) console.log(`  ... and ${models.length - 5} more`);
    } catch (e) {
      console.log('  parse error:', row.models.substring(0, 200));
    }
  }
}

// 也查一下有没有 qwen 的缓存
const qwen = d.query("SELECT provider_id, models FROM model_cache WHERE provider_id LIKE '%qwen%'").all();
console.log('\n=== qwen entries ===');
console.log(qwen.length > 0 ? JSON.stringify(qwen.map(q => q.provider_id)) : 'NONE');

d.close();
