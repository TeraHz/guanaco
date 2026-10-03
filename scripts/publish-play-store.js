#!/usr/bin/env node

/**
 * Publish Android App Bundle (.aab) directly to Google Play Console via the Google Play Developer API.
 * 
 * Usage:
 *   node scripts/publish-play-store.js [--track internal|alpha|beta|production] [--aab path/to/bundle.aab]
 */

const fs = require('fs');
const path = require('path');
const { androidpublisher } = require('@googleapis/androidpublisher');
const { GoogleAuth } = require('google-auth-library');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../play-service-account.json');
const APP_JSON_PATH = path.resolve(__dirname, '../app.json');
const ROOT_AAB_PATH = path.resolve(__dirname, '../guanaco-release.aab');
const DEFAULT_AAB_PATH = fs.existsSync(ROOT_AAB_PATH)
  ? ROOT_AAB_PATH
  : path.resolve(__dirname, '../android/app/build/outputs/bundle/release/app-release.aab');

// Parse CLI args
const args = process.argv.slice(2);
let track = 'internal';
let aabPath = DEFAULT_AAB_PATH;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--track' && args[i + 1]) {
    track = args[++i];
  } else if (args[i] === '--aab' && args[i + 1]) {
    aabPath = path.resolve(process.cwd(), args[++i]);
  }
}

async function main() {
  console.log('=== Guanaco Google Play Publisher ===');

  // 1. Verify service account key
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`\n❌ Error: Google Play Service Account key not found at:`);
    console.error(`   ${SERVICE_ACCOUNT_PATH}\n`);
    console.error('To set up API access:');
    console.error('1. Go to Google Play Console -> Settings -> API access');
    console.error('2. Create/link a Service Account and download the JSON private key');
    console.error('3. Save it to your project root as "play-service-account.json"');
    console.error('4. Grant the Service Account "Release manager" permissions for Guanaco\n');
    process.exit(1);
  }

  // 2. Verify AAB file
  if (!fs.existsSync(aabPath)) {
    console.error(`\n❌ Error: App Bundle (.aab) not found at:`);
    console.error(`   ${aabPath}\n`);
    console.error('Run "npm run build:bundle" first to generate the local .aab file.\n');
    process.exit(1);
  }

  // 3. Read package name and version from app.json
  const appConfig = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
  const packageName = appConfig.expo?.android?.package || 'com.geodar.guanaco';
  const versionCode = appConfig.expo?.android?.versionCode || 1;
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

    // 6. Upload the AAB bundle
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

    // Upload deobfuscation mapping file if available
    const mappingPath = path.resolve(__dirname, '../android/app/build/outputs/mapping/release/mapping.txt');
    if (fs.existsSync(mappingPath)) {
      console.log('📄 Uploading ProGuard/R8 deobfuscation mapping.txt...');
      try {
        await publisher.edits.deobfuscationfiles.upload({
          editId,
          packageName,
          versionCode,
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
    await publisher.edits.tracks.update({
      editId,
      packageName,
      track,
      requestBody: {
        releases: [
          {
            name: `v${versionName} (${versionCode})`,
            versionCodes: [versionCode.toString()],
            status: 'completed',
          },
        ],
      },
    });

    // 8. Commit the edit
    console.log('✅ Committing release to Google Play...');
    await publisher.edits.commit({
      editId,
      packageName,
    });

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
