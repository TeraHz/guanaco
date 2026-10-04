#!/usr/bin/env bash
set -e

# Zero Telemetry / Privacy: strictly disable all metrics, analytics, and phone-home heartbeats
export EXPO_NO_TELEMETRY=1
export EXPO_OFFLINE=1
export DO_NOT_TRACK=1

echo "=== Building Guanaco Android App Bundle (.aab) Locally ==="

# Auto-detect Android SDK if not set
if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  if [ -d "/opt/homebrew/share/android-commandlinetools" ]; then
    export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
  else
    echo "❌ Error: Android SDK not found."
    echo "Install via Homebrew: brew install --cask android-commandlinetools"
    exit 1
  fi
fi

echo "Using Android SDK: $ANDROID_HOME"

# Generate native android directory if missing
if [ ! -d "android" ]; then
  echo "1. Generating Android native project via Expo Prebuild..."
  npx expo prebuild --platform android
fi

# Ensure release keystore is in android/app
if [ -f "guanaco-release.keystore" ] && [ ! -f "android/app/guanaco-release.keystore" ]; then
  echo "Copying guanaco-release.keystore to android/app/..."
  cp guanaco-release.keystore android/app/guanaco-release.keystore
fi

# Sync version and versionCode from app.json to android/app/build.gradle
node -e "
const fs = require('fs');
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
const version = appJson.expo.version;
const versionCode = appJson.expo.android.versionCode;
let gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
gradle = gradle.replace(/versionCode \d+/, 'versionCode ' + versionCode);
gradle = gradle.replace(/versionName \".*\"/, 'versionName \"' + version + '\"');
fs.writeFileSync('android/app/build.gradle', gradle);
console.log('Synced build.gradle to version ' + version + ' (' + versionCode + ')');
"

echo "2. Building release bundle (.aab)..."
cd android
./gradlew bundleRelease

cp app/build/outputs/bundle/release/app-release.aab ../guanaco-release.aab
cd ..

GIT_REV=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || git describe --tags --always 2>/dev/null || echo "untagged")
GIT_DIRTY=$(git status --porcelain 2>/dev/null)

echo ""
echo "=== Build Complete! ==="
echo "Artifact:       guanaco-release.aab"
echo "Git Checkpoint: ${GIT_REV} (${GIT_TAG})"
if [ -n "$GIT_DIRTY" ]; then
  echo "⚠️  Note: Working tree has uncommitted changes. Make sure to commit and tag your release!"
fi
