import { Database } from 'bun:sqlite';

const dbPath = 'data/agent/memories/mnemopi/mnemopi.db';
console.log('=== Mnemopi Embedding 端到端验证 ===\n');
console.log('数据库:', dbPath);

const d = new Database(dbPath, { readonly: true });

// 1. 查看表结构
const tables = d.query("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\n1. 所有表:', tables.map(t => t.name).join(', '));

// 2. 检查 embedding 表
try {
  const cnt = d.query('SELECT COUNT(*) as c FROM memory_embeddings').get();
  console.log('\n2. memory_embeddings 总行数:', cnt.c);
  
  if (cnt.c > 0) {
    const sample = d.query('SELECT memory_id, length(embedding_json) as json_len, model FROM memory_embeddings ORDER BY rowid DESC LIMIT 5').all();
    console.log('   最新 5 条:');
    for (const s of sample) {
      console.log(`   - ${s.memory_id.substring(0, 12)}... | json_len=${s.json_len} | model=${s.model}`);
    }
    
    // 检查向量维度
    const one = d.query('SELECT embedding_json FROM memory_embeddings ORDER BY rowid DESC LIMIT 1').get();
    if (one) {
      const vec = JSON.parse(one.embedding_json);
      console.log(`\n3. 最新向量维度: ${vec.length}`);
      console.log(`   前5个值: [${vec.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
      console.log(`   模型: ${sample[0]?.model}`);
      
      if (vec.length === 512) {
        console.log('\n   ✓ 维度 512 = BAAI/bge-small-zh-v1.5（中文模型）正确!');
      } else if (vec.length === 384) {
        console.log('\n   ✗ 维度 384 = BAAI/bge-small-en-v1.5（英文模型）— 环境变量未生效!');
      } else {
        console.log(`\n   ? 维度 ${vec.length} — 未知模型`);
      }
    }
  } else {
    console.log('\n   ✗ 没有任何 embedding！autoRetain 从未成功生成向量。');
  }
} catch (e) {
  console.log('\n2. memory_embeddings 表不存在:', e.message);
}

// 3. 检查 episodic_memory（retain 写入的记忆）
try {
  const epCnt = d.query('SELECT COUNT(*) as c FROM episodic_memory').get();
  console.log(`\n4. episodic_memory 总行数: ${epCnt.c}`);
  const latest = d.query('SELECT id, substr(content, 1, 60) as preview, created_at FROM episodic_memory ORDER BY rowid DESC LIMIT 3').all();
  for (const l of latest) {
    console.log(`   - ${l.created_at} | ${l.preview}...`);
  }
} catch (e) {
  console.log('\n4. episodic_memory 查询失败:', e.message);
}

d.close();
console.log('\n=== 验证完成 ===');
