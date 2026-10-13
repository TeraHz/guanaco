package com.geodar.guanaco.update

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
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

    private var pendingPromise: Promise? = null

    private val installStateUpdatedListener = InstallStateUpdatedListener { state: InstallState ->
        val status = when (state.installStatus()) {
            InstallStatus.PENDING -> "PENDING"
            InstallStatus.DOWNLOADING -> "DOWNLOADING"
            InstallStatus.DOWNLOADED -> "DOWNLOADED"
            InstallStatus.INSTALLING -> "INSTALLING"
            InstallStatus.INSTALLED -> "INSTALLED"
            InstallStatus.FAILED -> "FAILED"
            InstallStatus.CANCELED -> "CANCELED"
            else -> "UNKNOWN"
        }

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
                val promise = pendingPromise
                pendingPromise = null
                if (promise == null) return

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
                        result.putString("status", "unknown")
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
        super.invalidate()
        try {
            appUpdateManager.unregisterListener(installStateUpdatedListener)
        } catch (_: Exception) {}
    }

    override fun getName(): String = NAME

    private fun sendEvent(eventName: String, params: WritableMap?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        }
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

                val stalenessDays = appUpdateInfo.clientVersionStalenessDays() ?: -1
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
                    putInt("clientVersionStalenessDays", stalenessDays)
                    putInt("updatePriority", priority)
                    putBoolean("inProgress", inProgress)
                }
                promise.resolve(map)
            }
            .addOnFailureListener { exception ->
                promise.reject("UPDATE_CHECK_FAILED", exception.message ?: "Failed to check update", exception)
            }
    }

    @ReactMethod
    fun startUpdateFlow(typeString: String, promise: Promise) {
        val currentAct = reactContext.currentActivity
        if (currentAct == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }

        val updateType = if (typeString.equals("immediate", ignoreCase = true)) {
            AppUpdateType.IMMEDIATE
        } else {
            AppUpdateType.FLEXIBLE
        }
        val options = AppUpdateOptions.defaultOptions(updateType)

        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { appUpdateInfo ->
                val availability = appUpdateInfo.updateAvailability()
                if (availability == UpdateAvailability.UPDATE_AVAILABLE ||
                    availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                ) {
                    pendingPromise = promise
                    try {
                        val started = appUpdateManager.startUpdateFlowForResult(
                            appUpdateInfo,
                            currentAct,
                            options,
                            REQUEST_CODE_UPDATE
                        )
                        if (!started) {
                            pendingPromise = null
                            promise.reject("START_FLOW_FAILED", "Could not start update flow")
                        }
                    } catch (e: Exception) {
                        pendingPromise = null
                        promise.reject("FLOW_EXCEPTION", e.message ?: "Update flow exception", e)
                    }
                } else {
                    promise.reject(
                        "UPDATE_NOT_ALLOWED",
                        "Update not available or update type not allowed"
                    )
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
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in Event Emitter Calls
    }
}
