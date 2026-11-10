// Build a clean Eagle project directory. Eagle itself produces .eagleplugin.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error('--output requires a directory');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const allowed = file => ['manifest.json', 'index.html', 'README.md', 'CHANGELOG.md'].includes(file)
  || /^js\/[\w/-]+\.js$/.test(file)
  || /^styles\/[\w/-]+\.css$/.test(file)
  || /^assets\/[\w/-]+\.(?:svg|png|woff2|otf|txt|md)$/.test(file)
  || ['docs/PRIVACY.md', 'docs/REVIEW.md', 'docs/RELEASE.md', 'docs/MANAGED-PYTHON.md'].includes(file);
const files = tracked.filter(allowed);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const versionIndex=process.argv.indexOf('--version');
const version=versionIndex<0?manifest.version:process.argv[versionIndex+1];
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Invalid submission version');
async function releaseContent(file,buffer){
  if(file==='manifest.json')return Buffer.from(JSON.stringify({...JSON.parse(buffer),version},null,2)+'\n');
  if(file==='js/panels.js')return Buffer.from(buffer.toString('utf8').replace(/version = 'v\d+\.\d+\.\d+'/,'version = \'v'+version+'\''));
  if(file==='README.md')return fs.readFile(path.join(root,'docs/RELEASE-README.md'));
  if(file==='CHANGELOG.md')return Buffer.from(`# ReferenceSync\n\n## ${version}\n\nPublic release with eight sources, saved/liked feeds where supported, direct links,\nsupported archives, component selection, naming, descriptions, numbering, import\nhistory, recovery and complete Behance cases. Engine preparation can install a\nprivate portable Python when needed. Five interface languages.\n`);
  return buffer;
}
if (manifest.devTools !== false || manifest.main?.devTools !== false) throw new Error('Disable devTools before packaging');
for (const required of ['manifest.json', 'index.html', manifest.logo, manifest.main.url,
  'assets/fonts/LICENSE-IBMPlex.txt', 'assets/fonts/LICENSE-Manrope.txt', 'assets/fonts/LICENSE-CommitMono.txt']) {
  if (!files.includes(required)) throw new Error(`Missing release file: ${required}`);
}
// Refuse symlinks and broken local imports/resources before writing anything.
const inventory = [];
for (const file of files) {
  const filename = path.join(root, file);
  if (!(await fs.lstat(filename)).isFile()) throw new Error(`Not a regular file: ${file}`);
  const buffer = await releaseContent(file,await fs.readFile(filename));
  if (file.endsWith('.woff2') && buffer.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid WOFF2: ${file}`);
  if (/\.(?:js|css|html)$/.test(file)) {
    const text = buffer.toString('utf8');
    const refs = file.endsWith('.js') ? [...text.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g)].map(m => m[1])
      : file.endsWith('.css') ? [...text.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)].map(m => m[1])
      : [...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m => m[1]);
    for (const ref of refs) {
      if (/^(?:data:|https?:|#)/.test(ref)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref.split(/[?#]/)[0]));
      if (!files.includes(target)) throw new Error(`Missing dependency: ${file} -> ${target}`);
    }
  }
  inventory.push({ path: file, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
}
if (checkOnly) {
  console.log(JSON.stringify({ version, sourceVersion:manifest.version, files: files.length,
    bytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
    checkOnly: true, releaseReady: false, packageTested: false }));
  process.exit(0);
}
let destination;
if (outputIndex >= 0) {
  destination = path.resolve(process.argv[outputIndex + 1]);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // Refuse an existing folder instead of replacing personal/release files.
  await fs.mkdir(destination);
} else {
  const parent = path.join(root, 'dist');
  await fs.mkdir(parent, { recursive: true });
  destination = await fs.mkdtemp(path.join(parent, `ReferenceSync-${manifest.version}-`));
}
for (const file of files) {
  const target = path.join(destination, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const content=await releaseContent(file,await fs.readFile(path.join(root,file)));
  await fs.writeFile(target,content,{flag:'wx'});
  const entry=inventory.find(item=>item.path===file);
  entry.bytes=content.length;entry.sha256=createHash('sha256').update(content).digest('hex');
}
const report = { version, sourceVersion:manifest.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  releaseReady: false, packageFormat: 'Eagle project directory; not an .eagleplugin',
  files: inventory, totalBytes: inventory.reduce((sum, item) => sum + item.bytes, 0) };
await fs.writeFile(`${destination}.inventory.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory: destination, files: files.length, bytes: report.totalBytes, releaseReady: false }));
