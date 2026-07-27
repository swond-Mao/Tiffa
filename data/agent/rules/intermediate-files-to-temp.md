---
description: "中间产物必须写入 .temp 目录，最终产物才放在项目目录"
condition: ["tool:(write|edit)\\([\\s\\S]*?(?!\\.temp)[\\'\"]/(?!\\.temp)"]
scope: "tool:write(*), tool:edit(*)"
interruptMode: "always"
---

## 规则：中间产物必须写入 .temp 目录

### 问题
你被发现在项目工作目录中直接创建中间产物文件，污染了项目目录结构。

### 正确行为
1. **中间产物**（调试文件、临时脚本、测试输出、缓存文件等）必须写入项目目录下的 `.temp/` 文件夹
2. **最终产物**（正式交付的代码、文档、报告等）才放在项目目录的根目录或指定输出位置
3. 如果 `.temp/` 目录不存在，先创建它

### 判断标准
- 问：这是最终要交付给用户的东西吗？
  - **是** → 放在项目目录
  - **否** → 放在 `.temp/` 目录

### 示例

✅ 正确：
```
write(".temp/debug_output.txt", "...")
write("src/final_module.ts", "...")
```

❌ 错误：
```
write("debug_output.txt", "...")      # 中间产物放错位置
write("test_temp.csv", "...")         # 临时文件放错位置
```

### 注意事项
- `.temp/` 目录本身可以在项目目录根
- 中间产物使用有意义的前缀命名，如 `.temp/debug_`, `.temp/tmp_`
- 完成后可清理 `.temp/` 中的过期文件
