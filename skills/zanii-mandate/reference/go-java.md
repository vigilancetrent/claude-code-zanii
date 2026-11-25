# Zanii Mandate: Go and Java SDKs (repository only)

Both SDKs are version **0.2.0** and live in the repository. **Neither is published**: the Go module
has no tag and resolves only from the private repository, and the Java artifact is built locally,
not on Maven Central. Do not tell users to `go get` a public path or add a Maven Central
dependency. Both follow the same shared 130 reason codes as the Node and Python SDKs.

## Go (`packages/sdk-go`, package `mandate`)

Module `github.com/vigilancetrent/zanii-mandate/packages/sdk-go`, Go 1.23+, uses
OpenTelemetry's `trace.Tracer`. From a checkout: set `GOPRIVATE=github.com/vigilancetrent/*` or use
a `replace` directive pointing at `packages/sdk-go`.

```go
client, err := mandate.NewClient(mandate.Config{
    VerifyBaseURL: os.Getenv("ZANII_VERIFY_URL"),
    APIKey:        os.Getenv("ZANII_API_KEY"),
    Timeout:       5 * time.Second,
    CacheCapacity: 128,
    CacheTTL:      5 * time.Second,
    // MaxResponseByte, HTTPClient, Tracer
})
if err != nil { log.Fatal(err) }

decision, err := client.Verify(ctx, map[string]any{
    "mandateId": mandateID,
    "request": map[string]any{
        "agentDid": agentDID, "action": "records.read", "resource": "record:42",
    },
}, mandate.OperationOptions{OperationID: "case-42-read-1"})
if err != nil { return err }
if decision.Verdict != "allow" {
    if decision.HasReason(mandate.ReasonApprovalMissing) { /* route to an approver */ }
    return fmt.Errorf("not allowed: %v", decision.Reasons)
}
```

API (methods on `*Client`, all take `ctx`):

- `Verify(ctx, input, OperationOptions)`, `VerifyBatch(ctx, items, OperationOptions)` (1 to 100).
- `ReserveOperation(ctx, input, opts)`, `DispatchOperation(ctx, id, input, opts)`,
  `CommitOperation(ctx, id, input, opts)`, `MarkOperationUnknown(ctx, id, input, opts)`; no
  `GetOperation` or cancel. `ArgsDigest(args)` returns the hex SHA-256 of the canonical arguments.
- `ResolveKeys(ctx, forceRefresh)`, `Keys(ctx)`, `ResolveStatus(ctx, listID, forceRefresh)`,
  `Status(ctx, listID)`, `CacheStats()`.
- `OperationOptions{OperationID, Timeout}`.
- `Verdict`: `Verdict`, `Reasons`, `MandateID`, `AgentDID`, `EvaluatedAt`, `IdempotencyReplayed`,
  `Conditions []ConditionResult` (`Index`, `Type`, `OK`, `Code`, `Reason`, `Evidence`
  `json.RawMessage`), `Raw json.RawMessage` (the server object byte for byte, excluded from
  `json.Marshal`), `HasReason(code)`.
- Errors (use `errors.As`): `*APIError` (`Status`, `Code`, `Detail`, `Details`), `*TransportError`,
  `*TimeoutError`, `*ResponseError`.
- Codes in `codes.go`: `Reason*` for verdict reasons (`ReasonActionDenied`, `ReasonApprovalMissing`,
  `ReasonCountLimitExceeded`, `ReasonStatusStale`, ...) and `Code*` for API errors
  (`CodeOperationMismatch`, `CodeMandateValidityExceeded`, `CodeDatabaseCommitUnknown`, ...).
- `mandate.IsUnknownOutcome(err)`: true for `DATABASE_COMMIT_UNKNOWN` and for timeouts or transport
  failures after the request may have been sent; false for a dial failure (including a connect
  timeout).

```go
if _, err := client.CommitOperation(ctx, opID, commitBody, mandate.OperationOptions{}); err != nil {
    if mandate.IsUnknownOutcome(err) {
        _, _ = client.MarkOperationUnknown(ctx, opID, unknownBody, mandate.OperationOptions{})
        return err // reconcile later; never repeat the business action
    }
    return err
}
```

Gin middleware (`packages/middleware-gin`, also unpublished): `Mandate(Config{Client, Operation})`
returns a `gin.HandlerFunc` with the same reserve, dispatch, commit or unknown contract as the
Express middleware.

## Java (`packages/sdk-java`, package `agency.zanii.mandate`)

`agency.zanii:mandate-sdk:0.2.0`, Java 17+, Maven, `java.net.http.HttpClient`, OpenTelemetry
`Tracer`, no JSON runtime dependency. Build with `mvn -f packages/sdk-java/pom.xml install` and
depend on the locally installed artifact.

```java
MandateClient client = new MandateClient(new ClientConfig()
    .verifyBaseUrl(System.getenv("ZANII_VERIFY_URL"))
    .apiKey(System.getenv("ZANII_API_KEY"))
    .timeout(Duration.ofSeconds(5))
    .cacheCapacity(128)
    .cacheTtl(Duration.ofSeconds(5)));

try {
  Verdict decision = client.verify(input, "case-42-read-1");
  if (!"allow".equals(decision.verdict())) {
    if (decision.hasReason(ReasonCodes.APPROVAL_MISSING)) { /* route to an approver */ }
    throw new IllegalStateException("not allowed");
  }
} catch (MandateError error) {
  if (MandateError.isUnknownOutcome(error)) {
    // record the operation as unknown and reconcile; never repeat the business action
  }
  throw error;
}
```

API: `verify(input, operationId)`, `verify(input, operationId, Duration)`,
`verifyBatch(items, operationId)` (1 to 100), `keys()`, `resolveKeys(forceRefresh)`,
`status(listId)`, `resolveStatus(listId, forceRefresh)`, `cacheStats()`. The Java SDK has **no
operation lifecycle methods**; the Apigee callout (`packages/gateway-apigee`) carries its own
operation protocol. `Verdict` is a record with `verdict()`, `reasons()`, `raw()`, `conditions()`
(`ConditionResult(index, type, ok, code, reason, evidence)`), `hasReason(code)`,
`idempotencyReplayed()`. Errors: `MandateApiError` (`status()`, `code()`, `detail()`, `details()`),
`MandateTransportError`, `MandateTimeoutError`, `MandateResponseError`, all `MandateError`.
`ReasonCodes` holds every code as a `String` constant. `MandateError.isUnknownOutcome(error)` is
false for `ConnectException` and `HttpConnectTimeoutException`.
