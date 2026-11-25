# Zanii Mandate: Python reference

Package: PyPI `zanii-mandate-sdk` **0.2.0** (import `zanii_mandate`), Python 3.12+, standard
library only. Extras: `zanii-mandate-sdk[fastapi]`, `zanii-mandate-sdk[django]`.

```sh
pip install "zanii-mandate-sdk==0.2.0"
```

The Python client covers the **Verify API** only: verify, batch, the operation lifecycle (reserve,
dispatch, commit, unknown), public keys and status. It has no issue, revoke, approval or
`get_operation` method and no offline cryptographic verifier (offline verification is the Node
`verifyLocal`).

## Client

```python
import os
from zanii_mandate import MandateClient

client = MandateClient(
    verify_base_url=os.environ["ZANII_VERIFY_URL"],  # default http://127.0.0.1:8788
    api_key=os.environ["ZANII_API_KEY"],
    timeout=5.0,                # seconds, default 10.0
    cache_capacity=128,
    cache_ttl=5.0,
    # max_response_bytes=1_048_576, tracer=None (OpenTelemetry start_as_current_span shape)
)
```

| Method                                                                                               | Route                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `verify(value, *, operation_id, timeout=None)`                                                       | `POST /v1/verify`                                       |
| `verify_batch(items, *, operation_id, timeout=None)` (1 to 100)                                      | `POST /v1/verify/batch`                                 |
| `reserve_operation(value, *, timeout=None)`                                                          | `POST /v1/operations/reserve`                           |
| `dispatch_operation(operation_id, value, *, timeout=None)`                                           | `POST /v1/operations/{id}/dispatch`                     |
| `commit_operation(operation_id, value, *, timeout=None)`                                             | `POST /v1/operations/{id}/commit`                       |
| `mark_operation_unknown(operation_id, value, *, timeout=None)`                                       | `POST /v1/operations/{id}/unknown`                      |
| `keys()` / `resolve_keys(force_refresh=False)`, `status(list_id="mandates")` / `resolve_status(...)` | `GET /v1/keys`, `/v1/status/{list_id}` (public, cached) |
| `cache_stats()`                                                                                      |                                                         |

`operation_id` is keyword-only and required for `verify` and `verify_batch`; it becomes the
`Idempotency-Key`. A bad ID (outside 1 to 200 characters, or with a line break) raises `ValueError`.

## Verify

```python
import os
from zanii_mandate import MandateClient, codes

client = MandateClient(verify_base_url=os.environ["ZANII_VERIFY_URL"], api_key=os.environ["ZANII_API_KEY"])
decision = client.verify(
    {
        "mandateId": os.environ["ZANII_MANDATE_ID"],
        "request": {
            "agentDid": os.environ["ZANII_AGENT_DID"],
            "action": "payments.initiate",
            "resource": "account:ops-001",
            "amount": {"value": "250.00", "currency": "AED"},  # decimal string, never a float
            "jurisdiction": "AE",
            "dataClass": "confidential",
        },
    },
    operation_id="invoice-INV-1042-pay",
)
if decision["verdict"] != "allow":
    reason_codes = [r["code"] for r in decision["reasons"]]
    if codes.APPROVAL_MISSING in reason_codes:
        ...  # route to a human approver, then verify again with request["approvalId"]
    for condition in decision.get("conditions", []):
        if not condition["ok"]:
            print(condition["type"], condition["code"])  # CONDITION_NOT_MET and so on
    raise PermissionError(", ".join(reason_codes))
```

Verdicts are plain dicts; `zanii_mandate.types` adds `TypedDict` hints (`Verdict`, `Reason`,
`ConditionResult`, `VerifyInput`, `VerifyRequest`, `Amount`) for type checkers.
`zanii_mandate.codes` has one constant per code (`codes.ACTION_DENIED == "ACTION_DENIED"`), plus
`REASON_CODES` (frozenset of all 130) and `UNKNOWN_OUTCOME_CODES` (`{"DATABASE_COMMIT_UNKNOWN"}`).

## Errors

All derive from `MandateError`: `MandateApiError` (`status`, `code`, `detail`, `details`),
`MandateTransportError` (`code = "TRANSPORT_ERROR"`), `MandateTimeoutError` (`code = "TIMEOUT"`,
`timeout`), `MandateResponseError` (`code = "INVALID_RESPONSE"`). A missing API key raises
`MandateApiError(401, "API_KEY_REQUIRED", ...)` before any request.

`is_unknown_outcome(error)` is true for `DATABASE_COMMIT_UNKNOWN`, for every `MandateTimeoutError`
(urllib cannot tell a connect timeout from a slow answer), and for transport errors except a refused
connection (`ConnectionRefusedError`) or DNS failure (`socket.gaierror`).

## Operation flow

