# openclaw-experience-replay

这是一个给 OpenClaw 用的经验回放插件：记录成功任务轨迹，在下一次相似任务开始前召回并注入少量成功案例，帮助 Agent 做到从过去成功中获取帮助。

## 特性

- 本地 SQLite 存储，无需训练
- 默认离线 lexical embedding，可直接跑
- 可选 OpenAI embedding 提升检索质量
- 使用 `before_prompt_build` 注入经验
- 使用 `agent_end` 记录成功轨迹
- 使用最近候选窗口控制检索成本，经验变多后仍然可用
- 带运行级别 trace registry，OpenClaw 暴露 run id 时可区分并发任务

## 工作流程

1. `before_prompt_build` 检索最相似的成功经验。
2. 插件把经验压缩成 `<experience_replay>` 上下文注入到 prompt 前。
3. `after_tool_call` 和 `llm_output` 持续记录本轮轨迹。
4. `agent_end` 对本轮打分，只把足够成功、且不像失败报错的结果写入经验库。

## 启用方式

在 `openclaw.json` 中加载本插件目录，并开启 `experience-replay`：

```json
{
  "plugins": {
    "entries": {
      "experience-replay": {
        "enabled": true
      }
    },
    "load": {
      "paths": ["./openclaw-experience-replay"]
    }
  }
}
```

## 推荐配置

```json
{
  "storePath": "~/.openclaw/experience-replay.db",
  "topK": 3,
  "maxCandidates": 250,
  "similarityThreshold": 0.35,
  "embedding": {
    "provider": "lexical"
  }
}
```

## 关键配置

- `topK`：最终注入 prompt 的经验条数
- `maxExamples`：注入示例的硬上限，即使 `topK` 更高也会截断
- `maxCandidates`：参与排序的最近经验候选数
- `similarityThreshold`：经验被召回的最低相似度阈值
- `success.minScore`：经验被写入前必须达到的最低成功分

## 质量保证

- 通过内容指纹跳过重复经验
- 鉴权错误、HTTP 失败等“像失败”的输出不会被写入
- 没有最终回答的不完整运行不会被写入
