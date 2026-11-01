const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const templatePath = path.join(rootDir, 'index.template.html');
const targetPath = path.join(rootDir, 'index.html');

if (fs.existsSync(templatePath)) {
  fs.copyFileSync(templatePath, targetPath);
  console.log('Restored source index.html from index.template.html for Vite compilation');
}

