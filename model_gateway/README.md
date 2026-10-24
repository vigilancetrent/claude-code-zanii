# model_gateway

Tiny FastAPI proxy: one OpenAI-compatible `/v1` endpoint in front of llama.cpp + vLLM (or anything else that speaks Chat Completions), routed per request by model name.

```bash
pip install -r requirements.txt
uvicorn gateway:app --host 0.0.0.0 --port 8080
python gateway.py --check   # self-test of the routing tables
```

Point ccz at it:

```bash
CLAUDE_CODE_USE_OPENAI=1 OPENAI_BASE_URL=http://127.0.0.1:8080/v1 OPENAI_API_KEY=x ccz
```

`/v1/models` aggregates whatever the backends report, so `/model` in ccz lists them all.

## Route by request class

Start ccz with `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` and it tags every request with
`x-claude-code-request-class` (e.g. `repl_main_thread`, `auto_mode`, `compact`) and
`x-claude-code-agent-type` (`main` / `subagent`). Fill `ROUTE_BY_CLASS` in `gateway.py` to
send the cheap traffic to a small model regardless of what the client asked for:

```python
ROUTE_BY_CLASS = {
    "auto_mode": "qwen3.8-27b",        # permission classifier
    "compact": "qwen3.8-27b",
    "agent:subagent": "qwen3.8-27b",
}
```
