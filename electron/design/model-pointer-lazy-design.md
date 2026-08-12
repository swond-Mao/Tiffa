# 模型死列表缓存 + 指针懒加载（model-pointer-lazy）设计

> 目标：模型列表全局只加载一次（死列表缓存），每个对话保留模型指针，
> 切换历史会话 / 点开模型列表 / 选择模型全部秒开秒选，仅在发送前物化模型（读指针 → 下发 → 发送）。

## 1. 问题根因分析

### 现象
- 点开模型选择菜单栏时，有时秒出、有时卡在加载（用户感知为"还在加载"）。
- 每次点开都重复探测，浪费；切换历史会话、选模型都可能被模型相关 IPC 拖慢。

### 根因（逐条）
1. **模型列表每次点开全量重查**：`renderer/src/components/ModelPicker.tsx` 的
   `toggle()` 每次展开执行 `setModels(null)` + `loadModelList()`，完整重走：
   - 读 `hidden-models.json`、`enabled-models.json`、`models.yml`（3 个本地 IPC）
   - 调主进程 `tiffa:getModels(sessionId)` → agent 进程 `get_available_models`
     （可能实时探测各 provider 网络端点，最长 10s 超时）
   而模型列表增删后都要重启才生效（`models.yml` 写操作 → `models:restart`），
   运行期内是**死列表**，每次重查纯属浪费。
2. **`sessionController.ts` 的 `availableModelSet`（60s TTL）缓存没被复用**：
   只存 `Set<"provider/modelId">`，且 ModelPicker 不走它；`fetchCurrentModel` 也每次实时 `getModels`。
3. **选模型（`switchModel`）实例就绪时立即下发 `set_model`**：
   与"指针优先"目标不符，且对正在运行的对话有打断风险；
   物化应统一推迟到发送路径（`sendMessage` 里已有 `restoreModelIfAvailable` 可复用）。

### 修复（总览）
- 建模块级**死列表缓存** `modelListCache`（加载一次，含 hidden/enabled/models.yml 过滤链），
  ModelPicker / `getAvailableModelSet` / `fetchCurrentModel` 全部改走缓存 → 点开秒开、零重复探测。
- `switchModel` 改**纯指针记忆**（不再立即下发）→ 秒选。
- 发送路径 `sendMessage` 作为**唯一物化点**：读指针 → 校验可用（走缓存，秒）→
  实例当前模型 ≠ 指针时 `set_model` → 发送；物化期间显示"正在加载模型…"。
- 会话激活路径（ready / switchToSession）保留**后台静默物化**（异步非阻塞，走缓存后开销极小），
  让"打开历史会话"时模型已就位，发送时通常无需再等。

## 2. 实现计划

### 2.1 死列表缓存（`renderer/src/services/sessionController.ts`）

新增模块级状态（复用现有 `switchSeq` 的序号竞态思路）：
```typescript
let modelListCache: TiffaModelInfo[] | null = null;          // 死列表（已过 hidden/enabled/models.yml 过滤）
let modelListPromise: Promise<TiffaModelInfo[] | null> | null = null; // in-flight 去重
let modelListSeq = 0;                                        // 竞态：过期请求返回直接丢弃
```

新增两个导出函数：
- `getModelListCached(force?: boolean): Promise<TiffaModelInfo[] | null>`
  - 有缓存 → 直接返回（秒开）
  - 无缓存 → 发起一次加载（`modelListPromise` 去重，并发调用只发一次）；
    `force=true` 时跳过缓存强制重载
  - 加载主体 = 现 `ModelPicker.loadModelList()` 的完整过滤链
    （hidden-models → enabled-models → models.yml → `tiffa:getModels`；
     `tiffaReady=false` 时走 models.yml 本地兜底）
  - 返回前 `modelListSeq++` 校验，过期丢弃
- `invalidateModelListCache(): void`
  - 置 `modelListCache = null`；不打断 in-flight（下一次自然重载）

改动 `getAvailableModelSet()`：改由 `getModelListCached()` 派生
（`new Set(list.map(m => provider/id))`），删除 60s TTL 逻辑（死列表无需 TTL）。

