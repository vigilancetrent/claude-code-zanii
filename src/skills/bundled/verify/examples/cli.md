# CLI example

```
$ node dist/cli.js --version          → 2.13.0            PASS
$ echo "ping" | node dist/cli.js -p   → "pong"            PASS
$ node dist/cli.js --bogus            → exit 1, usage text PASS
$ node dist/cli.js -p < /dev/null     → warns, proceeds   PASS
```
Golden path, an error path, and an edge input — each with the real command and the real output.
