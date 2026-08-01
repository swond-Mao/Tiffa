# WebP 静默崩溃：最终方案（2026-08-01 定稿）

> 本文档已按最终落地方案重写。此前的「扩展层白名单」方案（`supportsWebp` + `tool_result` 钩子）已**整体删除**，勿再参考。

## 现象

- 本地多模态模型收到图片后静默卡死：连续多条空白 assistant 消息，`stopReason=stop`，UI 零报错
- 非 error 状态 → 扩展的 error 续行不触发 → 无声失败，会话被污染
- 表现有迷惑性：**小图正常、大图必崩**（小图走内核 fast-path 原样透传，大图才触发重编码）

## 根因链

1. llama.cpp 底层用 **stb_image**，默认不编译 WebP → 解不了 WebP
2. 内核 `utils/image-loading.ts` 的 `modelLacksWebpSupport(model)` **只看 provider key**，名单固定为
   `ollama / ollama-cloud / llama.cpp / lm-studio / local-server`（外加 `api === "ollama-chat"`、`imageInputDecoder === "stb"`）
3. 旧配置的 provider key 叫 `qwen` / `qwen-remote` → 不命中 → 内核认为「支持 WebP」→ `excludeWebP` 为 false
4. `utils/image-resize.ts` 对超过阈值的图重编码，候选格式优先 WebP → 发出 WebP
5. 端点返回 HTTP 200 但 `choices` 为空 → 内核当正常 stop → 静默崩

## 三条失效路径（历史方案为何没救回来）

| # | 失效点 | 说明 |
|---|--------|------|
| 1 | 白名单是空的 | models.yml 里一个 `supportsWebp: true` 都没写，`shouldConvert` 恒为 true，退化成全黑名单；云端也在陪跑转 PNG |
| 2 | 只挂 `tool_result` | 拖拽图是用户消息 content block，走 `frame.images` 直达内核，**不产生工具结果事件**，扩展拦不到 |
| 3 | 内核会转回去 | 就算扩展转成 PNG，内核 `normalizeModelContextImages` 仍对每张图跑 `resizeImage`，大图又被编码回 WebP |

结论：问题出在**内核图片归一化环节**，那是扩展够不着的层。修复必须作用在内核的判定输入上。

## 最终方案：让 provider key 命中内核约定名

改 `data/agent/models.yml` 的 provider key，不写任何自定义字段（自定义字段会被内核 schema 静默剥离）：

```yaml
qwen:        →  llama.cpp:      # 127.0.0.1:11434   本地直连
qwen-remote: →  local-server:   # 47.108.197.247:9876  frp 中继
```

配套改动：

- `data/agent/config.yml`：modelRoles 的 `default` / `smol` / `commit` → `llama.cpp/localmodel`
- `data/agent/session-model-map.json`：批量替换 24 条历史映射（已备份 `.bak`）
- `plugins/claude-mode-extension.ts`：删除白名单 4 段共约 58 行（838 → 780 行）

### 为什么远程中继选 `local-server` 而不是 `llama.cpp`

`config/append-only-context-mode.ts` 的 `LOCAL_INFERENCE_PROVIDERS` 只含
`ollama / ollama-cloud / lm-studio / llama.cpp`，**不含 `local-server`**。

- 本地直连 → `llama.cpp`：append-only 本就因 `127.0.0.1` 命中 loopback 判定而开启，改名后行为零变化
- 远程中继 → `local-server`：公网 IP 不是 loopback，`local-server` 也不在 Set 里 → append-only 保持关闭，与改名前一致

撞名风险已排除：`model-registry.ts:1493` 对 `llama.cpp` 的自动注册有 `configuredProviders.has()` 守卫，用户配置存在时内核直接跳过，不会 merge 也不会覆盖 baseUrl / api。`local-server` 内核无自动注册逻辑。

带点号的 key 也安全：`parseModelString("llama.cpp/localmodel")` 用 `indexOf("/")` 分割，点号不参与解析。

## supportsTools 修正（2026-08-01）

`local-server` 原标 `supportsTools: false`，与实际不符——后面是同一台 llama.cpp，只是换了传输通道。

该字段不是「禁用工具」，而是切换工具调用协议。`sdk.ts:607-619`：

```ts
if (format === "auto") {
  if (model?.supportsTools !== false) return undefined;  // undefined = 原生 function calling
  const preferred = preferredDialect(model.id);
  return preferred === FALLBACK_DIALECT ? "glm" : preferred;
}
```

`tools.format` 未在 settings 表设置 → 默认 `auto`。实测：

```text
FALLBACK_DIALECT = "xml"；preferredDialect("localmodel") = "xml"
llama.cpp/localmodel    supportsTools:true   => dialect undefined  → 原生 function calling
local-server/localmodel supportsTools:false  => dialect "glm"      → in-band 文本协议
```

标 `false` 的副作用：工具清单以 `# Tool:` 文本塞进 system prompt（`sdk.ts:2842-2844`）每轮烧 token、格式易错乱、崩坏时漏成普通文本正好撞 TTSR 规则 `no-xml-toolcall.md`。已改为 `true`。

同期删除 `plugins/xml-tool-translator.ts`（40KB 死文件，`electron/main.js` 从未加载，只加载 claude-mode-extension 与 computer-use-extension）。

## 验证方法

直接调内核函数，这是最硬的证据：

```bash
cd G:/Tiffa/npm-global/node_modules/@oh-my-pi/pi-coding-agent
bun -e 'const {modelLacksWebpSupport}=await import("./src/utils/image-loading.ts");
for (const p of ["llama.cpp","local-server","qwen","kimi"])
  console.log(p, modelLacksWebpSupport({provider:p, api:"openai-completions"}))'
```

预期：`llama.cpp` / `local-server` → `true`（排除 WebP，发 PNG）；云端 → `false`（保留 WebP 压缩）。

## 注意

models.yml / config.yml / 扩展均为**启动时加载**，改完必须重启 Tiffa 才生效。
