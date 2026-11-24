package com.geodar.guanaco.update

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallState
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.ActivityResult
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability

class InAppUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "InAppUpdate"
        private const val REQUEST_CODE_UPDATE = 42123
        private const val REQUEST_CODE_CREATE_JSON = 42124
        private const val REQUEST_CODE_OPEN_JSON = 42125
        private const val MAX_JSON_DOCUMENT_BYTES = 10 * 1024 * 1024
    }

    private val appUpdateManager: AppUpdateManager by lazy {
        AppUpdateManagerFactory.create(reactContext)
    }

    private val promiseLock = Any()
    private var pendingPromise: Promise? = null
    private var pendingDocPromise: Promise? = null
    private var pendingDocRequestCode: Int = 0
    private var pendingExportJson: String? = null
    @Volatile
    private var lastActivityResumedAtMs: Long = SystemClock.elapsedRealtime()

    private val lifecycleEventListener = object : LifecycleEventListener {
        override fun onHostResume() {
            lastActivityResumedAtMs = SystemClock.elapsedRealtime()
        }

        override fun onHostPause() {}

        override fun onHostDestroy() {}
    }

    private fun takePendingPromise(): Promise? = synchronized(promiseLock) {
        val current = pendingPromise
        pendingPromise = null
        current
    }

    private fun replacePendingPromise(next: Promise?): Promise? = synchronized(promiseLock) {
        val previous = pendingPromise
        pendingPromise = next
        previous
    }

    private fun clearPendingPromiseIfMatches(expected: Promise): Boolean = synchronized(promiseLock) {
        if (pendingPromise === expected) {
            pendingPromise = null
            true
        } else {
            false
        }
    }

    private fun mapInstallStatus(statusCode: Int): String = when (statusCode) {
        InstallStatus.PENDING -> "PENDING"
        InstallStatus.DOWNLOADING -> "DOWNLOADING"
        InstallStatus.DOWNLOADED -> "DOWNLOADED"
        InstallStatus.INSTALLING -> "INSTALLING"
        InstallStatus.INSTALLED -> "INSTALLED"
        InstallStatus.FAILED -> "FAILED"
        InstallStatus.CANCELED -> "CANCELED"
        else -> "UNKNOWN"
    }

    private val installStateUpdatedListener = InstallStateUpdatedListener { state: InstallState ->
        val status = mapInstallStatus(state.installStatus())

        val params = Arguments.createMap().apply {
            putString("status", status)
            putDouble("bytesDownloaded", state.bytesDownloaded().toDouble())
            putDouble("totalBytesToDownload", state.totalBytesToDownload().toDouble())
            putInt("errorCode", state.installErrorCode())
        }
        sendEvent("onInstallStateChanged", params)
    }

    private val activityEventListener: ActivityEventListener = object : ActivityEventListener {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?
        ) {
            if (requestCode == REQUEST_CODE_UPDATE) {
                val promise = takePendingPromise() ?: return

                val result = Arguments.createMap()
                when (resultCode) {
                    Activity.RESULT_OK -> {
                        result.putString("status", "accepted")
                        promise.resolve(result)
                    }
                    Activity.RESULT_CANCELED -> {
                        result.putString("status", "canceled")
                        promise.resolve(result)
                    }
                    ActivityResult.RESULT_IN_APP_UPDATE_FAILED -> {
                        result.putString("status", "failed")
                        promise.resolve(result)
                    }
                    else -> {
                        result.putString("status", "failed")
                        result.putInt("resultCode", resultCode)
                        promise.resolve(result)
                    }
                }
                return
            }

            if (requestCode == REQUEST_CODE_CREATE_JSON) {
                val (docPromise, exportJson) = synchronized(promiseLock) {
                    if (pendingDocRequestCode != REQUEST_CODE_CREATE_JSON) {
                        Pair(null, null)
                    } else {
                        val p = pendingDocPromise
                        val c = pendingExportJson
                        pendingDocPromise = null
                        pendingDocRequestCode = 0
                        pendingExportJson = null
                        Pair(p, c)
                    }
                }
                if (docPromise == null) return

                if (resultCode != Activity.RESULT_OK || data?.data == null) {
                    val res = Arguments.createMap().apply { putString("status", "canceled") }
                    docPromise.resolve(res)
                    return
                }

                if (exportJson == null) {
                    docPromise.reject("SAVE_JSON_FAILED", "Missing backup payload for document write")
                    return
                }

                val targetUri = data.data!!
                Thread {
                    try {
                        val utf8Bytes = exportJson.toByteArray(Charsets.UTF_8)
                        val pfd = openSafeExternalDescriptor(targetUri, isWrite = true)
                        android.os.ParcelFileDescriptor.AutoCloseOutputStream(pfd).use { os ->
                            os.write(utf8Bytes)
                            os.flush()
                        }
                        val res = Arguments.createMap().apply { putString("status", "saved") }
                        docPromise.resolve(res)
                    } catch (oom: OutOfMemoryError) {
                        docPromise.reject("OUT_OF_MEMORY", "Not enough memory to export backup JSON")
                    } catch (e: Throwable) {
                        docPromise.reject("SAVE_JSON_FAILED", e.message ?: "Failed to write backup JSON")
                    }
                }.start()
                return
            }

            if (requestCode == REQUEST_CODE_OPEN_JSON) {
                val docPromise = synchronized(promiseLock) {
                    if (pendingDocRequestCode != REQUEST_CODE_OPEN_JSON) {
                        null
                    } else {
                        val p = pendingDocPromise
                        pendingDocPromise = null
                        pendingDocRequestCode = 0
                        pendingExportJson = null
                        p
                    }
                } ?: return

                if (resultCode != Activity.RESULT_OK || data?.data == null) {
                    val res = Arguments.createMap().apply { putString("status", "canceled") }
                    docPromise.resolve(res)
                    return
                }

                val sourceUri = data.data!!
                Thread {
                    try {
                        val pfd = openSafeExternalDescriptor(sourceUri, isWrite = false)
                        android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).use { ins ->
                            val buffer = java.io.ByteArrayOutputStream()
                            val chunk = ByteArray(16 * 1024)
                            var totalRead = 0
                            while (true) {
                                val read = ins.read(chunk)
                                if (read <= 0) break
                                totalRead += read
                                if (totalRead > MAX_JSON_DOCUMENT_BYTES) {
                                    docPromise.reject(
                                        "FILE_TOO_LARGE",
                                        "Backup file exceeds the 10 MB safety limit."
                                    )
                                    return@Thread
                                }
                                buffer.write(chunk, 0, read)
                            }
                            val content = buffer.toString(Charsets.UTF_8.name())
                            val res = Arguments.createMap().apply {
                                putString("status", "loaded")
                                putString("content", content)
                            }
                            docPromise.resolve(res)
                        }
                    } catch (oom: OutOfMemoryError) {
                        docPromise.reject("OUT_OF_MEMORY", "Backup file is too large for available memory")
                    } catch (e: Throwable) {
                        docPromise.reject("OPEN_JSON_FAILED", e.message ?: "Failed to read backup file")
                    }
                }.start()
                return
            }
        }

        override fun onNewIntent(intent: Intent) {
            // No-op
        }
    }

    init {
        lastActivityResumedAtMs = SystemClock.elapsedRealtime()
        reactContext.addActivityEventListener(activityEventListener)
        reactContext.addLifecycleEventListener(lifecycleEventListener)
        try {
            appUpdateManager.registerListener(installStateUpdatedListener)
        } catch (_: Exception) {}
    }

    override fun invalidate() {
        try {
            reactContext.removeActivityEventListener(activityEventListener)
        } catch (_: Exception) {}
        try {
            reactContext.removeLifecycleEventListener(lifecycleEventListener)
        } catch (_: Exception) {}
        try {
            appUpdateManager.unregisterListener(installStateUpdatedListener)
        } catch (_: Exception) {}
        try {
            takePendingPromise()?.reject(
                "MODULE_INVALIDATED",
                "InAppUpdateModule invalidated before update flow completed"
            )
        } catch (_: Exception) {}
        try {
            val staleDoc = synchronized(promiseLock) {
                val p = pendingDocPromise
                pendingDocPromise = null
                pendingDocRequestCode = 0
                pendingExportJson = null
                p
            }
            staleDoc?.reject("MODULE_INVALIDATED", "Module invalidated before document picker completed")
        } catch (_: Exception) {}
        super.invalidate()
    }

    override fun getName(): String = NAME

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        }
    }

    private fun isActivityUsable(activity: Activity?): Boolean {
        return activity != null && !activity.isFinishing && !activity.isDestroyed
    }

    @ReactMethod
    fun checkForUpdate(promise: Promise) {
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { appUpdateInfo: AppUpdateInfo ->
                val availability = appUpdateInfo.updateAvailability()
                val isAvailable = availability == UpdateAvailability.UPDATE_AVAILABLE ||
                        availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                val inProgress = availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                val availableVersionCode = appUpdateInfo.availableVersionCode()

                val isImmediateAllowed = try {
                    appUpdateInfo.isUpdateTypeAllowed(AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
                } catch (_: Exception) { false }

                val isFlexibleAllowed = try {
                    appUpdateInfo.isUpdateTypeAllowed(AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE))
                } catch (_: Exception) { false }

                val stalenessDays = appUpdateInfo.clientVersionStalenessDays()
                val priority = appUpdateInfo.updatePriority()

                var currentVersionCode = 0
                try {
                    val pInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
                    currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        pInfo.longVersionCode.toInt()
                    } else {
                        @Suppress("DEPRECATION")
                        pInfo.versionCode
                    }
                } catch (_: Exception) {}

                val map = Arguments.createMap().apply {
                    putBoolean("isAvailable", isAvailable)
                    putInt("availableVersionCode", availableVersionCode)
                    putInt("currentVersionCode", currentVersionCode)
                    putInt("updateAvailability", availability)
                    putBoolean("isImmediateAllowed", isImmediateAllowed)
                    putBoolean("isFlexibleAllowed", isFlexibleAllowed)
                    if (stalenessDays != null) {
                        putInt("clientVersionStalenessDays", stalenessDays)
                    } else {
                        putNull("clientVersionStalenessDays")
                    }
                    putInt("updatePriority", priority)
                    putBoolean("inProgress", inProgress)
                    putString("installStatus", mapInstallStatus(appUpdateInfo.installStatus()))
                }

                // Surface flexible updates that finished downloading while the app was backgrounded
                if (appUpdateInfo.installStatus() == InstallStatus.DOWNLOADED) {
                    val downloadedParams = Arguments.createMap().apply {
                        putString("status", "DOWNLOADED")
                        putDouble("bytesDownloaded", appUpdateInfo.bytesDownloaded().toDouble())
                        putDouble("totalBytesToDownload", appUpdateInfo.totalBytesToDownload().toDouble())
                        putInt("errorCode", 0)
                    }
                    sendEvent("onInstallStateChanged", downloadedParams)
                }

                promise.resolve(map)
            }
            .addOnFailureListener { exception ->
                promise.reject("UPDATE_CHECK_FAILED", exception.message ?: "Failed to check update", exception)
            }
    }

    @ReactMethod
    fun startUpdateFlow(typeString: String, promise: Promise) {
        val initialAct = reactContext.currentActivity
        if (!isActivityUsable(initialAct)) {
            promise.reject("NO_ACTIVITY", "Current activity is null, finishing, or destroyed")
            return
        }

        val requestedType = if (typeString.equals("immediate", ignoreCase = true)) {
            AppUpdateType.IMMEDIATE
        } else {
            AppUpdateType.FLEXIBLE
        }

        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { appUpdateInfo ->
                val liveActivity = reactContext.currentActivity
                if (!isActivityUsable(liveActivity) || liveActivity == null) {
                    promise.reject("NO_ACTIVITY", "Current activity became unavailable before update flow started")
                    return@addOnSuccessListener
                }

                val availability = appUpdateInfo.updateAvailability()
                if (availability != UpdateAvailability.UPDATE_AVAILABLE &&
                    availability != UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                ) {
                    promise.reject(
                        "UPDATE_NOT_ALLOWED",
                        "Update is not available (availability=$availability)"
                    )
                    return@addOnSuccessListener
                }

                val immediateOptions = AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE)
                val requestedOptions = AppUpdateOptions.defaultOptions(requestedType)

                val isImmediateAllowed = try {
                    appUpdateInfo.isUpdateTypeAllowed(immediateOptions)
                } catch (_: Exception) { false }

                val options = if (
                    availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS &&
                    isImmediateAllowed
                ) {
                    immediateOptions
                } else {
                    requestedOptions
                }

                val isAllowed = try {
                    appUpdateInfo.isUpdateTypeAllowed(options)
                } catch (_: Exception) { false }

                if (!isAllowed) {
                    promise.reject(
                        "UPDATE_NOT_ALLOWED",
                        "Requested update type is not allowed for current appUpdateInfo state"
                    )
                    return@addOnSuccessListener
                }

                // Guard and cleanly reject any stale in-flight promise before starting a new flow
                val stalePromise = replacePendingPromise(promise)
                try {
                    stalePromise?.reject(
                        "UPDATE_SUPERSEDED",
                        "Previous in-app update request was superseded by a new update flow"
                    )
                } catch (_: Exception) {}

                try {
                    val started = appUpdateManager.startUpdateFlowForResult(
                        appUpdateInfo,
                        liveActivity,
                        options,
                        REQUEST_CODE_UPDATE
                    )
                    if (!started) {
                        clearPendingPromiseIfMatches(promise)
                        promise.reject("START_FLOW_FAILED", "Could not start update flow")
                    }
                } catch (e: Exception) {
                    clearPendingPromiseIfMatches(promise)
                    promise.reject("FLOW_EXCEPTION", e.message ?: "Update flow exception", e)
                }
            }
            .addOnFailureListener { e ->
                promise.reject("INFO_FETCH_FAILED", e.message ?: "Failed to get app update info", e)
            }
    }

    @ReactMethod
    fun completeUpdate(promise: Promise) {
        appUpdateManager.completeUpdate()
            .addOnSuccessListener {
                promise.resolve(true)
            }
            .addOnFailureListener { e ->
                promise.reject("COMPLETE_UPDATE_FAILED", e.message ?: "Failed to complete update", e)
            }
    }

    @ReactMethod
    fun openPlayStore(promise: Promise) {
        try {
            val packageName = reactContext.packageName
            val marketIntent = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(marketIntent)
            promise.resolve(true)
        } catch (_: Exception) {
            try {
                val webIntent = Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(webIntent)
                promise.resolve(true)
            } catch (err: Exception) {
                promise.reject("OPEN_PLAY_STORE_FAILED", err.message ?: "Failed to open Play Store", err)
            }
        }
    }

    @ReactMethod
    fun isActivityReadyForBiometrics(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val km = reactContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                if (km?.isKeyguardLocked == true) {
                    promise.resolve(false)
                    return@runOnUiQueueThread
                }
                val act = reactContext.currentActivity
                if (!isActivityUsable(act) || act == null || !act.hasWindowFocus()) {
                    promise.resolve(false)
                    return@runOnUiQueueThread
                }
                if (act is FragmentActivity) {
                    if (
                        !act.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
                        act.supportFragmentManager.isStateSaved
                    ) {
                        promise.resolve(false)
                        return@runOnUiQueueThread
                    }
                }
                promise.resolve(true)
            } catch (_: Exception) {
                promise.resolve(true)
            }
        }
    }

    @ReactMethod
    fun getBiometricSensorState(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val elapsedSinceResume =
                    (SystemClock.elapsedRealtime() - lastActivityResumedAtMs).coerceAtLeast(0L)
                val act = reactContext.currentActivity
                val decor = act?.window?.decorView
                val decorReady = decor != null &&
                        decor.isAttachedToWindow &&
                        decor.width > 0 &&
                        decor.height > 0 &&
                        act.hasWindowFocus()

                var status = "unknown"
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bm = reactContext.getSystemService(BiometricManager::class.java)
                    if (bm != null) {
                        status = when (
                            bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                        ) {
                            BiometricManager.BIOMETRIC_SUCCESS -> "ready"
                            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "hw_unavailable"
                            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
                            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no_hardware"
                            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
                                "security_update_required"
                            else -> "unknown"
                        }
                    }
                }

                val map = Arguments.createMap().apply {
                    putString("status", status)
                    putDouble("msSinceResume", elapsedSinceResume.toDouble())
                    putBoolean("decorReady", decorReady)
                }
                promise.resolve(map)
            } catch (_: Exception) {
                val fallback = Arguments.createMap().apply {
                    putString("status", "unknown")
                    putDouble("msSinceResume", 1000.0)
                    putBoolean("decorReady", true)
                }
                promise.resolve(fallback)
            }
        }
    }

    @ReactMethod
    fun resetOrphanedBiometricFragment(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                val act = reactContext.currentActivity as? FragmentActivity
                if (act != null && !act.isFinishing && !act.isDestroyed) {
                    val fm = act.supportFragmentManager
                    val existing = fm.findFragmentByTag("androidx.biometric.BiometricFragment")
                    if (existing != null) {
                        fm.beginTransaction().remove(existing).commitNowAllowingStateLoss()
                    }
                }
                promise.resolve(true)
            } catch (_: Exception) {
                promise.resolve(false)
            }
        }
    }

    private fun openSafeExternalDescriptor(
        uri: Uri,
        isWrite: Boolean
    ): android.os.ParcelFileDescriptor {
        if (!android.content.ContentResolver.SCHEME_CONTENT.equals(uri.scheme, ignoreCase = true)) {
            throw SecurityException("Rejected non-content URI scheme")
        }
        val rawAuthority = uri.authority?.takeIf { it.isNotBlank() }
            ?: throw SecurityException("Rejected content URI without authority")
        val cleanAuthority = rawAuthority.substringAfter('@').takeIf { it.isNotBlank() }
            ?: throw SecurityException("Rejected content URI without authority")

        // Best-effort resolve: an app always has PackageManager visibility into its own package,
        // whereas Android 11+ package filtering may hide third-party cloud DocumentsProviders and
        // external FileProviders deliberately set exported="false" + grantUriPermissions="true".
        val providerInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.packageManager.resolveContentProvider(
                cleanAuthority,
                android.content.pm.PackageManager.ComponentInfoFlags.of(0)
            )
        } else {
            @Suppress("DEPRECATION")
            reactContext.packageManager.resolveContentProvider(cleanAuthority, 0)
        }

        val myUid = android.os.Process.myUid()
        if (providerInfo != null && (
                providerInfo.packageName == reactContext.packageName ||
                providerInfo.applicationInfo?.uid == myUid
            )
        ) {
            throw SecurityException("Rejected internal ContentProvider URI")
        }

        val resolver = reactContext.contentResolver
        val pfd = if (isWrite) {
            runCatching { resolver.openFileDescriptor(uri, "wt") }.getOrNull()
                ?: runCatching { resolver.openFileDescriptor(uri, "w") }.getOrNull()
                ?: resolver.openFileDescriptor(uri, "rw")
        } else {
            resolver.openFileDescriptor(uri, "r")
        } ?: throw IllegalStateException("Unable to open file descriptor")

        try {
            val stat = android.system.Os.fstat(pfd.fileDescriptor)
            if (stat.st_uid == myUid) {
                throw SecurityException("Rejected file descriptor owned by app UID")
            }
            try {
                val resolvedPath =
                    java.io.File(android.system.Os.readlink("/proc/self/fd/${pfd.fd}")).canonicalPath
                val privateRoots = listOfNotNull(
                    reactContext.applicationInfo?.dataDir?.let { java.io.File(it).canonicalPath },
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
                        reactContext.applicationInfo?.deviceProtectedDataDir?.let {
                            java.io.File(it).canonicalPath
                        }
                    else null,
                    "/data/data/${reactContext.packageName}",
                    "/data/user/0/${reactContext.packageName}"
                )
                if (privateRoots.any { resolvedPath == it || resolvedPath.startsWith("$it/") }) {
                    throw SecurityException("Rejected descriptor targeting private app storage")
                }
            } catch (sec: SecurityException) {
                throw sec
            } catch (_: Exception) {
                // Pipe descriptors from cloud SAF providers are safe once st_uid != myUid is verified
            }
            if (isWrite) {
                try {
                    android.system.Os.ftruncate(pfd.fileDescriptor, 0L)
                } catch (_: Exception) {}
            }
            return pfd
        } catch (t: Throwable) {
            try {
                pfd.close()
            } catch (_: Exception) {}
            throw t
        }
    }

    @ReactMethod
    fun saveJsonDocument(fileName: String, jsonContent: String, promise: Promise) {
        val act = reactContext.currentActivity
        if (!isActivityUsable(act) || act == null) {
            promise.reject("NO_ACTIVITY", "Current activity is unavailable")
            return
        }
        val stale = synchronized(promiseLock) {
            val prev = pendingDocPromise
            pendingDocPromise = promise
            pendingDocRequestCode = REQUEST_CODE_CREATE_JSON
            pendingExportJson = jsonContent
            prev
        }
        try {
            stale?.reject("DOC_PICKER_SUPERSEDED", "Previous document request superseded")
        } catch (_: Exception) {}

        try {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, fileName)
            }
            act.startActivityForResult(intent, REQUEST_CODE_CREATE_JSON)
        } catch (e: Exception) {
            synchronized(promiseLock) {
                if (pendingDocPromise === promise) {
                    pendingDocPromise = null
                    pendingDocRequestCode = 0
                    pendingExportJson = null
                }
            }
            promise.reject("CREATE_DOC_UNAVAILABLE", e.message ?: "Could not launch file saver", e)
        }
    }

    @ReactMethod
    fun openJsonDocument(promise: Promise) {
        val act = reactContext.currentActivity
        if (!isActivityUsable(act) || act == null) {
            promise.reject("NO_ACTIVITY", "Current activity is unavailable")
            return
        }
        val stale = synchronized(promiseLock) {
            val prev = pendingDocPromise
            pendingDocPromise = promise
            pendingDocRequestCode = REQUEST_CODE_OPEN_JSON
            pendingExportJson = null
            prev
        }
        try {
            stale?.reject("DOC_PICKER_SUPERSEDED", "Previous document request superseded")
        } catch (_: Exception) {}

        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf("application/json", "text/json", "text/plain", "application/octet-stream")
                )
            }
            act.startActivityForResult(intent, REQUEST_CODE_OPEN_JSON)
        } catch (e: Exception) {
            synchronized(promiseLock) {
                if (pendingDocPromise === promise) {
                    pendingDocPromise = null
                    pendingDocRequestCode = 0
                }
            }
            promise.reject("OPEN_DOC_UNAVAILABLE", e.message ?: "Could not launch file picker", e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in Event Emitter Calls
    }
}
