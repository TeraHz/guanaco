# Guanaco — Roadmap & TODOs

## 📌 Status Summary
- **Current Version:** `1.3.2` (Build 21)
- **License:** GNU General Public License v3.0 (`GPL-3.0-or-later`)
- **Tracks:** Internal Testing & Closed Testing (`alpha`) deployed

---

## 🚀 Phase 11: Self-Hosted PKI, Subtasks, Saved Filters, Global Search & Rich Scheduling

### 1. Self-Hosted Infrastructure & Session Identification
- [x] **Android User-Installed Root CA Trust & Client `User-Agent` (`network_security_config.xml`, `AndroidManifest.xml`, `MainApplication.kt`, `withIosRefreshCookieMerge.js`, `client.ts`)**:
  - Added Android `<trust-anchors>` support for user-installed private CAs alongside system CAs so self-hosted Vikunja servers using internal PKI connect seamlessly over TLS.
  - Added `Guanaco/<version> (<OS>)` `User-Agent` identification across Android OkHttp, iOS `NSURLRequest`, and native API requests while omitting custom `User-Agent` on Web to preserve strict CORS compatibility.

### 2. Vikunja Subtasks, HTML Descriptions, Duplication & Saved Filters
- [x] **Offline-First Subtasks & Task Duplication (`client.ts`, `syncQueue.ts`, `taskStore.ts`, `TaskDetailModal.tsx`, `SwipeableTaskItem.tsx`, `ProjectTasksScreen.tsx`)**:
  - Added `/tasks/{id}/relations` (`subtask`) support with dual temporary-ID (`taskId` + `otherTaskId`) offline queue remapping, orphan relation cancellation on unsynced task deletion, card progress badges (`☑ done/total`) and parent indicators, and task duplication (including subtasks) with a quick-open toast banner.
- [x] **Bidirectional HTML Note Normalization (`htmlDescription.ts`, `TaskDetailModal.tsx`)**:
  - Decodes Vikunja TipTap HTML paragraphs, lists, links, entities, and checklists into readable mobile text while preserving untouched server HTML verbatim when saving unrelated field edits.
- [x] **Server Saved Filters & Cross-List Search (`client.ts`, `taskStore.ts`, `useFilteredSortedTasks.ts`, `ProjectDrawer.tsx`, `ProjectTasksScreen.tsx`)**:
  - Added Vikunja Saved Filter discovery (`is_saved_filter` with sentinel collision isolation against `My Open Tasks`) and view-backed task loading, plus collapsible instant search across titles, HTML-decoded notes, labels, and assignees with `All Lists`, due-window, and priority filters.

### 3. Custom Recurrence, OLED Theme, Week Start & Interactive Reminders
- [x] **Custom Repeat Stepper, Postpone Chips, Appearance Modes & Reminder Actions (`TaskScheduleSection.tsx`, `SettingsModal.tsx`, `theme.ts`, `dates.ts`, `localNotifications.ts`, `App.tsx`)**:
  - Added custom `Every N hours/days/weeks/months/years` recurrence UI, `+1d / +3d / +1w` postpone shortcuts, configurable `Monday / Sunday` week start, and `System / Light / Dark / Pure Black (OLED)` theme selection.
  - Added `Mark Complete` (with occurrence-bound recurring-task idempotency and tray dismissal) and `Snooze 15m` local notification actions, tap-to-open task routing behind the biometric gate, and optional `Overdue` / `Due Today` app icon badges.

---

## 🔐 Phase 10.2: Vikunja 2.0 Rotating Refresh Tokens & Proactive Session Renewal (v1.3.2)

### 1. Rotating Refresh-Token Protocol & Proactive JWT Renewal
- [x] **Singleflight Refresh Rotation & Pre-2.0 Fallback (`client.ts`, `biometrics.ts`, `taskStore.ts`, `App.tsx`)**:
  - Added multi-cookie `Set-Cookie` parsing (`extractRefreshTokenFromHeaders`), hardware-backed `SecureStore` persistence (`vikunja_refresh_token`), and singleflight `POST /api/v1/user/token/refresh` rotation (`_omitAuthHeader: true`, `credentials: 'include'`) persisted before resolving concurrent callers, with fallback to `POST /api/v1/user/token` on pre-2.0 Vikunja servers (`404`/`405`).
  - Implemented Hermes-safe pure-JS Base64URL JWT `exp` decoding (`getJwtExpirationMs`) for proactive pre-expiry renewal (`<= 90s` remaining or expired after sleep/cold restart), keeping `authRequired: false` and `SyncQueue` intact across transient offline errors.

### 2. Native Cookie Isolation & Clean Session Logout
- [x] **Android/iOS Native Cookie Merge & Logout Purge (`MainApplication.kt`, `plugins/withIosRefreshCookieMerge.js`, `biometrics.ts`, `App.tsx`)**:
  - Added Android OkHttp `RefreshCookieCaptureInterceptor` + host-bound `RefreshCookieMergeInterceptor` and an Expo iOS `RCTSetCustomHTTPRequestInterceptor` config plugin so `SecureStore`-backed `vikunja_refresh_token` stays authoritative without clobbering reverse-proxy cookies (`CF_Authorization`, Authelia) or comma-folding `Cookie` headers on iOS.
  - Ordered best-effort `POST /api/v1/user/logout` ahead of native `RCTNetworking.clearCookies` and `SecureStore` teardown on logout and account/`tk_` Personal API Token switches.

