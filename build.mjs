// Construit app.js (application hors ligne) et, en option, une page autonome pour l'aperçu en ligne.
// Usage : node build.mjs [chemin/de/la/page-autonome.html]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

await build({ entryPoints: ['src/ui/main.jsx'], bundle: true, format: 'iife', target: 'es2020', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', minify: true, outfile: 'app.js', charset: 'utf8', legalComments: 'none' });
const cssDir = 'src/ui/css/';
const css = [readFileSync('src/ui/styles.css', 'utf8'), ...readdirSync(cssDir).filter(f => f.endsWith('.css')).sort().map(f => readFileSync(cssDir + f, 'utf8'))].join('\n');
writeFileSync('styles.css', css);
const standalone = process.argv[2];
if (standalone) {
  const js = readFileSync('app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
  const html = `<title>Fibre Welcome</title>
<meta name="description" content="Suivi d'une installation fibre Moov, du paiement à l'activation : démonstrateur avec serveur simulé.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800&display=swap">
<style>${css}</style>
<div id="root"><p style="padding:24px;font-family:system-ui">Chargement de Fibre Welcome…</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>window.FW_NO_SW = true;</script>
<script>${js}</script>
`;
  writeFileSync(standalone, html);
}
console.log('build ok', Math.round(readFileSync('app.js').length / 1024) + ' Ko');
