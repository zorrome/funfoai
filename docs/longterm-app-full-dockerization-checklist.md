# Long-term App Full Dockerization Audit & Implementation Checklist

时间：2026-03-15 05:00 JST

## Current state (what is actually running today)

### Runtime split
- **Platform container**: `funfo-ai-store`
  - Runs main Express API on `3100`
  - Runs Vite dev server on `5175`
  - Also owns `preview-manager` preview servers
- **Per-app backend container**: `funfo-app-<appId>`
  - Spawned by `server/app-backend-manager.js`
  - Runs generated `server.js` on internal port `3001`
  - Uses bind-mounted `server/apps/<appId>/` as working dir
- **Frontend for long-term apps is not fully containerized yet**
  - `/app/<slug>/api/*` is proxied to the per-app backend container
  - `/app/<slug>/` HTML/assets still come from `preview-manager` in the main process

### Current publish / deploy / restore / runtime path
1. **Publish request** → `POST /api/apps/:id/publish` in `server/index.js`
2. **Pipeline orchestration** → `createPublishPipeline(...).processPublishJob` in `server/publish/pipeline.js`
3. **Persist release artifacts** → `writeVersionFiles(...)` in `server/index.js`
   - writes `server/apps/<appId>/App.jsx`, `server.js`, `schema.sql`, `versions/`, `runtime/`, `docs/`
4. **Deploy backend runtime** → `deployAppBackend(...)` in `server/app-backend-manager.js`
   - scaffolds app folder
   - regenerates `server.js`
   - `docker run` launches `funfo-app-<id>`
5. **Apply prod schema** → `applySchemaToDbFile(...)` from publish pipeline onto `server/apps/<appId>/data_prod.sqlite`
6. **Health verify** → `waitRuntimeReady(...)` + `/health` in `server/publish/pipeline.js`
7. **Frontend preview wake** → `startPreview(...)` in `server/preview-manager.js`
8. **Slug routing at runtime** → `handleAppSlug` in `server/index.js`
   - `/app/<slug>/api/*` → app container
   - everything else → preview server
9. **Restore on boot** → `app.listen(...)` tail in `server/index.js`
   - `restoreFromDb(db, SERVER_HOST)` restores previews
   - `restoreBackendsFromDb(db)` restores backend containers
10. **Idle sleep** → `startIdleRuntimeSweeper()` in `server/index.js`
   - stops preview + backend separately via `stopPreview()` and `stopAppBackend()`

---

## Root architectural problem

Long-term apps are currently **half-Dockerized**:
- backend/runtime DB live in per-app Docker containers
- frontend runtime for the same app still depends on `preview-manager` in the platform process

That means publish success today really means:
- backend container is healthy
- preview-manager can serve frontend

…not:
- a single long-term app runtime can boot, restore, sleep, and serve both frontend and backend entirely from its own container

---

## Files and exact functions to change

### 1) `server/app-backend-manager.js`
**Why:** this is the real per-app runtime entrypoint, but it only serves backend routes today.

**Change these functions:**
- `buildServerJs(appId, routeCode)`
  - expand from API-only server to **full app runtime server**
  - serve generated frontend entry/static assets
  - keep `/health`
  - keep `/api/*`
  - add catch-all HTML route for app frontend
- `scaffoldAppFolder(appId, routeCode, schemaSql)`
  - also write container-owned frontend runtime artifacts, not just `server.js` + `schema.sql`
  - likely create `public/` or `runtime/web/`
- `dockerRunAppContainer(appId, slug, appDir, options)`
  - likely keep container run model, but confirm env and mount paths for serving frontend assets
- `deployAppBackend(...)`
  - rename mentally to “deploy app runtime”; eventually code rename can follow later
- `restoreBackendsFromDb(db)`
  - restore only long-term full runtimes, not just backend-only expectation

**Likely new helper file to add:**
- `server/app-runtime-builder.js`
  - build container-owned frontend HTML/runtime assets from app frontend source
  - move frontend packaging logic here rather than bloating `app-backend-manager.js`

