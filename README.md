# openclaw-experience-replay

![Demo](https://github.com/user-attachments/assets/95847fce-5c2e-4a76-bee1-d62ac3fcaa4a)

Contextual experience replay plugin for OpenClaw. It stores successful task trajectories, retrieves similar past wins before a run, and injects them as concise in-context guidance — no fine-tuning required.

## Quick Start

Install from npm:

```bash
openclaw plugins install experience-replay
```

Then enable and configure it in your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "experience-replay": {
        "enabled": true,
        "config": {
          "storePath": "~/.openclaw/experience-replay.db",
          "maxExamples": 3
        }
      }
    }
  }
}
```

For local development, you can link the current checkout instead:

```bash
openclaw plugins install -l ./openclaw-experience-replay
```

## Features

- SQLite-backed local memory with no training step
- Offline-first lexical embeddings by default
- **Ollama support** — use `nomic-embed-text` or any local model via the Ollama API
- Optional OpenAI embeddings (`text-embedding-3-small`, etc.)
- **Hybrid retrieval** — combines neural + lexical similarity for better recall when using Ollama/OpenAI
- Prompt injection through `before_prompt_build`
- Success capture through `after_tool_call`, `llm_output`, and `agent_end`
- Recent-candidate retrieval window to keep replay fast as memory grows
- Run-aware trace registry that separates concurrent runs
- **Configurable scoring weights** — tune what matters for your use case
- **Bilingual prompts** — `language: "zh"` or `"en"`, or `"auto"` to detect from env
- **CLI tool** — list, delete, and reset stored experiences

## How It Works

1. `before_prompt_build` retrieves the top matching past successes.
2. The plugin injects a short `<experience_replay>` block ahead of the prompt.
3. `after_tool_call` and `llm_output` accumulate the run trace.
4. `agent_end` scores the run and stores only high-quality, non-failure trajectories.

## Config

All fields are optional. Defaults shown below.

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

### Ollama embeddings (local, no API key)

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

`hybridWeight` controls the blend between neural (Ollama/OpenAI) and lexical similarity:
- `1.0` = pure neural
- `0.0` = pure lexical
- `0.7` = default (70% neural + 30% lexical)

### OpenAI embeddings

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

### Custom scoring weights

The success score determines whether a run is worth storing. Tune the weights to reflect what matters for your agent.

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

| Weight | Awarded when… |
|--------|--------------|
| `success` | The run is flagged as succeeded |
| `finalAnswer` | A non-empty, non-error answer is present |
| `toolUse` | At least one tool call was made |
| `directAnswer` | No tool calls (direct answer only) |
| `noNegativeFeedback` | Prompt contains no configured negative-feedback patterns |

## Key Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxExamples` | `3` | Number of past experiences to retrieve and inject |
| `maxCandidates` | `250` | Recent experiences to rank before selecting top matches |
| `similarityThreshold` | `0.32` | Minimum similarity score for retrieval |
| `language` | `"auto"` | Language for injected prompts: `"zh"`, `"en"`, or `"auto"` |
| `success.minScore` | `0.65` | Minimum score required to store a run |
| `embedding.hybridWeight` | `0.7` | Neural vs. lexical blend (Ollama/OpenAI only) |

## CLI

Manage stored experiences from the command line:

```bash
# List recent experiences
npx experience-replay list --limit 20

# Delete a specific experience (id prefix works)
npx experience-replay delete a1b2c3d4

# Reset all stored experiences
npx experience-replay reset --yes

# Show DB statistics
npx experience-replay stats

# Point at a custom DB path
npx experience-replay list --db /path/to/experience-replay.db
```

## Quality Notes

- Duplicate experiences are ignored via a content fingerprint.
- Failure-shaped outputs (HTTP errors, auth errors) are not persisted.
- Incomplete runs with no final answer are skipped.
- Negative-feedback patterns (configurable) cause the run to score below `minScore` and be dropped.

## Development

```bash
npm test
npm run typecheck
```
