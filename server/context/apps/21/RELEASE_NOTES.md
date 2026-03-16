# App 21 Release Notes


## 2026-03-15T09:32:24.130Z publish failed
- phase: db_check
- type: PUBLISH_UNKNOWN
- retryable: no
- detail: /app/server/apps/21/.publish-server-check.js:342
    return jsonError(res, 400, parsed.code, parsed
                                            ^^^^^^

SyntaxError: missing ) after argument list
    at wrapSafe (node:internal/modules/cjs/loader:1464:18)
    at checkSyntax (node:internal/main/check_syntax:78:3)

Node.js v20.20.1
