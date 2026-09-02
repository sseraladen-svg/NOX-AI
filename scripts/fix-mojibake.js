#!/usr/bin/env node
/**
 * Fix mojibake comments (€"€"€ pattern) caused by file corruption
 * Run: npm run fix-mojibake or node scripts/fix-mojibake.js
 */

const fs = require('fs');
const path = require('path');

const MOJIBAKE_PATTERN = /"€"€"€[^\n]*/g;
const REPLACEMENT = '// ---';
const SOURCE_DIR = path.join(__dirname, '..', 'src');

let fixCount = 0;

function scanDirectory(dir) {
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });

    files.forEach((file) => {
      const fullPath = path.join(dir, file.name);

      if (file.isDirectory()) {
        scanDirectory(fullPath);
      } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');

          if (MOJIBAKE_PATTERN.test(content)) {
            console.log(`⚠️  Found mojibake in: ${file.name}`);

            const cleaned = content.replace(MOJIBAKE_PATTERN, REPLACEMENT);
            fs.writeFileSync(fullPath, cleaned, 'utf8');

            fixCount++;
            console.log(`✅ Fixed: ${file.name}`);
          }
        } catch (err) {
          console.error(`Error processing ${fullPath}:`, err.message);
        }
      }
    });
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err.message);
  }
}

console.log(`🔍 Scanning for mojibake comments in ${SOURCE_DIR}...`);
scanDirectory(SOURCE_DIR);

if (fixCount === 0) {
  console.log('✨ No mojibake comments found. Repository is clean!');
} else {
  console.log(`\n✅ Fixed ${fixCount} file(s)`);
  console.log('💡 Tip: Run "git add ." and commit your changes');
}
