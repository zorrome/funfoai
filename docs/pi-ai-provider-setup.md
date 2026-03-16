# pi-ai Provider Setup

The app generation flow now uses a provider layer built on `@mariozechner/pi-ai` instead of a hard-coded OpenClaw endpoint.

## What Changed

- Workspace generation (`POST /api/apps/:id/chat`) now streams through `pi-ai`.
- Repair passes and release publish generation also use the same provider entry point.
- The backend no longer ships with a default OpenClaw URL or token.

## Recommended Local Setup

### Ollama

```bash
export FUNFO_AI_BASE_URL=http://127.0.0.1:11434/v1
export FUNFO_AI_PROVIDER=ollama
export FUNFO_AI_MODEL=qwen2.5-coder:14b
export FUNFO_AI_API_KEY=dummy
```

If your Ollama model does not support the `developer` role or `reasoning_effort`, the server already applies safer defaults for Ollama-style endpoints.

### OpenAI

```bash
export FUNFO_AI_PROVIDER=openai
export FUNFO_AI_MODEL=gpt-4o-mini
export FUNFO_AI_API_KEY=your_api_key
```

## Optional Advanced Flags

- `FUNFO_AI_API=openai-completions`
- `FUNFO_AI_TIMEOUT_MS=300000`
- `FUNFO_AI_MAX_RETRY=2`
- `FUNFO_AI_CONTEXT_WINDOW=131072`
- `FUNFO_AI_MODEL_MAX_TOKENS=8192`
- `FUNFO_AI_COMPAT_NO_DEVELOPER_ROLE=1`
- `FUNFO_AI_COMPAT_NO_REASONING_EFFORT=1`
- `FUNFO_AI_COMPAT_NO_STORE=1`
- `FUNFO_AI_COMPAT_NO_STREAM_USAGE=1`

## Notes

- `FUNFO_AI_BASE_URL` expects the API root, for example `http://127.0.0.1:11434/v1`.
- If you accidentally paste a full endpoint like `/v1/chat/completions`, the server trims it back to the API root automatically.
- If no provider is configured, generation routes now fail fast with setup instructions instead of silently falling back to OpenClaw.
