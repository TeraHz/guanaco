#!/usr/bin/env bash
set -e

echo "=== Building Guanaco Android App Bundle (.aab) Locally ==="

# Check Android SDK
if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo "Warning: ANDROID_HOME ($ANDROID_HOME) is not found or not set."
  echo "To build locally on macOS, install Android Studio or Command Line Tools:"
  echo "  brew install --cask android-commandlinetools"
  exit 1
fi

echo "1. Generating Android native project via Expo Prebuild..."
npx expo prebuild --platform android --clean

echo "2. Building release bundle (.aab)..."
cd android
./gradlew bundleRelease

echo "=== Build Complete! ==="
echo "Artifact: android/app/build/outputs/bundle/release/app-release.aab"
