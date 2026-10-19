import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createManifest, compareVersions } from './manifest-lib.mjs';

// Run only on signed desktop-vX.Y.Z tags in the public release repository.
// The GitHub Actions GITHUB_TOKEN never leaves this repository.
const repository = 'CocoPerinet/vyneo-mobile-releases';
if (process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF_TYPE !== 'tag') {
  throw Error('RELEASE_JOB_ONLY');
}
const tag = process.env.GITHUB_REF_NAME;
const version = tag?.match(/^desktop-v(\d+\.\d+\.\d+)$/)?.[1];
if (!version) throw Error('INVALID_RELEASE_TAG');
const platform = process.env.VYNEO_RELEASE_PLATFORM;
const assetFile = process.env.VYNEO_RELEASE_ASSET;
const signatureFile = process.env.VYNEO_RELEASE_SIG;
if (!assetFile || !signatureFile ||
    basename(assetFile) !== assetFile ||
    signatureFile !== assetFile + '.sig') {
  throw Error('INVALID_RELEASE_FILES');
}
if (statSync(assetFile).size < 100_000) throw Error('TRUNCATED_RELEASE');
const signature = readFileSync(signatureFile, 'utf8').trim();
const manifest = createManifest({
  version, platform, asset: assetFile, signature
});
const filename = `desktop-${platform}.json`;
const address = `repos/${repository}/contents/${filename}`;
const gh = (args, input) => execFileSync('gh', args, {
  encoding: 'utf8', input, stdio: ['pipe','pipe','pipe']
});
let prior = null;
try {
  prior = JSON.parse(gh(['api', address]));
} catch (error) {
  // The first desktop version has no manifest yet. All other API errors
  // are fatal so we never overwrite an existing document blindly.
  if (!String(error.stderr || '').includes('404')) throw error;
}
let oldVersion = null;
if (prior) {
  if (prior.type !== 'file' || !prior.sha || !prior.content) {
    throw Error('INVALID_EXISTING_MANIFEST');
  }
  const oldData = JSON.parse(Buffer.from(prior.content, 'base64').toString());
  oldVersion = oldData.version;
  if (compareVersions(version, oldVersion) < 0) {
    throw Error('UPDATE_DOWNGRADE_REFUSED');
  }
}
const body = {
  message: `release(desktop): publish signed ${platform} ${version}`,
  content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
    .toString('base64'),
};
if (prior) body.sha = prior.sha;
gh(['api', '--method','PUT', address,
    '--header','Accept: application/vnd.github+json',
    '--input','-'], JSON.stringify(body));
console.log(`DESKTOP_SIGNED_MANIFEST_PUBLISHED ${filename} v${version}`);
