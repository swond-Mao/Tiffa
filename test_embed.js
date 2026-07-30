// 测试 embedding 是否能正常工作
// 使用正确的模型名 "BAAI/bge-small-zh-v1.5"

import { embed, available, currentEmbeddingModel, isApiModel, embeddingsDisabled } from 'file:///G:/Tiffa/npm-global/node_modules/@oh-my-pi/pi-coding-agent/node_modules/@oh-my-pi/pi-mnemopi/src/core/embeddings.ts';
import { fileURLToPath } from 'url';
import path from 'path';

// 设置 HOME 环境变量（便携包路径）
process.env.HOME = 'G:/Tiffa/home';
process.env.USERPROFILE = 'G:/Tiffa/home';

async function test() {
  console.log('=== Embedding 诊断测试 ===\n');
  
  // 1. 检查配置
  console.log('1. 配置检查:');
  console.log('   embeddingsDisabled():', embeddingsDisabled());
  const model = currentEmbeddingModel();
  console.log('   currentEmbeddingModel():', model);
  console.log('   isApiModel(model):', isApiModel(model));
  
  // 2. 检查可用性
  console.log('\n2. 可用性检查:');
  const avail = await available();
  console.log('   available():', avail);
  
  // 3. 测试 embed
  console.log('\n3. embed() 测试:');
  const texts = ['你好世界', 'hello world'];
  console.log('   输入文本:', texts);
  
  const start = Date.now();
  const result = await embed(texts);
  const elapsed = Date.now() - start;
  
  console.log('   embed() 返回:', result === null ? 'null' : `Array(${result.length})`);
  console.log('   耗时:', elapsed, 'ms');
  
  if (result) {
    console.log('   向量维度:', result[0]?.length);
    console.log('   ✓ Embedding 生成成功!');
  } else {
    console.log('   ✗ Embedding 生成失败!');
  }
  
  // 4. 检查环境变量
  console.log('\n4. 环境变量:');
  console.log('   MNEMOPI_EMBEDDING_MODEL:', process.env.MNEMOPI_EMBEDDING_MODEL || '(未设置)');
  console.log('   MNEMOPI_EMBEDDING_API_KEY:', process.env.MNEMOPI_EMBEDDING_API_KEY ? '(已设置)' : '(未设置)');
  console.log('   MNEMOPI_EMBEDDINGS_VIA_API:', process.env.MNEMOPI_EMBEDDINGS_VIA_API || '(未设置)');
  console.log('   MNEMOPI_NO_EMBEDDINGS:', process.env.MNEMOPI_NO_EMBEDDINGS || '(未设置)');
  
  // 5. 检查模型文件
  console.log('\n5. 模型文件检查:');
  const fs = await import('fs');
  const cacheDir = path.join(process.env.HOME || process.env.USERPROFILE, '.omp', 'cache', 'fastembed');
  console.log('   缓存目录:', cacheDir);
  
  if (fs.existsSync(cacheDir)) {
    const dirs = fs.readdirSync(cacheDir);
    console.log('   模型目录:', dirs);
    
    for (const dir of dirs) {
      const modelPath = path.join(cacheDir, dir, 'model_optimized.onnx');
      if (fs.existsSync(modelPath)) {
        const size = fs.statSync(modelPath).size;
        console.log('   ', dir, ':', size, 'bytes');
      }
    }
  }
}

test().catch(console.error);
