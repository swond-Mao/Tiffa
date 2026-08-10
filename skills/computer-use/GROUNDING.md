# Computer Use 视觉定位模型（MCP Grounding）配置

Tiffa 的 Computer Use（电脑控制）功能使用 **MCP 方式**调用视觉定位模型（Grounding Model），
用于"看懂屏幕并点击"（如 ui_tars 视觉定位）。配置文件为同目录下的 `grounding.json`。

## 推荐：火山方舟（豆包）视觉模型

豆包 Seed 系列视觉定位模型效果好、国内可直连，是默认推荐。

### 1. 获取 API Key

1. 打开 [火山方舟控制台](https://console.volcengine.com/ark) 并登录
2. 左侧「API Key 管理」→「创建 API Key」，复制 `ark-` 开头的 key
3. 在「开通管理」中开通你需要的模型（如 `doubao-seed-2-1-turbo-260628`）

### 2. 填写 grounding.json

编辑 `skills/computer-use/grounding.json`：

```json
{
  "api_base": "https://ark.cn-beijing.volces.com/api/v3",
  "model": "doubao-seed-2-1-turbo-260628",
  "api_key": "你的ARK_API_KEY",
  "enabled": "1"
}
```

字段说明：
- `api_base`：火山方舟 API 地址（OpenAI 兼容格式）
- `model`：模型 ID，常用豆包视觉模型见下表
- `api_key`：上一步创建的 `ark-` 开头 key
- `enabled`：`"1"` 启用，`"0"` 关闭（默认关闭，避免误启动）

### 3. 常用豆包视觉模型

| 模型 ID | 说明 |
|---|---|
| `doubao-seed-2-1-turbo-260628` | 推荐，视觉定位准确 |
| `doubao-seed-1-6-vision-250528` | 通用视觉理解 |
| `doubao-1-5-vision-pro-32k-250115` | 旧版视觉 Pro |

> 具体可用模型以火山方舟控制台「开通管理」为准。

### 4. 启用 Computer Use

在 Tiffa 桌面端：设置 → Computer Use 开关打开（或命令行 `tiffa-desktop.exe --enable-computer-use`）。
启用后 Tiffa 的 MCP 会通过 grounding.json 配置的模型进行屏幕理解与点击定位。

## 备用：其他 OpenAI 兼容视觉模型

grounding.json 也兼容任何 OpenAI 格式的视觉模型端点，只需改 `api_base` 和 `model` 即可：

```json
{
  "api_base": "https://api.xxx.com/v1",
  "model": "your-vision-model",
  "api_key": "YOUR_KEY",
  "enabled": "1"
}
```

## 安全提示

- `grounding.json` 会被 git 跟踪，**不要把真实 API Key 提交到仓库**。
  仓库内使用 `YOUR_ARK_API_KEY` 占位符，安装后请修改为自己的 key。
- 若确认泄露，立即在火山方舟控制台吊销并重建 API Key。
