"""Model gateway: route /v1/chat/completions by model name to llama.cpp or vLLM.

Per-request model routing, streaming passthrough. Point any OpenAI-compatible
client (ccz, curl, ...) at http://<host>:8080/v1 and pick the model per call.

Edit MODEL_ROUTES below to add/rename models. ROUTE_BY_CLASS lets ccz's
gateway hint headers (CLAUDE_CODE_GATEWAY_HINT_HEADERS=1) steer classifier /
compaction / subagent traffic to a cheaper model.

Self-check:  python gateway.py --check
"""
import time
from collections import OrderedDict

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

# model alias -> (backend base URL, downstream model name)
# downstream model = None keeps the requested name (vLLM is fine with that;
# llama.cpp validates the name against its loaded model, so set the exact
# served name there).
MODEL_ROUTES = OrderedDict(
    [
        ("glm-4.7-flash", ("http://127.0.0.1:8002/v1", None)),  # vLLM
        ("qwen3.8-27b", ("http://127.0.0.1:8001/v1", "qwen3.8-27b")),  # llama.cpp (start with --alias qwen3.8-27b)
    ]
)

# Optional: route by ccz request class instead of model name. ccz sends
# x-claude-code-request-class / x-claude-code-agent-type when started with
# CLAUDE_CODE_GATEWAY_HINT_HEADERS=1. Keys are matched in order against
# "<request-class>" then "agent:<agent-type>"; first hit wins. Values are
# MODEL_ROUTES aliases. Leave empty to route purely by model.
ROUTE_BY_CLASS = {
    # "auto_mode": "qwen3.8-27b",   # permission classifier -> cheap local model
    # "compact": "qwen3.8-27b",
    # "agent:subagent": "qwen3.8-27b",
}


def _class_override(headers) -> str | None:
    cls = headers.get("x-claude-code-request-class")
    agent = headers.get("x-claude-code-agent-type")
    for key in (cls, f"agent:{agent}" if agent else None):
        if key and key in ROUTE_BY_CLASS:
            return ROUTE_BY_CLASS[key]
    return None


app = FastAPI(title="model gateway")
client = httpx.AsyncClient(timeout=None)

_cache = {"t": 0.0, "models": []}


def _backend_for(model: str) -> tuple[str, str] | None:
    route = MODEL_ROUTES.get(model)
    if not route:
        return None
    base, downstream = route
    return (base, downstream or model)


@app.get("/v1/models")
async def models():
    now = time.time()
    if now - _cache["t"] > 10:
        ids = []
        for base, _ in MODEL_ROUTES.values():
            try:
                r = await client.get(base + "/models", timeout=3)
                ids += [m["id"] for m in r.json().get("data", [])]
            except Exception:
                pass  # backend down -> skip its listed models
        _cache.update(t=now, models=sorted(set(ids)))
    return {
        "object": "list",
        "data": [{"id": i, "object": "model", "owned_by": "gateway"} for i in _cache["models"]],
    }


@app.post("/v1/chat/completions")
async def chat(req: Request):
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"error": {"message": "invalid JSON body", "type": "invalid_request_error"}}, status_code=400)

    backend = _backend_for(_class_override(req.headers) or body.get("model", ""))
    if not backend:
        return JSONResponse(
            {
                "error": {
                    "message": f"unknown model '{body.get('model')}'. Available: {', '.join(MODEL_ROUTES)}",
                    "type": "invalid_request_error",
                }
            },
            status_code=404,
        )
    base, downstream = backend

    headers = {
        k: v for k, v in req.headers.items()
        if k.lower() in ("authorization", "content-type")
    }
    payload = dict(body, model=downstream)

    if body.get("stream"):
        return StreamingResponse(
            _proxy_stream(base, payload, headers),
            media_type="text/event-stream",
        )

    r = await client.post(base + "/chat/completions", json=payload, headers=headers)
    return JSONResponse(r.json(), status_code=r.status_code)


async def _proxy_stream(base, payload, headers):
    try:
        async with client.stream("POST", base + "/chat/completions", json=payload, headers=headers) as r:
            async for chunk in r.aiter_bytes():
                yield chunk
    except httpx.HTTPError:
        yield b'data: {"error":{"message":"backend unreachable"}}\n\n'

if __name__ == "__main__":
    import sys

    if "--check" in sys.argv:
        ROUTE_BY_CLASS.update({"auto_mode": "qwen3.8-27b", "agent:subagent": "glm-4.7-flash"})
        assert _class_override({"x-claude-code-request-class": "auto_mode"}) == "qwen3.8-27b"
        assert _class_override({"x-claude-code-agent-type": "subagent"}) == "glm-4.7-flash"
        assert _class_override({"x-claude-code-request-class": "repl_main_thread"}) is None
        assert _class_override({}) is None
        assert _backend_for("qwen3.8-27b") == ("http://127.0.0.1:8001/v1", "qwen3.8-27b")
        assert _backend_for("nope") is None
        print("ok")
