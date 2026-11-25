#!/usr/bin/env node

/**
 * Publish Android App Bundle (.aab) directly to Google Play Console via the Google Play Developer API.
 *
 * Usage:
 *   node scripts/publish-play-store.js [--track internal|alpha|beta|production] [--aab path/to/bundle.aab] [--notes "Release notes"]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { androidpublisher } = require('@googleapis/androidpublisher');
const { GoogleAuth } = require('google-auth-library');

const CONFIG_SERVICE_ACCOUNT_PATH = path.join(
  os.homedir(),
  '.config',
  'guanaco',
  'play-service-account.json'
);
const REPO_SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../play-service-account.json');
const SERVICE_ACCOUNT_PATH = process.env.PLAY_SERVICE_ACCOUNT_PATH
  ? path.resolve(process.cwd(), process.env.PLAY_SERVICE_ACCOUNT_PATH)
  : fs.existsSync(CONFIG_SERVICE_ACCOUNT_PATH)
    ? CONFIG_SERVICE_ACCOUNT_PATH
    : REPO_SERVICE_ACCOUNT_PATH;
const APP_JSON_PATH = path.resolve(__dirname, '../app.json');
const ROOT_AAB_PATH = path.resolve(__dirname, '../guanaco-release.aab');
const DEFAULT_AAB_PATH = fs.existsSync(ROOT_AAB_PATH)
  ? ROOT_AAB_PATH
  : path.resolve(__dirname, '../android/app/build/outputs/bundle/release/app-release.aab');

const VALID_TRACKS = new Set(['internal', 'alpha', 'beta', 'production']);

// Parse CLI args strictly
const args = process.argv.slice(2);
let track = 'internal';
let aabPath = DEFAULT_AAB_PATH;
let releaseNotes = null;
let releaseNotesBg = null;
let releaseNotesEs = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--track') {
    const val = args[++i];
    if (!val || val.startsWith('--') || !VALID_TRACKS.has(val)) {
      console.error(`❌ Invalid --track value "${val || ''}". Expected one of: internal, alpha, beta, production`);
      process.exit(1);
    }
    track = val;
  } else if (arg === '--aab') {
    const val = args[++i];
    if (!val || val.startsWith('--')) {
      console.error('❌ Missing file path after --aab');
      process.exit(1);
    }
    aabPath = path.resolve(process.cwd(), val);
  } else if (arg === '--notes') {
    const val = args[++i];
    if (val === undefined) {
      console.error('❌ Missing text after --notes');
      process.exit(1);
    }
    releaseNotes = val;
  } else if (arg === '--notes-bg') {
    const val = args[++i];
    if (val === undefined) {
      console.error('❌ Missing text after --notes-bg');
      process.exit(1);
    }
    releaseNotesBg = val;
  } else if (arg === '--notes-es') {
    const val = args[++i];
    if (val === undefined) {
      console.error('❌ Missing text after --notes-es');
      process.exit(1);
    }
    releaseNotesEs = val;
  } else {
    console.error(`❌ Unknown option: ${arg}`);
    process.exit(1);
  }
}

async function verifyCleanGitAndGreenCi() {
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Running inside GitHub Actions release workflow after the verify-matrix gate has passed
    return;
  }

  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) {
    console.error('\n❌ Refusing to publish release from a dirty git working tree.');
    console.error('Commit and push your changes first so GitHub CI verifies the exact release commit.\n');
    process.exit(1);
  }

  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  console.log(`🔍 Verifying GitHub Actions CI status for commit ${headSha.slice(0, 7)}...`);

  const resp = await fetch(
    `https://api.github.com/repos/TeraHz/guanaco/commits/${headSha}/check-runs`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'guanaco-release-gate',
      },
    }
  );

  if (!resp.ok) {
    console.error(`\n❌ Could not verify GitHub CI status for ${headSha} (HTTP ${resp.status}).`);
    console.error('Push HEAD to GitHub and wait for CI to pass before publishing a release.\n');
    process.exit(1);
  }

  const data = await resp.json();
  const ciChecks = (data.check_runs || []).filter((c) =>
    String(c.name || '').startsWith('Typecheck & Test')
  );

  if (ciChecks.length < 3) {
    console.error(
      `\n❌ Expected 3 timezone CI checks on ${headSha.slice(0, 7)}, found ${ciChecks.length}.`
    );
    console.error('Push to GitHub and wait for all CI jobs to finish before publishing.\n');
    process.exit(1);
  }

  const incomplete = ciChecks.filter((c) => c.status !== 'completed' || c.conclusion !== 'success');
  if (incomplete.length > 0) {
    console.error('\n❌ Refusing to publish release — GitHub CI is not green:');
    for (const c of incomplete) {
      console.error(`   - ${c.name}: status=${c.status}, conclusion=${c.conclusion}`);
    }
    console.error('');
    process.exit(1);
  }

  console.log(`✅ All ${ciChecks.length} GitHub CI checks passed for ${headSha.slice(0, 7)}.`);
}

async function main() {
  console.log('=== Guanaco Google Play Publisher ===');

  await verifyCleanGitAndGreenCi();

  // 1. Verify service account key
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('\n❌ Error: Google Play Service Account key not found at:');
    console.error(`   ${SERVICE_ACCOUNT_PATH}\n`);
    console.error('To set up API access:');
    console.error('1. Go to Google Play Console -> Settings -> API access');
    console.error('2. Create/link a Service Account and download the JSON private key');
    console.error('3. Save it to your project root as "play-service-account.json" (or set PLAY_SERVICE_ACCOUNT_PATH)');
    console.error('4. Grant the Service Account "Release manager" permissions for Guanaco\n');
    process.exit(1);
  }

  // 2. Verify AAB file
  if (!fs.existsSync(aabPath)) {
    console.error('\n❌ Error: App Bundle (.aab) not found at:');
    console.error(`   ${aabPath}\n`);
    console.error('Run "npm run build:bundle" first to generate the local .aab file.\n');
    process.exit(1);
  }

  // 3. Read package name and version from app.json
  const appConfig = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
  const packageName = appConfig.expo?.android?.package || 'com.geodar.guanaco';
  const versionCode = Number(appConfig.expo?.android?.versionCode || 1);
  const versionName = appConfig.expo?.version || '1.0.0';

  console.log(`📦 App: ${packageName}`);
  console.log(`🏷️  Release: v${versionName} (versionCode: ${versionCode})`);
  console.log(`🎯 Track: ${track}`);
  console.log(`📁 Bundle: ${aabPath} (${(fs.statSync(aabPath).size / (1024 * 1024)).toFixed(2)} MB)`);

  // 4. Authenticate with Google Play API
  console.log('\n🔑 Authenticating with Google Play API...');
  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const publisher = androidpublisher({ version: 'v3', auth });

  try {
    // 5. Create an edit transaction
    console.log('📝 Creating Google Play edit session...');
    const editRes = await publisher.edits.insert({
      packageName,
    });
    const editId = editRes.data.id;
    console.log(`   Edit ID: ${editId}`);

    // 6. Check existing bundles or upload the AAB bundle
    const bundlesRes = await publisher.edits.bundles.list({ editId, packageName });
    const existingCodes = (bundlesRes.data.bundles || []).map((b) => Number(b.versionCode));
    if (existingCodes.includes(versionCode)) {
      console.log(`📦 Bundle version code ${versionCode} is already uploaded in Google Play. Reusing existing bundle.`);
    } else {
      console.log('🚀 Uploading App Bundle (.aab) to Google Play...');
      const uploadRes = await publisher.edits.bundles.upload({
        editId,
        packageName,
        media: {
          mimeType: 'application/octet-stream',
          body: fs.createReadStream(aabPath),
        },
      });
      console.log(`   Uploaded bundle version code: ${uploadRes.data.versionCode}`);
    }

    // Upload deobfuscation mapping file if available
    const mappingPath = path.resolve(__dirname, '../android/app/build/outputs/mapping/release/mapping.txt');
    if (fs.existsSync(mappingPath)) {
      console.log('📄 Uploading ProGuard/R8 deobfuscation mapping.txt...');
      try {
        await publisher.edits.deobfuscationfiles.upload({
          editId,
          packageName,
          apkVersionCode: versionCode,
          deobfuscationFileType: 'proguard',
          media: {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(mappingPath),
          },
        });
        console.log('   Deobfuscation file uploaded successfully.');
      } catch (deobfErr) {
        console.warn(`   ⚠️ Warning: Could not upload deobfuscation file: ${deobfErr.message}`);
      }
    }

    // 7. Assign to target track
    console.log(`🚚 Assigning release to "${track}" track...`);
    let releaseStatus = 'completed';
    const assignRelease = (status) => {
      const releaseObj = {
        name: `v${versionName}`,
        versionCodes: [versionCode.toString()],
        status,
      };
      const localizedNotes = [];
      if (releaseNotes) {
        localizedNotes.push({ language: 'en-US', text: releaseNotes });
      }
      if (releaseNotesBg) {
        localizedNotes.push({ language: 'bg', text: releaseNotesBg });
      }
      if (releaseNotesEs) {
        localizedNotes.push({ language: 'es-ES', text: releaseNotesEs });
      }
      if (localizedNotes.length > 0) {
        releaseObj.releaseNotes = localizedNotes;
      }
      return publisher.edits.tracks.update({
        editId,
        packageName,
        track,
        requestBody: {
          releases: [releaseObj],
        },
      });
    };

    try {
      await assignRelease(releaseStatus);
      console.log(`   Assigned as "${releaseStatus}".`);
    } catch (trackErr) {
      if (trackErr.message?.includes('draft') || trackErr.response?.data?.error?.message?.includes('draft')) {
        console.log('   App is in draft state; assigning release as "draft" status...');
        releaseStatus = 'draft';
        await assignRelease(releaseStatus);
      } else {
        throw trackErr;
      }
    }

    // 8. Commit the edit
    console.log('✅ Committing release to Google Play...');
    try {
      await publisher.edits.commit({
        editId,
        packageName,
      });
    } catch (commitErr) {
      if (
        commitErr.message?.includes('status draft may be created on draft app') ||
        commitErr.response?.data?.error?.message?.includes('status draft may be created on draft app')
      ) {
        console.log('   App requires draft status. Re-assigning as "draft" and committing...');
        await assignRelease('draft');
        await publisher.edits.commit({
          editId,
          packageName,
        });
      } else {
        throw commitErr;
      }
    }

    console.log('\n🎉 Successfully published to Google Play!');
    console.log(`👉 Check release: https://play.google.com/console/developers/app/${packageName}/tracks/${track}\n`);
  } catch (err) {
    console.error('\n❌ Google Play API Error:');
    if (err.response?.data?.error) {
      console.error(JSON.stringify(err.response.data.error, null, 2));
    } else {
      console.error(err.message || err);
    }
    process.exit(1);
  }
}

main();