```python
import hashlib
import os
from zanii_mandate import MandateApiError, MandateError, MandateClient, is_unknown_outcome
from zanii_mandate.middleware import args_digest, canonicalize

client = MandateClient(verify_base_url=os.environ["ZANII_VERIFY_URL"], api_key=os.environ["ZANII_API_KEY"])


def refund(invoice_id: str, value: str):
    operation_id = f"refund-{invoice_id}"           # stable business key, reused on every retry
    args = {"invoice": invoice_id, "amount": value}  # decimal strings, no floats
    try:
        reserved = client.reserve_operation({
            "operationId": operation_id,
            "mandateId": os.environ["ZANII_MANDATE_ID"],
            "agentDid": os.environ["ZANII_AGENT_DID"],
            "action": "payments.refund",
            "resource": f"payment:{invoice_id}",
            "args": args,
            "argsDigest": args_digest(args),
            "amount": {"value": value, "currency": "AED"},
            "count": 1,
            "expiresAt": "2026-11-01T12:00:00.000Z",         # stable across retries
            "audience": "payments-api",
            "enforcementPoint": "refund-worker-v1",
            "policyRevision": os.environ["ZANII_POLICY_REVISION"],  # = server MANDATE_POLICY_REVISION
            "authorityEpoch": os.environ["ZANII_AUTHORITY_EPOCH"],  # = server MANDATE_AUTHORITY_EPOCH
        })
        if reserved.get("verdict") == "review" or reserved.get("state") == "held":
            return {"held": reserved.get("reviewReasons", [])}
        binding = {k: reserved[k] for k in ("argsDigest", "audience", "enforcementPoint",
                                            "policyRevision", "authorityEpoch")}
        dispatched = client.dispatch_operation(operation_id, binding)
    except MandateApiError as error:  # a deny is raised here: 409, details = reasons
        return {"denied": error.code, "reasons": error.details}
    if dispatched.get("idempotencyReplayed"):
        return {"replayed": dispatched}  # it already ran once; do not run it again
    if dispatched.get("verdict") != "allow" or dispatched.get("state") != "dispatched":
        return {"denied": dispatched}

    try:
        payments_refund(invoice_id, value)  # the business action, exactly once
        outcome = "succeeded"
    except Exception:
        outcome = "unknown"

    payload = canonicalize({"operationId": operation_id, "argsDigest": binding["argsDigest"],
                            "enforcementPoint": binding["enforcementPoint"], "outcome": outcome})
    try:
        if outcome == "succeeded":
            client.commit_operation(operation_id, {
                "receiptHash": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
                "actualAmount": {"value": value, "currency": "AED"},
                "actualCount": 1,
                "payload": payload,  # the exact string that was hashed
            })
        else:
            client.mark_operation_unknown(operation_id, {"payload": payload})
    except MandateError as error:
        if is_unknown_outcome(error):
            return {"reconcile": operation_id}  # never call payments_refund again
        raise
```

`canonicalize` and `args_digest` in `zanii_mandate.middleware` produce the same bytes as the Node
RFC 8785 profile for strings, booleans, safe integers and nested objects; non-integer floats raise
(`TOOL_ARGUMENTS_INVALID`), so send decimals as strings. The commit and unknown `payload` must be a
string; an object is rejected with `INVALID_OUTCOME`.

## FastAPI and Django decorators

```python
from zanii_mandate.fastapi_middleware import mandate_operation  # or zanii_mandate.django_middleware

@app.post("/orders/read")
@mandate_operation(client=client, operation={
    "mandateId": MANDATE_ID, "agentDid": AGENT_DID, "action": "records.read",
    "argumentSchema": {"order": {"type": "string", "required": True}},
    "resource": "record:orders",
    "audience": "orders-api", "enforcementPoint": "orders-fastapi-v1",
    "policyRevision": POLICY_REVISION, "authorityEpoch": AUTHORITY_EPOCH,
})
async def read_order(request: Request):
    return {"operation": request.state.mandate_operation}
```

The mapping is server-owned (same fields as the Express middleware: `resource` or `resources` plus
`resourceArgument`, `argumentSchema` types `string`, `decimal`, `boolean`, `integer`, optional
`mandateVersionId`, `amount` or `amountArgument` plus `currency`, `count`). The request body may
contain only `args`, `expiresAt` (required), `approvalId`, `approvalIds`; any other field is
`400 UNSUPPORTED_FIELD`. The operation ID comes from `Idempotency-Key` or `X-Zanii-Operation-Id`.
Deny and review return 403 with reasons, `OPERATION_MISMATCH` stays 409, timeouts return 504; a 2xx
commits, anything else (or an exception) marks the operation unknown. FastAPI runs the synchronous
client in worker threads; the Django decorator supports synchronous views.

## Issuing from Python

There is no issue method; call the Mandate API directly (scope `mandates:issue`):

```python
import json
import os
import urllib.request

body = {
    "agentDid": "did:zanii:agent:support",
    "actions": ["email.read", "email.draft", "email.send"],
    "resources": ["mailbox:support", "recipient:customer:*"],
    "constraints": {"maxCount": {"value": 200, "period": "day"}, "deniedActions": ["email.campaign"]},
    "expiresAt": "2026-11-05T12:00:00.000Z",
}
request = urllib.request.Request(
    "http://localhost:8787/v1/mandates",
    data=json.dumps(body).encode("utf-8"),
    method="POST",
    headers={
        "Authorization": f"Bearer {os.environ['ZANII_API_KEY']}",
        "Content-Type": "application/json",
        "Idempotency-Key": "issue-support-agent-2026-10-30",  # required in production
    },
)
with urllib.request.urlopen(request, timeout=10) as response:
    mandate_id = json.load(response)["mandate"]["id"]
```
