import urllib.request, json

def test_with_thinking_off(url, model):
    body = json.dumps({
        'model': model,
        'messages': [{'role':'user','content':'用一句话介绍你自己'}],
        'max_tokens': 200,
        'temperature': 0.3,
        'chat_template_kwargs': {'enable_thinking': False},
    }).encode()
    req = urllib.request.Request(url + '/chat/completions', data=body, method='POST', headers={'Content-Type':'application/json'})
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        raw = resp.read().decode('utf-8', errors='replace')
        data = json.loads(raw)
        msg = data.get('choices',[{}])[0].get('message',{})
        print(f'  HTTP {resp.status}')
        print(f'  content: {msg.get("content","")!r}')
        print(f'  reasoning_content 长度: {len(msg.get("reasoning_content") or "")}')
        print(f'  finish_reason: {data.get("choices",[{}])[0].get("finish_reason")}')
        print()
    except Exception as e:
        print(f'  FAIL: {e}')
        print()

model_path = r'D:\AI\llm-models\qwen3.6\qwen3.6-27B\Qwen3.6-27B-NVFP4-MTP-GGUF.gguf'

print('=== llama.cpp 本地 + enable_thinking:false ===')
test_with_thinking_off('http://LOCALHOST:11434/v1', 'localmodel')
print('=== 远程中继 + enable_thinking:false ===')
test_with_thinking_off('http://YOUR_SERVER_IP:9876/v1', 'localmodel')
