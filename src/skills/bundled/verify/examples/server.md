# Server example

```
$ bun run dev &                       → "Listening on :3000" after 2.1s
$ curl -s :3000/health                → {"ok":true}                        PASS
$ curl -s :3000/api/items | jq length → 3 (fixture has 3)                  PASS
$ curl -s -X POST :3000/api/items -d '{}' → 400 {"error":"name required"} PASS
$ curl -s :3000/api/items/999         → 404                                PASS
$ kill %1
```
Check response *shapes and values*, not just 200s; include one bad-input and one not-found case.
