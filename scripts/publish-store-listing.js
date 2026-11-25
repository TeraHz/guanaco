#!/usr/bin/env node
/**
 * Syncs Google Play Store listing text, feature graphic, phone screenshots,
 * and 7-inch / 10-inch tablet screenshots via the Google Play Developer API.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { androidpublisher } = require('@googleapis/androidpublisher');
const { GoogleAuth } = require('google-auth-library');

const ROOT_DIR = path.resolve(__dirname, '..');
const CONFIG_SERVICE_ACCOUNT_PATH = path.join(
  os.homedir(),
  '.config',
  'guanaco',
  'play-service-account.json'
);
const REPO_SERVICE_ACCOUNT_PATH = path.join(ROOT_DIR, 'play-service-account.json');
const SERVICE_ACCOUNT_PATH = process.env.PLAY_SERVICE_ACCOUNT_PATH
  ? path.resolve(process.cwd(), process.env.PLAY_SERVICE_ACCOUNT_PATH)
  : fs.existsSync(CONFIG_SERVICE_ACCOUNT_PATH)
    ? CONFIG_SERVICE_ACCOUNT_PATH
    : REPO_SERVICE_ACCOUNT_PATH;
const APP_JSON_PATH = path.join(ROOT_DIR, 'app.json');
const LISTING_COPY_PATH = path.join(ROOT_DIR, 'assets', 'store_listing', 'listing_copy.md');
const LOCALIZED_LISTINGS = [
  { language: 'bg', filePath: path.join(ROOT_DIR, 'assets', 'store_listing', 'listing_copy.bg.md') },
  {
    language: 'es-ES',
    filePath: path.join(ROOT_DIR, 'assets', 'store_listing', 'listing_copy.es-ES.md'),
  },
];
const SCREENSHOTS_DIR = path.join(ROOT_DIR, 'docs', 'assets', 'screenshots');
const FEATURE_GRAPHIC_PATH = path.join(
  ROOT_DIR,
  'assets',
  'store_listing',
  'feature_graphic_1024x500.png'
);

const PHONE_SCREENSHOTS = [
  '01-tasks-dark.png',
  '02-tasks-light.png',
  '03-task-detail-subtasks.png',
  '04-global-search-oled.png',
  '05-lists-drawer.png',
];

const TABLET_SCREENSHOTS = [
  '06-tablet-split-view.png',
  '07-tablet-groceries-light.png',
];

function parseListingCopy(markdown) {
  const blocks = [...markdown.matchAll(/```(?:markdown)?\n([\s\S]*?)```/g)].map((m) =>
    m[1].trim()
  );
  if (blocks.length < 3) {
    throw new Error(`Expected 3 fenced blocks in ${LISTING_COPY_PATH}, found ${blocks.length}`);
  }
  const [title, shortDescription, fullDescription] = blocks;
  if (title.length > 30) {
    throw new Error(`Title exceeds 30 chars (${title.length}): "${title}"`);
  }
  if (shortDescription.length > 80) {
    throw new Error(
      `Short description exceeds 80 chars (${shortDescription.length}): "${shortDescription}"`
    );
  }
  if (fullDescription.length > 4000) {
    throw new Error(`Full description exceeds 4000 chars (${fullDescription.length})`);
  }
  return { title, shortDescription, fullDescription };
}

async function replaceImages(publisher, { packageName, editId, language, imageType, filePaths }) {
  console.log(`\n🖼️  Updating ${imageType} (${filePaths.length} file(s))...`);
  await publisher.edits.images.deleteall({
    packageName,
    editId,
    language,
    imageType,
  });

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing image file: ${filePath}`);
    }
    const res = await publisher.edits.images.upload({
      packageName,
      editId,
      language,
      imageType,
      media: {
        mimeType: 'image/png',
        body: fs.createReadStream(filePath),
      },
    });
    console.log(
      `   ✓ Uploaded ${path.basename(filePath)} (sha256: ${String(res.data.image?.sha256 || '').slice(0, 12)}...)`
    );
  }
}

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`❌ Service account file not found at ${SERVICE_ACCOUNT_PATH}`);
    process.exit(1);
  }

  const appConfig = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));
  const packageName = appConfig.expo?.android?.package || 'com.geodar.guanaco';
  const language = 'en-US';
  const copy = parseListingCopy(fs.readFileSync(LISTING_COPY_PATH, 'utf8'));

  console.log(`=== Guanaco Play Store Listing Sync (${packageName}) ===`);
  console.log(`• Title (${copy.title.length}/30): ${copy.title}`);
  console.log(`• Short (${copy.shortDescription.length}/80): ${copy.shortDescription}`);
  console.log(`• Full  (${copy.fullDescription.length}/4000 chars)`);

  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const publisher = androidpublisher({ version: 'v3', auth });

  const { data: edit } = await publisher.edits.insert({ packageName });
  const editId = edit.id;
  console.log(`\n📝 Opened Play edit session: ${editId}`);

  // 1. Update en-US store listing text + localized text translations (bg, es-ES)
  await publisher.edits.listings.update({
    packageName,
    editId,
    language,
    requestBody: {
      language,
      title: copy.title,
      shortDescription: copy.shortDescription,
      fullDescription: copy.fullDescription,
    },
  });
  console.log('   ✓ Updated en-US title, shortDescription, and fullDescription');

  for (const loc of LOCALIZED_LISTINGS) {
    if (fs.existsSync(loc.filePath)) {
      const locCopy = parseListingCopy(fs.readFileSync(loc.filePath, 'utf8'));
      await publisher.edits.listings.update({
        packageName,
        editId,
        language: loc.language,
        requestBody: {
          language: loc.language,
          title: locCopy.title,
          shortDescription: locCopy.shortDescription,
          fullDescription: locCopy.fullDescription,
        },
      });
      console.log(
        `   ✓ Updated ${loc.language} title ("${locCopy.title}") and descriptions`
      );
    }
  }

  // 2. Replace Feature Graphic (1024x500)
  await replaceImages(publisher, {
    packageName,
    editId,
    language,
    imageType: 'featureGraphic',
    filePaths: [FEATURE_GRAPHIC_PATH],
  });

  // 3. Replace Phone Screenshots (5x 1215x2160)
  await replaceImages(publisher, {
    packageName,
    editId,
    language,
    imageType: 'phoneScreenshots',
    filePaths: PHONE_SCREENSHOTS.map((f) => path.join(SCREENSHOTS_DIR, f)),
  });

  // 4. Replace 7-inch & 10-inch Tablet Screenshots (2x 2240x1260)
  const tabletPaths = TABLET_SCREENSHOTS.map((f) => path.join(SCREENSHOTS_DIR, f));
  await replaceImages(publisher, {
    packageName,
    editId,
    language,
    imageType: 'sevenInchScreenshots',
    filePaths: tabletPaths,
  });
  await replaceImages(publisher, {
    packageName,
    editId,
    language,
    imageType: 'tenInchScreenshots',
    filePaths: tabletPaths,
  });

  // 5. Commit edit
  console.log('\n✅ Committing store listing update to Google Play...');
  try {
    await publisher.edits.commit({ packageName, editId });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || '';
    if (msg.includes('changesNotSentForReview')) {
      console.log('   Retrying commit with changesNotSentForReview=true...');
      await publisher.edits.commit({
        packageName,
        editId,
        changesNotSentForReview: true,
      });
    } else {
      throw err;
    }
  }

  // 6. Verify live state
  const { data: verifyEdit } = await publisher.edits.insert({ packageName });
  const counts = {};
  for (const imageType of [
    'featureGraphic',
    'phoneScreenshots',
    'sevenInchScreenshots',
    'tenInchScreenshots',
  ]) {
    const { data } = await publisher.edits.images.list({
      packageName,
      editId: verifyEdit.id,
      language,
      imageType,
    });
    counts[imageType] = (data.images || []).length;
  }
  const { data: liveListing } = await publisher.edits.listings.get({
    packageName,
    editId: verifyEdit.id,
    language,
  });
  await publisher.edits.delete({ packageName, editId: verifyEdit.id });

  console.log('\n🎉 Verified live Google Play Store listing:');
  console.log(`   Title: "${liveListing.title}"`);
  console.log(`   Images:`, JSON.stringify(counts));
}

main().catch((err) => {
  console.error('\n❌ Play Store Listing Sync Error:');
  if (err.response?.data?.error) {
    console.error(JSON.stringify(err.response.data.error, null, 2));
    if (err.response?.status === 403) {
      console.error(
        '\n💡 Hint: In Google Play Console → Users and permissions → click your service account → App permissions / Account permissions → enable "Manage store presence" and click Save changes.'
      );
    }
  } else {
    console.error(err.message || err);
  }
  process.exit(1);
});