### 2) `server/preview-manager.js`
**Why:** long-term apps should stop depending on host-process preview runtime.

**Change these functions:**
- `restoreFromDb(db, serverHost)`
  - skip apps whose `runtime_mode === 'server'` / release apps after full Dockerization
- `startPreview(...)`
  - keep only for workspace/draft development previews
- `stopPreview(appId)`
  - keep only for workspace previews
- `buildHtml(...)`
  - either extract reusable frontend HTML generation into shared helper, or stop using it for long-term runtime directly

### 3) `server/index.js`
**Why:** this is where the mixed routing is enforced today.

**Change these functions / areas:**
- `handleAppSlug` (the biggest routing change)
  - for long-term apps, proxy **all** `/app/<slug>/*` traffic to the app container
  - do not fall back to preview-manager for HTML/assets
  - workspace/draft apps can keep preview behavior
- `wakeAppRuntime(appId)`
  - ensure it wakes a full containerized app, not just backend expectation
- `proxyToAppContainer(req, res, runtime, pathPart)`
  - may need path rewrite support for frontend asset paths and SPA routing
- boot block inside `app.listen(...)`
  - stop restoring previews for long-term apps
  - restore only preview-mode apps through `restoreFromDb(...)`
  - restore long-term apps only through `restoreBackendsFromDb(...)`
- idle sweeper block in `startIdleRuntimeSweeper()`
  - long-term apps: sleep full runtime container only
  - workspace apps: stop preview only
- admin/runtime endpoints
  - `/api/admin/runtimes`
  - `/api/admin/runtimes/:id/wake`
  - `/api/admin/runtimes/:id/sleep`
  - update wording/state to represent full runtime, not split frontend/backend mental model

### 4) `server/publish/pipeline.js`
**Why:** publish still validates backend container + preview-manager, not full app container.

**Change these functions / phases:**
- `processPublishJob(...)`
  - at `docker_start`, deploy full runtime container
  - after deploy, verify container serves frontend and backend from same runtime
- `runRedeploy(...)`
  - redeploy should mean full app runtime redeploy
- `rollbackToVersion(...)` flow helpers
  - rollback should restore full runtime artifacts, not backend-only expectation
- health/verification step logic around:
  - `waitRuntimeReady(...)`
  - `fetchRuntimeHealth(...)`
  - `startPreview(...)`
  - preview reachability check

**Target publish success criteria:**
- container `/health` ok
- container DB mode is `prod`
- `/app/<slug>/` reachable through gateway
- `/app/<slug>/api/...` reachable through same container path
- verifier passes against that runtime

### 5) `server/verifier.js`
**Why:** verifier still assumes backend contract verification against container, with frontend mostly checked via persisted artifact and optional preview reachability.

**Change these functions:**
- `verifyAppRelease(appId, latestRaw, options)`
  - add explicit gateway/container frontend smoke check for `/app/<slug>/`
- `probeGetRoute(...)` / `requestRuntime(...)`
  - optionally add gateway-level checks, not only direct container-IP checks
- auth smoke remains useful, but should run against the finalized long-term runtime path assumptions

### 6) `server/db.js`
**Why:** schema still reflects split-era concepts.

**Review/update these columns carefully:**
- `runtime_mode`
- `preview_slug`
- `last_access_at`
- `api_port` legacy usage expectations

**Plan:**
- keep `preview_slug` as public route key
- keep `runtime_mode`
- stop relying on `api_port` semantics for server runtime
- optional future metadata: `runtime_container_name`, `runtime_health`, `runtime_kind`

### 7) Frontend/admin typing + UI status
**Files:**
- `src/services/api.ts`
- `src/pages/Admin.tsx`
- `src/pages/VibeCoding.tsx`
- `src/pages/VibeCoding/MyAppsPanel.tsx`

**Why:** UI still reflects the mixed architecture.

**Update:**
- runtime status language to “full runtime container”
- remove stale host-port assumptions
- show one long-term runtime state instead of implicit split state

