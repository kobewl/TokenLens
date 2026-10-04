import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const version = process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) throw Error('Specify a stable version, e.g. 0.3.1.');
for (const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json']) {
  const name = path.join(root,file), data = JSON.parse(fs.readFileSync(name,'utf8'));
  data.version = version;
  if (file === 'package-lock.json') data.packages[''].version = version;
  fs.writeFileSync(name,JSON.stringify(data,null,2)+'\n');
}
for (const [file, pattern] of [['src-tauri/Cargo.toml',/^version = "[^"]+"/m],['src-tauri/Cargo.lock',/name = "tokenlens"\nversion = "[^"]+"/]]) {
  const name = path.join(root,file);
  const data = fs.readFileSync(name,'utf8');
  if (!pattern.test(data)) throw Error(`Could not find app version in ${file}.`);
  fs.writeFileSync(name,data.replace(pattern,file.endsWith('.lock') ? `name = "tokenlens"\nversion = "${version}"` : `version = "${version}"`));
}
console.log(`Version set to ${version}. Write docs/releases/${version}.md, then run npm run release:check -- v${version} before committing and tagging.`);