---

## 🎨 Phase 10.1: UI De-Bloating, Night-Mode Legibility & Semantic Color System (v1.3.1)

### 1. UI De-Bloating & Information Density
- [x] **Concise Copy & Single-Source Surfaces (`AppUpdatePromptModal.tsx`, `App.tsx`, `SettingsModal.tsx`, `ProjectTasksScreen.tsx`, `ProjectDrawer.tsx`)**:
  - Removed redundant status pills and repeated copy in `AppUpdatePromptModal`, simplified the Biometric Lock screen (`App.tsx`), consolidated version/build metadata to a single footer line in `SettingsModal`, and stripped patronizing hints, AI-marketing prose (`Smart Grouping`), and decorative emoji clutter.

### 2. Dim-Screen Night Legibility & Strict Semantic Color System
- [x] **OLED Low-Brightness Contrast & Token Discipline (`theme.ts`, `colors.ts`, `SwipeableTaskItem.tsx`, `TaskDetailModal.tsx`, `QuickAddBar.tsx`, `LoginScreen.tsx`)**:
  - Lifted Dark Mode `textSecondary` and `checkboxBorder` (`#A1A1AA` with subtle inner checkbox contrast), `placeholder`/`textTertiary` (`#8E8E93`), `borderStrong` (`#3F3F46`), and `adaptColorForDarkTheme` label luminance (`>= 0.26`) while removing stacked row opacity on completed tasks and resolving the `QuickAddBar` bottom dock box-in-a-box cutout.
  - Enforced strict semantic roles across all screens and modals: `accent` blue (`#0A84FF`/`#007AFF`) for primary CTAs, neutral `surfaceSecondary`/`borderStrong` for secondary utility actions, `success` green (`#30D158`/`#248A3D`) strictly for completion/positive states, and `danger` red (`#FF453A`/`#D70015`) strictly for destructive/error/overdue states.

### 3. Unified List Options Menu
- [x] **5-Action List Options Symmetry (`ProjectTasksScreen.tsx`, `ProjectDrawer.tsx`)**:
  - Unified the active list header (`⋯` and title tap) and drawer list menus (`⋯` and long-press) on the exact same 5-item List Options sheet: `Edit List`, `Share List`, `Add to Favorites` / `Remove Favorite`, `Archive List` / `Unarchive List`, and `Delete List` (with confirmation).

---

## 🛡️ Phase 10: Public Release Security, Offline Sync & UX Hardening (v1.3.0)

### 1. Security, Authentication & Privacy Hardening
- [x] **Zero-Password Auth, TOTP 2FA & Personal API Tokens (`biometrics.ts`, `LoginScreen.tsx`, `client.ts`, `App.tsx`)**:
  - Eliminated plaintext password persistence in storage; added Personal API Token (`tk_...`) and TOTP 2FA login support alongside hardware-backed `expo-secure-store` JWT sessions.
  - Enforced strict server URL validation, explicit user confirmation before cleartext `http://` connections, and manual redirect verification preventing cross-origin or HTTP-downgrade `Authorization` header leakage.
  - Added resume-aware, offline-capable Biometric App Lock (cold start + 15s background grace period) and epoch-isolated `AbortController` session teardown on logout.
- [x] **Reproducible Native Build, Manifest & Store Privacy (`android/`, `.github/workflows/ci.yml`, `PRIVACY_POLICY.md`)**:
  - Tracked native Android project in Git with externalized release signing credentials, `android:allowBackup="false"`, stripped unused permissions (`SCHEDULE_EXACT_ALARM`) and transitive components, disabled dev network inspector, and added multi-timezone GitHub Actions CI.

### 2. Zero-Data-Loss Offline Sync, Pagination & Local Notifications
- [x] **Crash-Safe `SyncQueue` & Multi-Page API Pagination (`syncQueue.ts`, `taskStore.ts`, `client.ts`, `localNotifications.ts`)**:
  - Persisted `tempId -> serverId` task/label/assignee resolution across app restarts, guarded in-flight queue items against concurrent overwrites, and paused sync (`auth_required` / `offline`) instead of dropping queued user work on `401`/transient errors.
  - Added automatic multi-page pagination across tasks, projects, labels, teams, and project users, and wired local reminder scheduling/cancellation across task lifecycle actions.

### 3. Scheduling, Quick-Add, Gestures & Accessibility Polish
- [x] **Full Vikunja Field Parity & Mobile UX (`TaskDetailModal.tsx`, `TaskScheduleSection.tsx`, `SwipeableTaskItem.tsx`, `ProjectDrawer.tsx`, `quickAddParser.ts`)**:
  - Aligned `percent_done` (`[0..1]` <-> `0..100%`), `hex_color` clearing, Go zero-date sorting, `RepeatMode.Monthly`, and hourly-to-yearly recurrence parsing (`#/*` labels, `!1..5` priorities, `@today` shorthands).
  - Eliminated nested modal deadlocks, added Swipe Right **Move** + **Delete** with a 5-second **Undo** banner, collapsible **Archived Lists**, In-App Update `DOWNLOADED` snooze dismissal, and WCAG Light/Dark contrast fixes (verified by 520 tests across 39 suites in `UTC`, `America/Los_Angeles`, and `Asia/Tokyo`).

