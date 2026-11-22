# Privacy Policy for Guanaco

**Effective Date:** October 4, 2026  
**Last Updated:** November 22, 2026  
**Application:** Guanaco — Self-Hosted Vikunja Client (`com.geodar.guanaco`)

---

### 1. Overview & Commitment to Privacy
Guanaco is an open-source client application for the self-hosted Vikunja task management platform. We believe your productivity data belongs strictly to you.

**Guanaco does not collect, track, store, transmit, or monetize any of your personal data, tasks, usage metrics, or diagnostic information.**

---

### 2. Data We Do NOT Collect
Guanaco adheres to a strict zero-telemetry policy:
- **No Analytics or Crash Reporting:** We do not include Google Analytics, Firebase, Sentry, Crashlytics, Mixpanel, or any other tracking SDKs.
- **No Advertising:** Guanaco contains no advertisements and does not access advertising identifiers (GAID / IDFA).
- **No Third-Party Cloud Relays:** No task data, credentials, or notifications are routed through developer servers, proxies, or intermediate relays.
- **No Plaintext Password Storage:** Guanaco never saves your Vikunja account password to disk or device storage. Your password (and optional TOTP 2FA code) is used only during initial sign-in to obtain an authentication token and is immediately discarded.

---

### 3. How Your Data Is Processed & Stored On-Device
- **Direct Server Connection:** All network traffic (tasks, notes, labels, projects, assignees, schedules) travels directly and exclusively between your device and the Vikunja server instance URL you configure (HTTPS enforced by default; cleartext HTTP requires explicit user confirmation for local/LAN servers).
- **Hardware-Backed Token Security:** On mobile devices, your authentication token (session JWT or Personal API Token) and username are encrypted locally using hardware-backed secure storage (`expo-secure-store` — Android Keystore / iOS Keychain), while your server URL is stored in local app storage. On Web builds where hardware keystores do not exist, browser local storage is used.
- **Offline Cache & Cloud Backup Protection (`android:allowBackup="false"`):** Tasks, projects, and pending offline mutations are cached locally in protected application storage for 0ms offline-first operation. Android Cloud Auto-Backup and device-to-device app data extraction are explicitly disabled (`android:allowBackup="false"`) so your local cache is never silently uploaded to cloud backup servers.
- **100% On-Device Contextual Organization:** Smart task categorization and aisle grouping run locally on your device (using local heuristics or Android on-device AICore where supported). Zero task content is sent to external AI services.
- **Google Play In-App Updates (Android Play Store builds):** On Android devices with Google Play Services, Guanaco queries the official Google Play In-App Updates API solely to check whether a newer app build is available and initiate user-approved updates.

---

### 4. Device Permissions & Biometrics
Guanaco requests only the minimal permissions required for user-facing functionality:
- **`INTERNET` & `ACCESS_NETWORK_STATE`:** Required to communicate directly with your configured Vikunja server and detect online/offline connectivity for synchronization and Google Play In-App Updates.
- **`POST_NOTIFICATIONS` (Optional):** Used exclusively to schedule and display **100% local on-device task reminder notifications**. Guanaco never registers for remote push tokens (dormant FCM/DataTransport manifest components are stripped at build time) and does not request exact-alarm privileges (`SCHEDULE_EXACT_ALARM`).
- **`RECEIVE_BOOT_COMPLETED` & `WAKE_LOCK`:** Used exclusively by the local notification scheduler (`expo-notifications`) and Play Core update installer to restore and reliably deliver pending on-device task reminders after a device reboot or while the screen is off. Guanaco does not start background tracking or external network connections on boot.
- **`USE_BIOMETRIC` / `USE_FINGERPRINT` (Optional):** Used solely for local biometric app lock protection. Biometric verification is performed entirely by native OS secure hardware; Guanaco never accesses, stores, or transmits biometric templates or raw biometric data.
- **`VIBRATE`:** Used exclusively for local tactile haptic feedback during task completions and gesture interactions.

---

### 5. Data Retention & Deletion
- Because the developer does not operate any centralized servers or databases for Guanaco, we never possess a copy of your data.
- Tapping **"Log Out"** or uninstalling the app immediately purges locally stored authentication tokens, cached tasks/projects, scheduled local notifications, AI category cache, and session state from your device.
- Remote task data on your Vikunja server is governed solely by the retention settings and administration of your Vikunja instance.

---

### 6. Children's Privacy
Guanaco does not knowingly collect or solicit any personal information from anyone, including children under the age of 13.

---

### 7. Changes to This Privacy Policy
If new features require updates to this policy, changes will be published in the open-source repository with an updated "Last Updated" date at the top of this document.

---

### 8. Contact Us
If you have questions or feedback regarding this Privacy Policy, please reach out via our open-source repository:
- **Project:** Guanaco Open Source Project
- **Repository & Issue Tracker:** [https://github.com/TeraHz/guanaco/issues](https://github.com/TeraHz/guanaco/issues)
