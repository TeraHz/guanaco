const { withDangerousMod, withAppBuildGradle, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withInAppUpdate = (config) => {
  // 1. Add dependency to android/app/build.gradle
  config = withAppBuildGradle(config, (modConfig) => {
    if (!modConfig.modResults.contents.includes('app-update-ktx')) {
      modConfig.modResults.contents = modConfig.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.google.android.play:app-update-ktx:2.1.0")'
      );
    }
    return modConfig;
  });

  // 2. Add InAppUpdatePackage to MainApplication.kt
  config = withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('InAppUpdatePackage')) {
      contents = 'import com.geodar.guanaco.update.InAppUpdatePackage\n' + contents;
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n          add(InAppUpdatePackage())'
      );
      modConfig.modResults.contents = contents;
    }
    return modConfig;
  });

  // 3. Ensure Kotlin source files are copied into android/app/src/main/java/com/geodar/guanaco/update/
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const targetDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/java/com/geodar/guanaco/update'
      );
      fs.mkdirSync(targetDir, { recursive: true });
      const sourceDir = path.join(modConfig.modRequest.projectRoot, 'src/native/android/update');
      if (fs.existsSync(sourceDir)) {
        for (const file of fs.readdirSync(sourceDir)) {
          fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
        }
      }
      return modConfig;
    },
  ]);

  return config;
};

module.exports = withInAppUpdate;
