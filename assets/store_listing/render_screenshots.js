const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const baseHtml = fs.readFileSync(path.join(__dirname, 'screenshots_generator.html'), 'utf-8');

// Extract styles and head
const headEnd = baseHtml.indexOf('</head>');
const headContent = baseHtml.substring(0, headEnd);

const screens = [
  { id: 'screen-1', name: 'phone_screenshot_1.png' },
  { id: 'screen-2', name: 'phone_screenshot_2.png' },
  { id: 'screen-3', name: 'phone_screenshot_3.png' },
  { id: 'screen-4', name: 'phone_screenshot_4.png' },
  { id: 'screen-5', name: 'phone_screenshot_5.png' },
];

for (const screen of screens) {
  const startTag = `<div id="${screen.id}"`;
  const startIdx = baseHtml.indexOf(startTag);
  const endIdx = baseHtml.indexOf('<!-- SCREEN ', startIdx + 1);
  const screenContent = endIdx !== -1 
    ? baseHtml.substring(startIdx, endIdx) 
    : baseHtml.substring(startIdx, baseHtml.indexOf('</body>'));

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
${headContent}
<style>
  body {
    margin: 0;
    padding: 0;
    width: 1080px;
    height: 2400px;
    overflow: hidden;
  }
</style>
</head>
<body>
${screenContent}
</body>
</html>`;

  const htmlPath = path.join(__dirname, `screen_${screen.id}.html`);
  fs.writeFileSync(htmlPath, fullHtml);

  const outputPath = path.join(__dirname, screen.name);
  console.log(`Rendering ${screen.name} via Chrome headless...`);
  
  execSync(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
    --headless=new \\
    --hide-scrollbars \\
    --window-size=1080,2400 \\
    --force-device-scale-factor=1 \\
    --screenshot="${outputPath}" \\
    "file://${htmlPath}"`, { stdio: 'inherit' });

  // Ensure RGB 24-bit PNG without transparency
  execSync(`magick "${outputPath}" -alpha off "${outputPath}"`);
  console.log(`Optimized ${screen.name}`);
}

console.log('All 5 screenshots generated successfully!');
