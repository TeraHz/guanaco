# Guanaco — Roadmap & TODOs

## 📌 Status Summary
- **Current Version:** `1.2.6` (Build 15)
- **License:** GNU General Public License v3.0 (`GPL-3.0-or-later`)
- **Tracks:** Internal Testing & Closed Testing (`alpha`) deployed

---

## 🛠️ Phase 8.1: DraggableFlatList Flex Container Fix & Task Visibility (v1.2.6)

### 1. Fix DraggableFlatList Collapsing & Task Visibility
- [x] **`containerStyle` & `listContainer` Flex Layout (`ProjectTasksScreen.tsx`)**:
  - Identified root cause of task list collapsing to height 0: `react-native-draggable-flatlist` wraps the inner list inside an outer `Animated.View` which requires `containerStyle={{ flex: 1 }}` to participate in flexbox column layouts with bottom docked siblings.
  - Wrapped `DraggableFlatList` in a dedicated `listContainer` View (`flex: 1`) and explicitly passed `containerStyle={{ flex: 1 }}` so the list takes full vertical height between the header and the bottom dock.
  - Updated Jest mock in `jest.setup.ts` to accurately preserve `props.containerStyle` on the outer View wrapper, preventing layout regression divergence between unit tests and physical devices.
  - Added layout & task visibility unit tests in `ProjectTasksScreen.test.tsx`.

---

## 🎨 Phase 8: Permanent Bottom Dock & Unobstructed Task List (v1.2.5)

### 1. Permanent Bottom Dock & Ergonomic Input
- [x] **Relocated Quick Add Bar to Bottom Dock (`ProjectTasksScreen.tsx`)**:
  - Moved the Quick Add bar and suggestion chips from the top of the screen to a permanent, safe-area-aware bottom dock.
  - Placed task input directly within the user's natural thumb zone.
- [x] **Docked '+' Button Integration (`QuickAddBar.tsx` & `ProjectTasksScreen.tsx`)**:
  - Replaced the floating FAB overlay with a docked circular green `＋` button beside the Quick Add input field.
  - Eliminated task occlusion while scrolling or viewing lists.

### 2. Task List Clearance & Modern Phone Geometry
- [x] **Unobstructed Bottom Items (`ProjectTasksScreen.tsx`)**:
  - Task list now occupies full `flex: 1` height above the bottom dock.
  - Added bottom list padding so the bottom-most task stops cleanly above the dock and well clear of rounded phone bezels and gesture bars.

---

## 🛠️ Phase 7: Manual Task Ordering Stability & Synchronization (v1.2.4)

### 1. Manual Task Order Preservation
- [x] **Preserve Local Task Positions Across Inbound Syncs (`taskStore.ts`)**:
  - Implemented `resolvePosition` in both `fetchTasks()` and `fetchAllTasks()` to prevent incoming server task lists (which lack view-specific positions and default to 0) from wiping out local user-ordered positions.
  - Active positions and pending reorder mutations are now strictly preserved across all background polls, project switches, and pull-to-refresh events.

### 2. Mutation Deduplication & Debounced Sync
- [x] **Eliminate Reorder Race Conditions (`syncQueue.ts` & `taskStore.ts`)**:
  - `syncQueue.enqueue` now deduplicates pending `REORDER_TASK` mutations in-place for identical task IDs, ensuring rapid item moves do not queue redundant or out-of-order mutations.
  - Local state updates and haptics fire immediately (0ms latency), while network sync is debounced by 400ms to batch rapid manual rearrangements into a single clean pass.

### 3. Project View Discovery & Global Reordering
- [x] **Project View Scoping (`client.ts` & `ProjectTasksScreen.tsx`)**:
  - Added `getProjectViews()` to `VikunjaClient` to fetch and cache project view IDs for accurate `POST /tasks/{id}/position` scoping.
  - Updated `reorderTasks()` to support global smart views (`All Tasks` and `My Tasks`).
  - Added stepper controls (`onMoveUp`, `onMoveDown`) and automatic initial position generation when entering Custom Order mode.
  - Enhanced manual sorting utility (`sorting.ts`) to prioritize explicitly positioned tasks over unpositioned ones.

---

## 🎨 Phase 6: Light Mode Contrast, Independent Text Size Scaling & Alphabetical Lists (v1.2.3)

### 1. Light Theme Legibility & Color Audit
- [x] **Light Mode Readability Audit Across Modals & Menus**:
  - Fixed white-on-light-gray text in selected lists in `ProjectDrawer.tsx` (`styles.projectTitleSelected` now preserves theme text color `#000000` in light mode).
  - Themed sorting menu (`ProjectTasksScreen.tsx`), filter pills, sort triggers, empty state text, and modals (`MoveListModal.tsx`, `QuickLabelModal.tsx`) with full dark/light tokens.
  - Due date badge and other metadata chips now adapt cleanly to light backgrounds (`#E5E5EA`) with accessible text contrast.

### 2. Independent Box Size vs. Text Size Scaling
- [x] **Decoupled Task Box & Text Scaling (`taskStore.ts`, `SettingsModal.tsx`, `SwipeableTaskItem.tsx`)**:
  - Added separate `taskItemTextScale` setting alongside `taskItemScale`.
  - Users can now select larger task boxes/cards (e.g., 150%) for bigger tap targets and comfortable spacing while keeping task title and metadata text at standard 100% font size.
  - Both settings are fully configurable in `SettingsModal` via dedicated steppers and quick percentage presets (100%–200%).

