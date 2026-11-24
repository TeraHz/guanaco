#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Zero Telemetry / Privacy: strictly disable all metrics, analytics, and phone-home heartbeats
export EXPO_NO_TELEMETRY=1
export EXPO_OFFLINE=1
export DO_NOT_TRACK=1

echo "=== Building Guanaco Android App Bundle (.aab) Locally ==="

# Auto-detect Android SDK if not set
if [ -z "${ANDROID_HOME:-}" ] || [ ! -d "${ANDROID_HOME:-}" ]; then
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

if [ "${SKIP_PREBUILD_TESTS:-0}" != "1" ]; then
  echo "Running pre-release typecheck and multi-timezone test gate (UTC, America/Los_Angeles, Asia/Tokyo)..."
  npm run typecheck
  TZ=UTC npx jest --runInBand --silent
  TZ=America/Los_Angeles npx jest --runInBand --silent
  TZ=Asia/Tokyo npx jest --runInBand --silent
fi

# Verify tracked native android project exists
if [ ! -d "android" ] || [ ! -f "android/app/build.gradle" ]; then
  echo "❌ Error: Tracked android/ directory or android/app/build.gradle is missing."
  exit 1
fi

# Ensure release keystore is available in android/app when placed at repo root
if [ -z "${GUANACO_KEYSTORE_FILE:-}" ] && [ -f "guanaco-release.keystore" ] && [ ! -f "android/app/guanaco-release.keystore" ]; then
  echo "Copying guanaco-release.keystore to android/app/..."
  cp guanaco-release.keystore android/app/guanaco-release.keystore
fi

# Sync and validate version and versionCode from app.json to android/app/build.gradle
node -e '
const fs = require("fs");
const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"));
const version = appJson?.expo?.version;
const versionCode = appJson?.expo?.android?.versionCode;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("❌ Invalid expo.version in app.json:", version);
  process.exit(1);
}
if (!Number.isInteger(versionCode) || versionCode < 1) {
  console.error("❌ Invalid expo.android.versionCode in app.json:", versionCode);
  process.exit(1);
}

const gradlePath = "android/app/build.gradle";
const original = fs.readFileSync(gradlePath, "utf8");
if (!/versionCode \d+/.test(original) || !/versionName "[^"]+"/.test(original)) {
  console.error("❌ Could not find versionCode/versionName in android/app/build.gradle");
  process.exit(1);
}

const updated = original
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]+"/, `versionName "${version}"`);

if (updated !== original) {
  fs.writeFileSync(gradlePath, updated);
  console.log(`Synced build.gradle to version ${version} (${versionCode})`);
} else {
  console.log(`Verified build.gradle matches version ${version} (${versionCode})`);
}
'

echo "Building release bundle (.aab)..."
(
  cd android
  ./gradlew bundleRelease
)

cp android/app/build/outputs/bundle/release/app-release.aab guanaco-release.aab

GIT_REV=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || git describe --tags --always 2>/dev/null || echo "untagged")
GIT_DIRTY=$(git status --porcelain 2>/dev/null || true)

echo ""
echo "=== Build Complete! ==="
echo "Artifact:       guanaco-release.aab"
echo "Git Checkpoint: ${GIT_REV} (${GIT_TAG})"
if [ -n "$GIT_DIRTY" ]; then
  echo "⚠️  Note: Working tree has uncommitted changes. Make sure to commit and tag your release!"
fi