### 8) Infra definitions
**Files:**
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`

**Why:** current image is optimized for platform dev + backend runner reuse, not clean long-term full-runtime packaging.

**Planned adjustments:**
- keep platform image for now, but explicitly support app runtime serving frontend assets
- confirm runner image dependency contract for app containers
- later consider separate lighter `app-runner` image, but not required for first implementation

---

## Concrete implementation checklist

### Phase 0 — freeze the target boundary
- [ ] Decide and document the invariant: **workspace apps use preview-manager; long-term apps use full app containers**
- [ ] Stop adding new logic that makes long-term frontend depend on preview-manager

### Phase 1 — make per-app container able to serve frontend + backend
- [ ] Add shared runtime builder, likely `server/app-runtime-builder.js`
- [ ] Generate container-owned frontend entry/static files during publish/deploy
- [ ] Extend `buildServerJs(...)` in `server/app-backend-manager.js` to serve:
  - [ ] `/health`
  - [ ] `/api/*`
  - [ ] frontend assets
  - [ ] SPA fallback HTML
- [ ] Ensure frontend runtime uses relative API base (`/api` or path-safe equivalent)

### Phase 2 — route long-term apps entirely to the container
- [ ] Update `handleAppSlug` in `server/index.js`
- [ ] For long-term apps, proxy all `/app/<slug>/*` traffic to app container
- [ ] Keep preview-manager only for workspace/draft apps
- [ ] Preserve special asset handling only if still required after container serves its own assets

### Phase 3 — fix publish success criteria
- [ ] Replace preview-based success assumption in `server/publish/pipeline.js`
- [ ] After deploy, verify gateway reachability for `/app/<slug>/`
- [ ] Verify API route through same long-term runtime
- [ ] Keep DB-mode and backend health checks
- [ ] Make rollback redeploy target the full runtime package

### Phase 4 — fix boot/restore/sleep behavior
- [ ] `restoreFromDb(...)` should no longer restore long-term previews
- [ ] `restoreBackendsFromDb(...)` becomes full-runtime restore for long-term apps
- [ ] idle sweeper should stop one runtime per long-term app, not preview + backend separately
- [ ] admin wake/sleep should operate on the single runtime model

### Phase 5 — clean state model and UI
- [ ] remove remaining `api_port` mental model from long-term runtime flows
- [ ] update API typings in `src/services/api.ts`
- [ ] update admin/runtime UI text and state grouping
- [ ] update user-facing runtime status copy in app panels if needed

### Phase 6 — harden before rollout
- [ ] add a publish smoke test for container-served frontend HTML
- [ ] add restore smoke test after process restart
- [ ] add sleep/wake smoke test for long-term apps
- [ ] test rollback on an app with existing `data_prod.sqlite`
- [ ] verify old apps with root-level legacy sqlite files still restore safely

---

## High-risk spots to watch

- **`server/preview-manager.js:buildHtml(...)` coupling**: current frontend HTML generation may depend on main-service asset assumptions.
- **SQLite path compatibility**: current app containers still use root-level `data_prod.sqlite`; do not silently break old apps while moving toward `runtime/`.
- **SPA route rewriting**: once the container serves frontend, `handleAppSlug` path rewriting must not break nested client-side routes.
- **Verifier drift**: direct container-IP checks can pass while gateway `/app/<slug>/` still fails. Both need checking.
- **Mixed restore**: startup currently restores previews and backends independently; partial migration here will create confusing ghost states.

---

## Recommended implementation order

1. `server/app-runtime-builder.js` (new)
2. `server/app-backend-manager.js` full runtime serving
3. `server/index.js` unified long-term slug proxying
4. `server/publish/pipeline.js` publish success criteria rewrite
5. `server/preview-manager.js` long-term exclusion
6. `server/verifier.js` gateway-aware runtime checks
7. `server/db.js` + frontend typings/UI cleanup

---

## Bottom line

The repo already has **Dockerized long-term backends**, but not **Dockerized long-term apps**.

The implementation goal should be simple and strict:
- **draft/workspace app** → host preview runtime
- **long-term app** → one container, one runtime, one restore/wake/sleep path, one public route
