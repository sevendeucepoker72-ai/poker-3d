import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire('C:/Users/josh2/Downloads/developer setup/poker-mono-repo/package.json');
const { chromium } = require('playwright');

const htmlPath = 'C:/Users/josh2/AppData/Local/Temp/claude/C--Users-josh2-Downloads-developer-setup/dc63bf2b-0880-4240-939d-b34d6a7d57fd/scratchpad/bake-rail.html';
const outPath = 'C:/Users/josh2/Downloads/developer setup/poker-3d/public/table-rail.png';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 681 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(htmlPath).href);
await page.waitForTimeout(400);
const svg = await page.$('svg');
await svg.screenshot({ path: outPath, omitBackground: true });
await browser.close();
console.log('baked ->', outPath);
