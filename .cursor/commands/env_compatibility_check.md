# Environment Compatibility Check

## Overview

Assess whether the current branch's changes could break users in common deployment environments. Analyze only what changed and decide if manual compatibility testing is required in vNext and Community Cloud.

## Steps:

1. Collect the exact changes on this branch.
   - Prefer NDJSON hunk output from the provided script and analyze only those line ranges. If unavailable, fall back to the absolute list of changed file paths and limit review to modified regions.
   - If no changes are detected, respond "No files changed" and stop.
2. Evaluate the changes against the Decision Checks below, considering only the changed lines/regions.
3. Decide the outcome:
   - If any Decision Check is triggered, the answer is Yes.
   - Otherwise, the answer is No.
4. Respond:
   - First, state Yes or No.
   - Then provide brief reasoning for each Decision Check (why it did or did not trigger).
   - If Yes, instruct the user to manually test in vNext and Community Cloud. If No, no further action is required.

---

## Decision Checks:

1. Does the change introduce or modify Tornado routes, `server.baseUrlPath`, catch-alls, request methods, URL resolution, redirects, or status codes?
2. Does it touch auth (OAuth/login/logout), cookies (`streamlit_user`, `streamlit_xsrf`), CSRF/XSRF handling, `server.trustedUserHeaders`, or session-to-identity binding?
3. Does it affect the WebSocket handshake/subprotocols, session affinity/identity, reconnect behavior, ping/timeout, message size, or fragmentation?
4. Does it alter embedding or the iframe boundary (host<->guest postMessage, sizing/resize behavior, sandbox/allow attributes, or permissions policy)?
5. Does it change static asset handling or component asset serving (handlers, cache headers, size limits, base paths like `server.customComponentBaseUrlPath`, or proxying rules)?
6. Does it modify the service worker, uploads, or downloads (registration/scope/cache strategy, upload/download endpoints, JWT/CSRF wrapping, or download attribute behavior)?
7. Does it modify CORS allowlists, crossOrigin usage, external-origin fetches/External Networks, or backend URL discovery via `window.streamlit.*`?
8. Does it introduce cross-origin theming assets or resource discovery changes (fonts/images/theme globals, CSS isolation with host, manifest/asset discovery when HTML isn't served by Tornado)?
9. Does it rely on SiS/Snowflake runtime behavior (`running_in_sis()`, `get_active_session()`), Snowflake connection/session semantics, or SiS-specific environment variables/flags?
10. Does it introduce or change client storage usage (cookies/localStorage/sessionStorage) that may differ in embedded/third-party contexts?
11. Does it change security headers or policies (CSP, Referrer-Policy, Permissions-Policy) that impact embedding or resource loading?

Treat these checks as examples; if in doubt about a feature, please test! Exemplary features in the past that would fall into this category were: custom theming in general (loading assets via a path), audio input (permissions on the iframe; file uploading), and st.pdf (resource embedding).

---

How to run against the whole PR changeset (committed + uncommitted)

- Always scope analysis to the exact set of files changed on this branch compared to its base, plus any staged, unstaged, and untracked files in the working tree. Use absolute paths.
- In CI, prefer `origin/${GITHUB_BASE_REF}` as base; locally, default to `origin/develop`.

Preferred: change-aware ranges

To avoid false positives, restrict analysis to only the added/modified line ranges of changed files. From the repository root:

```bash
bash ./scripts/collect_changed_ranges.sh
```

This emits one NDJSON object per file with the absolute path and the list of added line ranges. Agents should only analyze those ranges in each file.

Fallback: absolute changed paths (one per line)

```bash
bash ./scripts/collect_changed_ranges.sh --paths-only
```
