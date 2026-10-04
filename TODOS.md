# Guanaco — Roadmap & TODOs

## 📌 Status Summary
- **Current Version:** `1.0.8` (Build 7)
- **License:** GNU General Public License v3.0 (`GPL-3.0-or-later`)
- **Tracks:** Internal Testing & Closed Testing (`alpha`) deployed

---

## 🚀 Phase 4: Performance, Refactoring & Robustness

### 1. Network & Sync Refinements
- [ ] **Request Timeout with `AbortController` (M6)**:
  - Add standard 15s network timeout to all `fetch` calls in `VikunjaClient` to prevent any hung connection from indefinitely blocking the mutation queue.
- [ ] **Label & Assignee Sync Robustness (M4)**:
  - Prevent sub-request swallows in `setTaskLabels` and `setTaskAssignees` so failures are properly flagged and retried by the sync queue.
- [ ] **Optimized All-Tasks Fetching (M1)**:
  - Streamline `fetchAllTasks` to use paginated `/tasks` instead of blasting individual requests per project on every sync cycle.

### 2. Code Quality & Architecture Cleanup
- [ ] **Extract Custom Hooks (M7)**:
  - Extract task filtering and sorting logic from `ProjectTasksScreen.tsx` into a dedicated `useFilteredSortedTasks` hook.
  - Separate modal state logic out of the main screen component.
- [ ] **Error Logging in `__DEV__`**:
  - Replace silent empty `catch {}` blocks with conditioned `if (__DEV__) console.warn(...)` for easier local debugging.
- [ ] **Single Source Versioning (B2)**:
  - Create a unified `npm run bump [patch|minor|major]` script that simultaneously updates `app.json`, `package.json`, `android/app/build.gradle`, and `version.ts`.

---

## 📱 Phase 4B: Large Screens, Tablets & Landscape Mode

### 1. Orientation & Foldable Readiness (Android 16)
- [ ] **Unlock Orientation**:
  - Switch `"orientation": "default"` in `app.json` to allow clean rotation between Portrait and Landscape.
- [ ] **Tablet / Foldable Dual-Pane Layout**:
  - When screen width is `>= 768px` (iPad / Android tablets / unfolded foldables):
    - Replace the slide-in drawer with a permanent, responsive left sidebar showing Lists & Projects.
    - Right area displays the active project's tasks.
- [ ] **Landscape Modal Adjustments**:
  - Ensure `TaskDetailModal`, `SettingsModal`, and `LabelManagementModal` take a centered card layout with max-width (~600px) instead of stretching full-width on wide displays.

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
