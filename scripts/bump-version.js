#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const type = process.argv[2] || 'patch';

const packagePath = path.resolve(__dirname, '../package.json');
const appJsonPath = path.resolve(__dirname, '../app.json');
const versionTsPath = path.resolve(__dirname, '../src/constants/version.ts');
const gradlePath = path.resolve(__dirname, '../android/app/build.gradle');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = pkg.version;
const parts = currentVersion.split('.').map(Number);

let nextVersion;
if (type.includes('.')) {
  nextVersion = type;
} else {
  let [major, minor, patch] = parts;
  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  nextVersion = `${major}.${minor}.${patch}`;
}

// Read app.json for current versionCode
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const nextVersionCode = (appJson.expo?.android?.versionCode || 1) + 1;

// 1. Update package.json
pkg.version = nextVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Update app.json
appJson.expo.version = nextVersion;
if (!appJson.expo.android) appJson.expo.android = {};
appJson.expo.android.versionCode = nextVersionCode;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');

// 3. Update src/constants/version.ts
const versionTs = `export const APP_VERSION = '${nextVersion}';\nexport const APP_BUILD_NUMBER = ${nextVersionCode};\nexport const APP_NAME = 'Guanaco';\n`;
fs.writeFileSync(versionTsPath, versionTs);

// 4. Update android/app/build.gradle if exists
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode \d+/, `versionCode ${nextVersionCode}`);
  gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${nextVersion}"`);
  fs.writeFileSync(gradlePath, gradle);
}

console.log(`✅ Bumped version from ${currentVersion} to ${nextVersion} (Build ${nextVersionCode})`);
