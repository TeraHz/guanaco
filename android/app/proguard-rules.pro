# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# React Native & Hermes
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends com.facebook.react.bridge.JavaScriptModule { *; }
-keep public class * extends com.facebook.react.bridge.NativeModule { *; }
-keepclassmembers class * {
  @com.facebook.react.bridge.ReactMethod *;
  @com.facebook.react.bridge.ReactProp *;
  @com.facebook.react.bridge.ReactPropGroup *;
}
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Google Play In-App Updates
-keep class com.google.android.play.core.appupdate.** { *; }
-keep class com.google.android.play.core.install.** { *; }


