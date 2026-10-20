import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { previewManifest, comparePreviewVersions } from
  './preview-manifest-lib.mjs';

const repository = 'CocoPerinet/vyneo-mobile-releases';
if (process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF_TYPE !== 'tag')
  throw Error('PREVIEW_TAG_ONLY');
const conf = JSON.parse(readFileSync('src-tauri/tauri.preview.conf.json','utf8'));
const version = conf.version;
const tag = 'desktop-preview-v' + version;
if (process.env.GITHUB_REF_NAME !== tag ||
    conf.identifier !== 'fr.visyren.vyneo.desktop.preview')
  throw Error('PREVIEW_TAG_MISMATCH');
const platform = process.env.VYNEO_RELEASE_PLATFORM;
const asset = process.env.VYNEO_RELEASE_ASSET;
const signatureFile = process.env.VYNEO_RELEASE_SIG;
if (!asset || !signatureFile || basename(asset) !== asset ||
    signatureFile !== asset + '.sig')
  throw Error('PREVIEW_ASSET_INVALID');
if (statSync(asset).size < 100_000) throw Error('PREVIEW_TRUNCATED');
const signature = readFileSync(signatureFile,'utf8').trim();
const manifest = previewManifest({version,platform,asset,signature});
const gh = (args,input) => execFileSync('gh',args,{
  encoding:'utf8',input,stdio:['pipe','pipe','pipe']
});
const release = JSON.parse(gh(['release','view',tag,'--json','isPrerelease']));
if (release.isPrerelease !== true) throw Error('PREVIEW_RELEASE_REQUIRED');

// A preview can ONLY update its independent preview-prefixed manifest.
// The existing stable desktop-*.json and Mobile manifests are untouched.
const filename = 'desktop-preview-' + platform + '.json';
const address = 'repos/' + repository + '/contents/' + filename;
let prior = null;
try {
  prior = JSON.parse(gh(['api',address]));
} catch (error) {
  if (!String(error.stderr??'').includes('404')) throw error;
}
if (prior) {
  if (prior.type !== 'file' || !prior.sha || !prior.content)
    throw Error('PREVIEW_MANIFEST_INVALID');
  const existing = JSON.parse(Buffer.from(prior.content,'base64').toString());
  const order = comparePreviewVersions(version,existing.version);
  if (order < 0) throw Error('PREVIEW_DOWNGRADE_REFUSED');
  if (order === 0) {
    if (JSON.stringify(existing) === JSON.stringify(manifest)) {
      console.log('PREVIEW_MANIFEST_ALREADY_CURRENT ' + filename);
      process.exit(0);
    }
    throw Error('PREVIEW_REPUBLISH_REFUSED');
  }
}
const body = {
  message:'release(desktop-preview): signed ' + platform + ' ' + version,
  branch:'main',
  content:Buffer.from(JSON.stringify(manifest,null,2)+'\n').toString('base64')
};
if (prior) body.sha = prior.sha;
gh(['api','--method','PUT',address,
  '--header','Accept: application/vnd.github+json',
  '--input','-'],JSON.stringify(body));
console.log('PREVIEW_SIGNED_MANIFEST_PUBLISHED ' + filename + ' ' + version);

