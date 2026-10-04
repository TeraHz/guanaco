# Guanaco — Roadmap & TODOs

## 📌 Status Summary
- **Current Version:** `1.0.9` (Build 8)
- **License:** GNU General Public License v3.0 (`GPL-3.0-or-later`)
- **Tracks:** Internal Testing & Closed Testing (`alpha`) deployed

---

## 🚀 Phase 4: Performance, Refactoring & Robustness

### 1. Network & Sync Refinements
- [x] **Request Timeout with `AbortController` (M6)**:
  - Added standard 15s network timeout to all `fetch` calls in `VikunjaClient` to prevent hung connections from blocking sync.
- [x] **Label & Assignee Sync Robustness (M4)**:
  - Eliminated sub-request error swallows in `setTaskLabels` and `setTaskAssignees`; non-404/409 errors now propagate so `syncQueue` detects failure and retries.
  - Eliminated redundant reassignment requests for already assigned users.
- [x] **Optimized All-Tasks Fetching (M1)**:
  - Streamlined `fetchAllTasks` to use paginated `/tasks` (up to 20 pages) with fallback to `/tasks/all`.

### 2. Code Quality & Architecture Cleanup
- [x] **Extract Custom Hooks (M7)**:
  - Extracted task filtering, sorting, label extraction, and AI grouping logic into dedicated `useFilteredSortedTasks` custom hook with full unit test coverage.
- [x] **Error Logging in `__DEV__`**:
  - Replaced silent empty catch blocks with conditioned `if (__DEV__) console.warn(...)` across API and sync components for easier local debugging.
- [x] **Single Source Versioning (B2)**:
  - Created unified `npm run bump [patch|minor|major]` script (`scripts/bump-version.js`) updating `package.json`, `app.json`, `build.gradle`, and `version.ts`.

---

## 📱 Phase 4B: Large Screens, Tablets & Landscape Mode

### 1. Orientation & Foldable Readiness (Android 16)
- [x] **Unlock Orientation**:
  - Set `"orientation": "default"` in `app.json` and `android:screenOrientation="unspecified"` in `AndroidManifest.xml` (satisfies Android 16 Google Play requirement).
- [x] **Tablet / Foldable Dual-Pane Layout**:
  - Screen width `>= 768px` (iPad, Android tablets, unfolded foldables) renders a permanent, responsive left sidebar (`inline={true}`) showing Lists & Projects with main task list on the right.
- [x] **Landscape & Tablet Modal Adjustments**:
  - `TaskDetailModal`, `SettingsModal`, and `LabelManagementModal` wrapped in centered `modalBackdrop` with `maxWidth: 680` for clean, centered card dialog presentation on wide displays.

---

## 📋 Feature Wishlist (Post-v1.0)

### 1. Kanban Board View (Vikunja Buckets)
- [ ] **Vikunja Buckets API Integration**:
  - Add client endpoints for `GET /projects/{id}/buckets`, `POST /projects/{id}/buckets`, and bucket task assignments (`bucket_id`, `position`).
- [ ] **Offline Optimistic Bucket State**:
  - Cache project buckets in `taskStore` and queue optimistic bucket transitions in `syncQueue`.
- [ ] **Mobile Kanban UX**:
  - **Phone Mode**: Horizontally snap-paging column carousel (Trello style) with column tab indicators.
  - **Tablet Mode**: Multi-column board view with drag-and-drop between columns.
  - Header view switch toggle: `[ ≡ List ]  [ ⊞ Board ]`.

### 2. Vikunja Server Features
- [ ] **Project Color & Icon Customization**:
  - Allow creating and editing project hex colors and icons directly from the mobile app.
- [ ] **Custom Reminders**:
  - Support setting explicit reminder timestamps (separate from due dates) with local Android notifications.
- [ ] **Task Comments**:
  - View and post task comments/activity directly in `TaskDetailModal`.