### 3. Alphabetical List Ordering
- [x] **Alphabetical Project Sorting (`projectTree.ts`, `MoveListModal.tsx`, `ProjectEditorModal.tsx`)**:
  - Removed arbitrary server `position` integer sorting. Lists in the drawer, Move modal, and parent list selectors now always sort alphabetically by title (with favorites prioritized).

### 4. Smart Multi-Line Handling for Long Task Titles
- [x] **Adaptive Task Item Layout (`SwipeableTaskItem.tsx`)**:
  - When task titles are long (> 26 characters), the card automatically stacks the title on top with up to 3 lines of text wrapping and places metadata badges beneath it, preventing aggressive single-line ellipsis cutoff.
  - Simple tasks without metadata also wrap up to 3 lines across the full card width.
  - Short tasks with metadata remain in the compact, single-row dense layout.

---

## 🎨 Phase 5C: List Editing Discoverability & Header Quick Actions (v1.1.2)

### 1. Intuitive List Editing & Management
- [x] **Project Header Action Button & Title Tap (`ProjectTasksScreen.tsx`)**:
  - Made active list header title clickable with chevron (`▾`) and subtle `"• Tap to edit list"` guidance.
  - Added dedicated `⋯` list options button directly in the main header for instant access to Edit List, Share List, and Favorite toggles.
  - Integrated `ProjectEditorModal` and `ProjectSharingModal` directly into the tasks screen so users never need to open the drawer just to edit or configure the current list.
- [x] **Drawer List Options Visibility & Gestures (`ProjectDrawer.tsx`)**:
  - Fixed row layout (`flex: 1` on item) ensuring `⋯` button is always clearly visible and never pushed off-screen by long list titles.
  - Added long-press gesture with haptic feedback to open list settings on any list in the drawer.
  - Added explicit section header with hint: `MY LISTS (Tap ⋯ or long-press to edit)`.

---

## 🔐 Phase 5B: Hardware Keystore Auth Persistence & Biometric Renewal (v1.1.1)

### 1. Robust Authentication & Token Lifecycle
- [x] **Secure Hardware Keystore Credential Storage (`biometrics.ts`)**:
  - Saved credentials (`username` and `password`) encrypted in device hardware keystore via Expo `SecureStore` (Android Keystore / iOS Keychain).
  - Explicit logout cleans all credentials and tokens; session expiration no longer wipes credentials.
- [x] **Transparent Token Refresh & Retry on 401 (`client.ts` & `taskStore.ts`)**:
  - When Vikunja's server JWT expires (short-lived JWT), `VikunjaClient` triggers `onTokenRefresh` to seamlessly re-authenticate with stored credentials in the background.
  - Automatically updates the active token and transparently retries the failed request without disturbing the user or aborting background sync.
- [x] **Passwordless Biometric Unlock (`LoginScreen.tsx` & `App.tsx`)**:
  - Auto-prompts for biometric unlock on app open and automatically re-authenticates if token expired while the app was closed.
  - Added dedicated `[ 🔒 Unlock with Biometrics ]` button on `LoginScreen` for instant one-touch login with zero manual typing.

---

## 🎯 Phase 5: List Management, Project Sharing & Task Scheduling (v1.1.0)

### 1. List (Project) Creation & Configuration
- [x] **Project Creation & Editing**:
  - Full project creation (`+ New List` in drawer) and editing modal (`ProjectEditorModal`).
  - Color swatches with custom color picker support.
  - Parent project selector with recursive cycle prevention (`wouldCreateProjectCycle`).
  - Online guard with polite feedback when attempting to create/modify lists offline.
- [x] **Project Management Actions**:
  - Duplicate project endpoint (`/projects/{id}/duplicate`).
  - Archive/Unarchive project toggling.
  - Delete project with confirmation safety.
  - Favorite/unfavorite toggling with immediate UI response.
- [x] **Project Sharing & Team Collaboration**:
  - Direct user sharing (`/projects/{id}/users`) and team sharing (`/projects/{id}/teams`).
  - Permission level management: Read (0), Read & Write (1), Admin (2).
  - Search/add and revoke user/team project access modal (`ProjectSharingModal`).

### 2. Task Scheduling & Zero-Telemetry Reminders
- [x] **Comprehensive Task Scheduling (`TaskScheduleSection`)**:
  - Due date & time picker with quick presets (Today, Tomorrow, Weekend, Next Week).
  - Start date & end date range pickers.
  - Repeat mode support: From Due Date (0), Monthly (1), From Completion (2) with interval settings.
  - Relative reminder rules (e.g., At due date, 15m before, 1h before, 1d before, custom relative).
- [x] **Local On-Device Reminders (`localNotifications.ts`)**:
  - Zero-telemetry notification scheduling with `expo-notifications`.
  - Android notification channel setup with exact alarm permissions (`SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`).
  - Completely stripped Firebase/FCM to guarantee 100% offline, privacy-first on-device alarm execution without external token transmission.
- [x] **Task Badges**:
  - 🔁 (Repeat) and 🔔 (Reminder) indicator badges directly on task items.

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

## 📋 Feature Wishlist (Post-v1.1)

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
- [ ] **Task Comments**:
  - View and post task comments/activity directly in `TaskDetailModal`.
