import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');
const manifestPath = path.join(distDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('manifest.json not found in dist/');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

/**
 * CRXJS generates a loader script for content scripts that dynamically
 * imports the real ES module via chrome.runtime.getURL(). This is the
 * correct approach because Manifest V3 content_scripts run as classic
 * scripts (not ES modules), so a direct ES module file with `import`
 * statements would throw a SyntaxError.
 *
 * The loader pattern:
 *   1. manifest.json points to "assets/index.iife.tsx-loader-XXXX.js"
 *   2. The loader runs: import(chrome.runtime.getURL("assets/index.iife.tsx-XXXX.js"))
 *   3. The real script loads as an ES module via dynamic import()
 *
 * Previous postbuild.js BROKE this by replacing the loader reference
 * with the real ES module file, causing SyntaxError on load.
 *
 * This version ensures the loader is correctly referenced in manifest.json.
 */
if (manifest.content_scripts) {
  manifest.content_scripts.forEach((script) => {
    if (script.js) {
      script.js = script.js.map((jsFile) => {
        // If manifest already points to a loader, keep it
        if (jsFile.includes('-loader')) {
          console.log(`✅ Content script uses loader: ${jsFile}`);
          return jsFile;
        }

        // If manifest points to the real ES module (not the loader),
        // find the corresponding loader and use that instead
        const assetsDir = path.join(distDir, 'assets');
        if (fs.existsSync(assetsDir)) {
          const files = fs.readdirSync(assetsDir);
          
          // Extract the base name (e.g., "index.iife.tsx") from the current reference
          const baseName = path.basename(jsFile).replace(/-[A-Za-z0-9]+\.js$/, '');
          
          // Find the matching loader file
          const loaderFile = files.find(f => 
            f.includes(baseName) && f.includes('-loader')
          );

          if (loaderFile) {
            const loaderPath = `assets/${loaderFile}`;
            console.log(`🔧 Fixing: ${jsFile} → ${loaderPath} (loader required for ES modules)`);
            return loaderPath;
          }
        }

        console.log(`⚠️ No loader found for ${jsFile} — keeping as-is`);
        return jsFile;
      });
    }
  });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✅ Successfully verified/patched manifest.json content script references.');
}
