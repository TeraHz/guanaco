@file:Suppress("DEPRECATION_ERROR")

package com.geodar.guanaco

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.modules.network.NetworkingModule
import okhttp3.Interceptor

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory
import com.geodar.guanaco.update.InAppUpdatePackage

private data class ExplicitRefreshCookieTag(val token: String, val host: String)

private object RefreshCookieCaptureInterceptor : Interceptor {
  private val refreshCookieRegex =
    Regex("""(?:^|[;\s,])vikunja_refresh_token=([^;\r\n\s,]+)""", RegexOption.IGNORE_CASE)

  override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
    val request = chain.request()
    val rawCookie = request.header("Cookie") ?: return chain.proceed(request)
    val match = refreshCookieRegex.findAll(rawCookie).lastOrNull() ?: return chain.proceed(request)
    val token = match.groupValues[1].trim('"').trim()
    if (token.isEmpty()) return chain.proceed(request)
    val host = request.url().host()
    return chain.proceed(
      request
        .newBuilder()
        .tag(ExplicitRefreshCookieTag::class.java, ExplicitRefreshCookieTag(token = token, host = host))
        .build()
    )
  }
}

private object RefreshCookieMergeInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
    val request = chain.request()
    val tag = request.tag(ExplicitRefreshCookieTag::class.java) ?: return chain.proceed(request)
    if (!request.url().host().equals(tag.host, ignoreCase = true)) {
      return chain.proceed(request)
    }
    val existing = request.header("Cookie")
    val preservedPairs =
      existing
        ?.split(';')
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() && !it.startsWith("vikunja_refresh_token=", ignoreCase = true) }
        .orEmpty()
    val merged = (preservedPairs + "vikunja_refresh_token=${tag.token}").joinToString("; ")
    return chain.proceed(request.newBuilder().header("Cookie", merged).build())
  }
}

private object GuanacoUserAgentInterceptor : Interceptor {
  private val defaultUserAgent = "Guanaco/${BuildConfig.VERSION_NAME} (Android)"

  override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
    val request = chain.request()
    val existingUa = request.header("User-Agent")
    if (!existingUa.isNullOrBlank() && existingUa.startsWith("Guanaco/", ignoreCase = true)) {
      return chain.proceed(request)
    }
    return chain.proceed(
      request.newBuilder().header("User-Agent", defaultUserAgent).build()
    )
  }
}

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(InAppUpdatePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Ensure SecureStore-backed `vikunja_refresh_token` always wins over stale/async WebView CookieManager entries
    // in OkHttp's BridgeInterceptor while preserving any reverse-proxy cookies (Cloudflare, Authelia, etc.).
    NetworkingModule.setCustomClientBuilder { builder ->
      if (!builder.interceptors().contains(GuanacoUserAgentInterceptor)) {
        builder.addInterceptor(GuanacoUserAgentInterceptor)
      }
      if (!builder.interceptors().contains(RefreshCookieCaptureInterceptor)) {
        builder.addInterceptor(RefreshCookieCaptureInterceptor)
      }
      if (!builder.networkInterceptors().contains(RefreshCookieMergeInterceptor)) {
        builder.addNetworkInterceptor(RefreshCookieMergeInterceptor)
      }
    }
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
