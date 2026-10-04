# Privacy Policy for Guanaco

**Effective Date:** October 4, 2026  
**Last Updated:** October 4, 2026  
**Application:** Guanaco — Self-Hosted Vikunja Client (`com.geodar.guanaco`)

---

### 1. Overview & Commitment to Privacy
Guanaco is an open-source, mobile client application for the self-hosted Vikunja task management platform. We believe your productivity data belongs strictly to you. 

**Guanaco does not collect, track, store, transmit, or monetize any of your personal data, tasks, usage metrics, or diagnostic information.**

---

### 2. Data We Do NOT Collect
Guanaco adheres to a strict zero-telemetry policy:
- **No Analytics:** We do not include Google Analytics, Firebase, Sentry, Mixpanel, or any other tracking SDKs.
- **No Advertising:** Guanaco contains no advertisements and does not access advertising identifiers (GAID / IDFA).
- **No Third-Party Cloud Services:** No data is routed through developer servers, proxies, or intermediate relays.

---

### 3. How Your Data Is Processed
- **Direct Connection:** When you connect Guanaco to a Vikunja server, all network traffic (task titles, notes, labels, projects, assignees, dates) travels directly and exclusively between your mobile device and the Vikunja server instance you configure.
- **Hardware-Backed Credential Security:** Your Vikunja server URL, username, and API authentication tokens are stored securely on your device using hardware-backed keystore encryption (`expo-secure-store` / Android Keystore).
- **Offline Cache:** Tasks and projects are cached locally on your device in protected app storage to support offline-first operation and 0ms instantaneous loading.

---

### 4. Device Permissions & Biometrics
Guanaco requests only the minimal permissions required for core functionality:
- **INTERNET:** Required to communicate with your Vikunja server via HTTPS.
- **USE_BIOMETRIC / USE_FINGERPRINT (Optional):** Used solely for local app lock protection. Biometric verification is performed entirely by Android native secure hardware. Guanaco never accesses, stores, or transmits biometric templates or raw biometric data.
- **VIBRATE:** Used exclusively for tactile haptic feedback during task completions and gesture interactions.

---

### 5. Data Retention & Deletion
- Because the developer does not operate any centralized servers or databases for Guanaco, we do not possess your data.
- You maintain complete control over your local data. Tapping **"Log Out"** or uninstalling the app immediately purges all locally stored authentication tokens, cache files, and queued operations from your device.
- Remote task data is governed by the privacy policy and database settings of your self-hosted Vikunja instance.

---

### 6. Children's Privacy
Guanaco does not knowingly collect or solicit any personal information from children under the age of 13.

---

### 7. Changes to This Privacy Policy
We may update this policy if new features require changes in data handling. Any updates will be reflected with a revised "Last Updated" date at the top of this document.

---

### 8. Contact Us
If you have any questions or feedback regarding this Privacy Policy, please contact:
- **Developer:** Guanaco Open Source Project
- **Support / Inquiries:** guanaco-developer@guanaco-app.iam.gserviceaccount.com (or your personal developer email)
