# openclaw-experience-replay

给 OpenClaw 用的经验回放插件：记录成功任务轨迹，在下一次相似任务开始前召回并注入少量成功案例，帮助 Agent 从过去的成功中获取参考——无需微调，本地运行。

## 特性

- 本地 SQLite 存储，无需任何训练步骤
- 默认离线 lexical embedding，开箱即用
- **Ollama 支持** — 使用 `nomic-embed-text` 等本地模型提升语义召回
- 可选 OpenAI embedding（`text-embedding-3-small` 等）
- **混合检索** — Ollama/OpenAI 模式下自动融合神经相似度与词法相似度，改善召回
- 使用 `before_prompt_build` 注入经验
- 使用 `after_tool_call`、`llm_output`、`agent_end` 记录成功轨迹
- 使用最近候选窗口控制检索成本，经验积累后仍可用
- 带运行级别 trace registry，OpenClaw 暴露 run id 时可区分并发任务
- **可配置评分权重** — 自定义什么样的运行才值得记忆
- **中英双语注入** — `language: "zh"` 或 `"en"`，或 `"auto"` 自动检测
- **CLI 工具** — 查看、删除、重置经验库，随时可管理

## 工作流程

1. `before_prompt_build` 检索最相似的成功经验。
2. 插件把经验压缩成 `<experience_replay>` 上下文注入到 prompt 前。
3. `after_tool_call` 和 `llm_output` 持续记录本轮轨迹。
4. `agent_end` 对本轮打分，只把高质量、非失败轨迹写入经验库。

## 启用方式

在 `openclaw.json` 中加载本插件：

```json
{
  "plugins": {
    "entries": {
      "experience-replay": { "enabled": true }
    },
    "load": { "paths": ["./openclaw-experience-replay"] }
  }
}
```

## 配置说明

所有字段均为可选，以下为默认值：

```json
{
  "storePath": "~/.openclaw/experience-replay.db",
  "maxExamples": 3,
  "maxCandidates": 250,
  "similarityThreshold": 0.32,
  "language": "auto",
  "embedding": {
    "provider": "lexical"
  },
  "success": {
    "minScore": 0.65
  }
}
```

### 使用 Ollama 本地 embedding（无需 API Key）

```json
{
  "embedding": {
    "provider": "ollama",
    "ollamaModel": "nomic-embed-text",
    "ollamaBaseUrl": "http://localhost:11434",
    "hybridWeight": 0.7
  }
}
```

`hybridWeight` 控制神经相似度与词法相似度的融合比例：
- `1.0` = 纯神经
- `0.0` = 纯词法
- `0.7` = 默认（70% 神经 + 30% 词法）

### 使用 OpenAI embedding

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "openaiApiKey": "sk-...",
    "hybridWeight": 0.7
  }
}
```

### 自定义评分权重

评分权重决定一次运行是否值得被记忆，可以调整来适应你的 Agent 场景。

```json
{
  "success": {
    "minScore": 0.65,
    "scoreWeights": {
      "success":             0.55,
      "finalAnswer":         0.20,
      "toolUse":             0.15,
      "directAnswer":        0.10,
      "noNegativeFeedback":  0.15
    }
  }
}
```

| 权重 | 触发条件 |
|------|---------|
| `success` | 本轮被标记为成功 |
| `finalAnswer` | 存在非空、非错误的最终回答 |
| `toolUse` | 至少调用了一次工具 |
| `directAnswer` | 无工具调用（直接回答） |
| `noNegativeFeedback` | prompt 中不含负反馈关键词 |

## 关键配置速查

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `maxExamples` | `3` | 每次检索并注入的经验条数 |
| `maxCandidates` | `250` | 参与排序的最近候选数 |
| `similarityThreshold` | `0.32` | 经验被召回的最低相似度 |
| `language` | `"auto"` | 注入语言：`"zh"`、`"en"` 或 `"auto"` |
| `success.minScore` | `0.65` | 写入经验库前必须达到的最低分 |
| `embedding.hybridWeight` | `0.7` | 神经/词法混合比例（仅 Ollama/OpenAI 有效） |

## CLI 工具

```bash
# 列出最近的经验（默认 20 条）
npx experience-replay list --limit 20

# 按 ID（或 ID 前缀）删除某条经验
npx experience-replay delete a1b2c3d4

# 重置全部经验（带确认提示，--yes 跳过确认）
npx experience-replay reset --yes

# 查看数据库统计信息
npx experience-replay stats

# 指定自定义数据库路径
npx experience-replay list --db /path/to/experience-replay.db
```

## 质量保证

- 通过内容指纹跳过重复经验。
- 鉴权错误、HTTP 失败等"像失败"的输出不会被写入。
- 没有最终回答的不完整运行不会被写入。
- 含负反馈关键词的 prompt 得分过低，自动被过滤。

## 开发

```bash
npm test
npm run typecheck
```
