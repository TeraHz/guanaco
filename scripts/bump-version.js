#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const BUMP_TYPES = new Set(['major', 'minor', 'patch']);

const type = process.argv[2] || 'patch';

if (!BUMP_TYPES.has(type) && !SEMVER_REGEX.test(type)) {
  console.error(
    `❌ Invalid version bump argument: "${type}".\nUsage: node scripts/bump-version.js [patch|minor|major|<x.y.z>]`
  );
  process.exit(1);
}

const packagePath = path.resolve(__dirname, '../package.json');
const appJsonPath = path.resolve(__dirname, '../app.json');
const versionTsPath = path.resolve(__dirname, '../src/constants/version.ts');
const gradlePath = path.resolve(__dirname, '../android/app/build.gradle');

if (!fs.existsSync(gradlePath)) {
  console.error(`❌ Error: Tracked Android build file missing at ${gradlePath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const currentVersion = pkg.version;
const baseParts = String(currentVersion).split('-')[0].split('.').map(Number);

if (baseParts.length !== 3 || baseParts.some((n) => !Number.isInteger(n) || n < 0)) {
  console.error(`❌ Current package.json version "${currentVersion}" is not valid semver.`);
  process.exit(1);
}

let nextVersion;
if (SEMVER_REGEX.test(type)) {
  nextVersion = type;
} else {
  let [major, minor, patch] = baseParts;
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
const currentVersionCode = Number(appJson.expo?.android?.versionCode || 1);
const nextVersionCode = currentVersionCode + 1;

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

// 4. Update tracked android/app/build.gradle
const gradle = fs.readFileSync(gradlePath, 'utf8');
if (!/versionCode \d+/.test(gradle) || !/versionName "[^"]+"/.test(gradle)) {
  console.error(`❌ Failed to locate versionCode/versionName in ${gradlePath}`);
  process.exit(1);
}
const updatedGradle = gradle
  .replace(/versionCode \d+/, `versionCode ${nextVersionCode}`)
  .replace(/versionName "[^"]+"/, `versionName "${nextVersion}"`);
fs.writeFileSync(gradlePath, updatedGradle);

console.log(`✅ Bumped version from ${currentVersion} to ${nextVersion} (Build ${nextVersionCode})`);
