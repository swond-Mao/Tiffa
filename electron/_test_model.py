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

# 测试用模型路径（按需修改）
# model_path = r'D:\path\to\your\model.gguf'
model_path = r'PATH_TO_YOUR_MODEL'

print('=== llama.cpp 本地 + enable_thinking:false ===')
test_with_thinking_off('http://LOCALHOST:11434/v1', 'localmodel')  # 改为你的本地服务器地址
print('=== 远程中继 + enable_thinking:false ===')
test_with_thinking_off('http://YOUR_SERVER_IP:9876/v1', 'localmodel')  # 改为你的服务器地址
