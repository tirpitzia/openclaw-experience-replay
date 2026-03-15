# openclaw-experience-replay

Contextual experience replay plugin for OpenClaw. It stores successful task trajectories, retrieves similar past wins before a run, and injects them as concise in-context guidance.

## Features

- SQLite-backed local memory with no training step
- Functional, no-frills replay pipeline
- Offline-first lexical embeddings by default
- Optional OpenAI embeddings for stronger retrieval
- Prompt injection through `before_prompt_build`
- Success capture through `agent_end`
- Recent-candidate retrieval window to keep replay fast as memory grows
- Run-aware trace registry that separates concurrent runs when OpenClaw exposes run ids

## How It Works

1. `before_prompt_build` retrieves the top matching past successes.
2. The plugin injects a short `<experience_replay>` block ahead of the prompt.
3. `after_tool_call` and `llm_output` accumulate the run trace.
4. `agent_end` scores the run and stores only successful, non-failure-shaped trajectories.

## Install

```bash
npm install
```

Then load the plugin from your `openclaw.json`:

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

## Config

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

Switch to OpenAI embeddings by setting:

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "openaiApiKey": "sk-..."
  }
}
```

## Key Options

- `topK`: final number of recalled experiences to inject
- `maxExamples`: hard cap on injected examples, even if `topK` is higher
- `maxCandidates`: number of recent stored experiences to rank before choosing `topK`
- `similarityThreshold`: minimum similarity score required for replay
- `success.minScore`: minimum capture score required before a run is stored

## Quality Notes

- Duplicate experiences are ignored via a content fingerprint.
- Failure-looking outputs such as auth errors are not persisted.
- Incomplete runs with no final answer are skipped.

## Development

```bash
npm test
npm run typecheck
```
