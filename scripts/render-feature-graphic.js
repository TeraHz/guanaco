const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const iconPath = path.resolve(__dirname, '../assets/icon.png');
const iconBase64 = fs.readFileSync(iconPath).toString('base64');
const iconDataUri = `data:image/png;base64,${iconBase64}`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Guanaco Feature Graphic</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 1024px;
      height: 500px;
      overflow: hidden;
      background-color: #120d20;
      background: radial-gradient(circle at 50% 40%, #1e1338 0%, #110b1f 70%, #0d0818 100%);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      -webkit-font-smoothing: antialiased;
    }

    .icon-container {
      margin-bottom: 24px;
    }

    .app-icon {
      width: 120px;
      height: 120px;
      border-radius: 26px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: block;
    }

    .app-title {
      font-size: 46px;
      font-weight: 600;
      color: #F8FAFC;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }

    .app-subtitle {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      font-size: 19px;
      font-weight: 400;
      color: #94A3B8;
      letter-spacing: 0.1px;
    }
  </style>
</head>
<body>
  <div class="icon-container">
    <img src="${iconDataUri}" class="app-icon" alt="Guanaco Icon" />
  </div>
  <div class="app-title">Guanaco</div>
  <div class="app-subtitle">A mobile client for Vikunja</div>
</body>
</html>`;

const htmlPath = path.resolve(__dirname, '../assets/store_listing/feature_graphic.html');
fs.writeFileSync(htmlPath, html);

const outputPath = path.resolve(__dirname, '../assets/store_listing/feature_graphic_1024x500.png');

console.log('Rendering 1024x500 feature graphic via Chrome headless...');
execSync(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
  --headless=new \\
  --hide-scrollbars \\
  --window-size=1024,500 \\
  --force-device-scale-factor=1 \\
  --screenshot="${outputPath}" \\
  "file://${htmlPath}"`, { stdio: 'inherit' });

// Ensure strict 1024x500, 24-bit RGB (no alpha channel) as required by Google Play
execSync(`magick "${outputPath}" -crop 1024x500+0+0 +repage -alpha off "${outputPath}"`);
console.log('Optimized feature graphic: 1024x500 without alpha channel.');
