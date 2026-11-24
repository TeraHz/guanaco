package com.geodar.guanaco.update

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
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
    }

    private val appUpdateManager: AppUpdateManager by lazy {
        AppUpdateManagerFactory.create(reactContext)
    }

    private val promiseLock = Any()
    private var pendingPromise: Promise? = null

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
            }
        }

        override fun onNewIntent(intent: Intent) {
            // No-op
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
        try {
            appUpdateManager.registerListener(installStateUpdatedListener)
        } catch (_: Exception) {}
    }

    override fun invalidate() {
        try {
            reactContext.removeActivityEventListener(activityEventListener)
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
                if (act is FragmentActivity && act.supportFragmentManager.isStateSaved) {
                    promise.resolve(false)
                    return@runOnUiQueueThread
                }
                promise.resolve(true)
            } catch (_: Exception) {
                promise.resolve(true)
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

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in Event Emitter Calls
    }
}
