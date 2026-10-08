import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read(name));
const assert = (condition, message) => { if (!condition) throw Error(message); };
const [command, tag, directory] = process.argv.slice(2);
assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? ''), 'Use a stable version tag such as v0.3.0.');
const version = tag.slice(1);
const config = json('src-tauri/tauri.conf.json');
function validate() {
  const cargo = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
  const lock = read('src-tauri/Cargo.lock').match(/name = "tokenlens"\nversion = "([^"]+)"/)?.[1];
  const versions = [config.version, json('package.json').version, json('package-lock.json').version, json('package-lock.json').packages[''].version, cargo, lock];
  assert(versions.every(v => v === version), `Version mismatch: expected ${version}, found ${versions.join(', ')}.`);
  assert(read(`docs/releases/${version}.md`).trim().length > 30, 'Write release notes before tagging.');
  assert(config.bundle.createUpdaterArtifacts === true, 'Enable updater artifacts for a release.');
  assert(config.plugins.updater.requireSignedVersion === true, 'Require signatures bound to the app version.');
}
function decode(value) {
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(value), 'Invalid base64 encoding.');
  const result = Buffer.from(value, 'base64');
  assert(result.toString('base64') === value, 'Non-canonical base64 encoding.');
  return result;
}
function verifyPackage(file, encodedSignature) {
  // Tauri uses Minisign Ed25519 signatures over the BLAKE2b-512 digest.
  // Verify both the artifact and trusted comment against the embedded public key.
  const publicLines = decode(config.plugins.updater.pubkey).toString('utf8').trim().split(/\r?\n/);
  const publicBytes = decode(publicLines[1]);
  assert(publicBytes.length === 42 && publicBytes.subarray(0,2).toString() === 'Ed', 'Invalid updater public key.');
  const lines = decode(encodedSignature).toString('utf8').trim().split(/\r?\n/);
  assert(lines.length === 4 && lines[0].startsWith('untrusted comment: ') && lines[2].startsWith('trusted comment: '), 'Invalid Minisign signature.');
  const signature = decode(lines[1]);
  assert(signature.length === 74 && signature.subarray(0,2).toString() === 'ED', 'Expected a prehashed Minisign signature.');
  assert(signature.subarray(2,10).equals(publicBytes.subarray(2,10)), 'Signing key does not match the app public key.');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), publicBytes.subarray(10)]), format:'der', type:'spki' });
  const digest = createHash('blake2b512').update(fs.readFileSync(file)).digest();
  assert(verify(null, digest, key, signature.subarray(10)), `Invalid artifact signature: ${path.basename(file)}.`);
  const comment = lines[2].slice('trusted comment: '.length);
  const signedVersion = comment.split(/\s+/).find(field => field.startsWith('version:'))?.slice(8);
  assert(signedVersion === version, `Signed version does not match ${version}.`);
  const globalSignature = decode(lines[3]);
  assert(globalSignature.length === 64 && verify(null, Buffer.concat([signature.subarray(10), Buffer.from(comment)]), key, globalSignature), 'Invalid trusted-comment signature.');
}
validate();
if (command === 'validate') {
  console.log(`Release ${tag}: versions, release notes and updater configuration verified.`);
} else if (command === 'manifest') {
  assert(directory, 'Specify the release assets directory.');
  const assets = path.resolve(directory);
  const platforms = {};
  for (const [target, platform, dmgArch] of [['aarch64-apple-darwin','darwin-aarch64','aarch64'],['x86_64-apple-darwin','darwin-x86_64','x64']]) {
    const filename = `TokenLens_${version}_${target}.app.tar.gz`;
    const signature = fs.readFileSync(path.join(assets, `${filename}.sig`), 'utf8').trim();
    verifyPackage(path.join(assets, filename), signature);
    for (const companion of [`TokenLens_${version}_${dmgArch}.dmg`, `TokenLens_${version}_${target}.app.zip`]) {
      assert(fs.statSync(path.join(assets, companion)).size > 0, `Missing installable asset ${companion}.`);
    }
    platforms[platform] = { signature, url: `https://github.com/kobewl/TokenLens/releases/download/${tag}/${filename}` };
  }
  const manifest = { version, notes:read(`docs/releases/${version}.md`).trim(), pub_date:new Date().toISOString(), platforms };
  fs.writeFileSync(path.join(assets, 'latest.json'), JSON.stringify(manifest,null,2)+'\n');
  const files = fs.readdirSync(assets).filter(f => f !== 'SHA256SUMS').sort();
  const checksums = files.map(f => `${createHash('sha256').update(fs.readFileSync(path.join(assets,f))).digest('hex')}  ${f}`).join('\n')+'\n';
  fs.writeFileSync(path.join(assets,'SHA256SUMS'), checksums);
  console.log(`Release ${tag}: both architectures verified, latest.json and SHA256SUMS generated.`);
} else throw Error('Expected validate or manifest.');
