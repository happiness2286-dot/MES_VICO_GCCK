const fs = require('fs');
const path = require('path');

const distClient = path.resolve(__dirname, '..', 'dist', 'client');
const rootDir = path.resolve(__dirname, '..');

// 1. Copy assets
const distAssets = path.join(distClient, 'assets');
const rootAssets = path.join(rootDir, 'assets');
if (fs.existsSync(distAssets)) {
  fs.mkdirSync(rootAssets, { recursive: true });
  for (const file of fs.readdirSync(distAssets)) {
    fs.copyFileSync(path.join(distAssets, file), path.join(rootAssets, file));
  }
  console.log('Copied assets to root/assets');
}

// 2. Read dist/client/index.html
const distIndex = path.join(distClient, 'index.html');
if (fs.existsSync(distIndex)) {
  let content = fs.readFileSync(distIndex, 'utf8');
  // Ensure relative ./assets paths
  content = content.replace(/href="\/assets\//g, 'href="./assets/');
  content = content.replace(/src="\/assets\//g, 'src="./assets/');

  // Also include 404 redirect handler if not present
  if (!content.includes('URLSearchParams(window.location.search)')) {
    const redirectScript = `  <script>
    (function () {
      var params = new URLSearchParams(window.location.search);
      var redirect = params.get('p');
      if (redirect) {
        params.delete('p');
        var search = params.toString() ? ('?' + params.toString()) : '';
        var base = window.location.pathname.replace(/\\/$/, '');
        var normSub = redirect.startsWith('/') ? redirect : '/' + redirect;
        window.location.replace(base + '/#' + normSub + search + window.location.hash);
      }
    })();
  </script>\n</head>`;
    content = content.replace('</head>', redirectScript);
  }

  // Write to root index.html
  fs.writeFileSync(path.join(rootDir, 'index.html'), content, 'utf8');

  // Dedicated lightweight 404.html that converts non-hash sub-paths to hash routes on GitHub Pages
  const notFoundHtml = `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GCCK Thắng Lợi Lean MES</title>
    <script>
      (function() {
        var l = window.location;
        var pathname = l.pathname;
        var base = '';
        if (l.hostname.includes('github.io')) {
          var segs = pathname.split('/').filter(Boolean);
          if (segs.length > 0) {
            base = '/' + segs[0];
          }
        }
        var sub = pathname;
        if (base && sub.startsWith(base)) {
          sub = sub.slice(base.length);
        }
        if (!sub || sub === '/') {
          sub = '/';
        } else if (!sub.startsWith('/')) {
          sub = '/' + sub;
        }
        var target = (base || '') + '/#' + sub + l.search + l.hash;
        window.location.replace(target);
      })();
    </script>
  </head>
  <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #F8FAFC; color: #334155;">
    <p style="font-weight: 600; font-size: 14px;">Đang chuyển hướng về cổng điều hành MES Thắng Lợi...</p>
  </body>
</html>`;

  fs.writeFileSync(path.join(rootDir, '404.html'), notFoundHtml, 'utf8');
  console.log('Updated root index.html and dedicated 404.html for GitHub Pages');
}