改动 `fetchCurrentModel()`：`get_state.model` 优先逻辑保留；
兜底"列表第一个"改用 `getModelListCached()`，不再实时 `getModels`。

### 2.2 ModelPicker 改走缓存（`renderer/src/components/ModelPicker.tsx`）

- 删除组件内 `loadModelList` 的全量加载逻辑（hidden/enabled/models.yml 读取 + getModels），
  只保留：`toggle()` 时 `setModels(await getModelListCached())`；
  缓存命中 → 秒渲染；首次无缓存 → 显示加载中。
- 搜索过滤、按供应商分组、当前模型高亮逻辑**不变**。

### 2.3 switchModel 纯指针化（`renderer/src/services/sessionController.ts`）

- `switchModel(provider, modelId)`：只做记忆（`setSessionModel` + `tiffa-lastModel` +
  `setCurrentModel`），**删除** `tiffaReady` 时立即 `setModel` 分支与 `modelSwitching` 锁。
  （物化统一在发送路径；此改动同时消除"运行中切模型打断生成"的风险。）

### 2.4 发送时物化（`renderer/src/services/sessionController.ts` 的 `sendMessage`）

现 `sendMessage` 激活后已有 `restoreModelIfAvailable(...)` 补下发 → 保留作为物化点，增强：
- 物化前 `useUiStore.setState({ modelSwitching: true })` + `setStatusText('正在加载模型…')`；
  完成后复位（复用 `finally`）。
- `restoreModelIfAvailable` 内部改用 `getModelListCached()` 做可用性校验（秒），
  `getState` 防御（实例已是目标模型则跳过 `set_model`）保持不变。
- 物化失败不阻塞发送（现状 `catch ignore` 已如此），toast 提示降级继续。

### 2.5 缓存失效时机

| 触发点 | 处理 |
|---|---|
| SettingsPanel 保存 models.yml / 增删 provider 成功（`writeModelsYml` / `writeTiffaProvider` / `deleteTiffaProvider` 后） | `invalidateModelListCache()`（`renderer/src/components/SettingsPanel.tsx`） |
| 实例重启后 `tiffaReady` false→true（`eventRouter.ts` ready 事件） | `invalidateModelListCache()` + `void getModelListCached()` 预载（后台预热） |
| 应用启动（`App.tsx` 现有 `fetchCurrentModel` 附近） | `void getModelListCached()` 预载（后台预热，不阻塞 UI） |

> 说明：无需改 `main.ts`——所有写配置操作均由 renderer 发起，renderer 侧直接清缓存即可；
> `models:restart` 造成的实例重启通过 ready 事件自然刷新。

## 3. 修改文件清单

| 文件 | 改动范围 |
|---|---|
| `renderer/src/services/sessionController.ts` | 新增死列表缓存（`getModelListCached` / `invalidateModelListCache`）；`getAvailableModelSet` / `fetchCurrentModel` 改走缓存；`switchModel` 纯指针化；`sendMessage` 物化状态提示 |
| `renderer/src/components/ModelPicker.tsx` | 删除全量加载逻辑，改用 `getModelListCached()` |
| `renderer/src/services/eventRouter.ts` | ready 事件：清缓存 + 后台预载 |
| `renderer/src/components/SettingsPanel.tsx` | 配置写成功后 `invalidateModelListCache()` |
| `renderer/src/App.tsx` | 启动时后台预载 `getModelListCached()` |

## 4. 风险与边界

- **多实例并行**：`get_available_models` 按会话实例路由，全局死列表取"当前实例"列表；
  运行期多实例差异极罕见（增删要重启），且实例重启（ready 翻转）即刷新缓存——接受。
- **物化延迟**：本地大模型切换可能要几秒~十几秒，集中在发送前，UI 以
  "正在加载模型…" 提示，符合用户预期（用户感知为模型加载）。
- **纯指针化的行为变化**：在已就绪会话选模型后，实例不立即切，直到下次发送；
  与"运行中切模型不打断生成"目标一致，用户已确认接受。