---

## 🛠️ Phase 9.1: Native Window Insets Resizing & Frame-Accurate Keyboard Avoidance (v1.2.9)

### 1. True Android Window Resizing & Frame-Synchronized Animation
- [x] **Native IME Insets & Animation Callback (`MainActivity.kt`)**:
  - Attached `ViewCompat.setOnApplyWindowInsetsListener` and `ViewCompat.setWindowInsetsAnimationCallback` to `android.R.id.content`.
  - Automatically adjusts content view padding bottom to `WindowInsetsCompat.Type.ime().bottom` frame-by-frame as the keyboard animates up and down.
  - Accounts for full keyboard height, predictive text bars, clipboard/emoji bars, and microphone strips natively without guessing offsets in JS.
  - Resizes React Native root layout and `flex: 1` containers synchronously to the true available visible screen space.
- [x] **Dynamic Safe Area Edge Toggling (`ProjectTasksScreen.tsx`)**:
  - Dynamically removes `'bottom'` safe area edge when the software keyboard is active so the bottom dock rests flush against the top of the keyboard.
  - Restores `'bottom'` safe area edge when the keyboard dismisses for gesture bar clearance.

---

## 🚀 Phase 9: Google Play In-App Updates & Background Detection (v1.2.8)

### 1. Native Play Core In-App Updates Module
- [x] **Native Play Core Integration (`InAppUpdateModule.kt` & `InAppUpdatePackage.kt`)**:
  - Integrated `com.google.android.play:app-update-ktx:2.1.0` and added R8 ProGuard keep rules.
  - Implemented `checkForUpdate` returning detailed update status (`isAvailable`, `availableVersionCode`, `isFlexibleAllowed`, `isImmediateAllowed`, `stalenessDays`, `priority`).
  - Implemented `startUpdateFlow` supporting both flexible background updates and immediate full-screen updates with `ActivityResult` callback handling.
  - Implemented `completeUpdate` for seamless install & restart of downloaded flexible updates.
  - Implemented `openPlayStore` fallback resolving directly to Guanaco's Play Store listing.
  - Implemented `InstallStateUpdatedListener` emitting live download progress events (`bytesDownloaded`, `totalBytesToDownload`, `status`).

### 2. Update Store & Periodic Background Checks
- [x] **Automated Periodic Lifecycle (`updateStore.ts` & `App.tsx`)**:
  - Checks Google Play Services on app launch (with 2.5s delay to prioritize UI responsiveness).
  - Checks Google Play Services automatically when app returns to foreground (`AppState === 'active'`) with 1-hour cooldown throttling.
  - Recurring interval checks every 3 hours while the app is running.
  - Remembers user prompt dismissals with a 24-hour snooze persisted in `AsyncStorage`.

### 3. User Prompt & Settings Integration
- [x] **In-App Prompt Modal (`AppUpdatePromptModal.tsx`)**:
  - Notifies user when an update is available on Google Play (especially internal/alpha test tracks).
  - Displays build comparison (`Build X available, currently on Build Y`), "Update Now", and "Remind Me Tomorrow" actions.
  - Displays live download progress bar when flexible update is downloading.
  - Automatically prompts user to "Restart & Apply Update" as soon as the download finishes.
- [x] **Settings "Check for Updates" Button (`SettingsModal.tsx`)**:
  - Added dedicated APP UPDATES card in Settings showing installed version/build and Play Services status.
  - Added manual "Check for Updates" button with immediate forced bypass of cooldown and tactile haptic feedback.

---

## 🛠️ Phase 8.2: Android Keyboard Avoidance & Quick Add Dock Elevation (v1.2.7)

### 1. Dynamic Keyboard Avoidance for Bottom Dock
- [x] **Keyboard Height Tracking & Android Offset Compensation (`ProjectTasksScreen.tsx`)**:
  - Identified root cause of keyboard occlusion on Android with edge-to-edge screens: `KeyboardAvoidingView` with `behavior={undefined}` on Android left the bottom dock stationary under the software keyboard.
  - Implemented dynamic `Keyboard.addListener` (`keyboardDidShow` / `keyboardDidHide`) to track keyboard height and compute safe-area-adjusted padding offset (`Math.max(0, keyboardHeight - insets.bottom)`).
  - Applied smooth layout animations via `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` when the keyboard appears or dismisses.
  - Configured `keyboardDismissMode="on-drag"` and `keyboardShouldPersistTaps="handled"` on `DraggableFlatList` for natural mobile interaction.
  - Enhanced Jest test environment in `jest.setup.ts` to support deterministic `Keyboard` event mocking and added unit test coverage in `ProjectTasksScreen.test.tsx`.

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
