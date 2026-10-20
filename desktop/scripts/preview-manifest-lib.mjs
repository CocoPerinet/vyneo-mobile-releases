import { PLATFORMS } from './manifest-lib.mjs';

const REPOSITORY = 'CocoPerinet/vyneo-mobile-releases';
const SEGMENT = '(0|[1-9][0-9]{0,14})';
const PREVIEW = new RegExp('^' + SEGMENT + '\\.' + SEGMENT +
  '\\.' + SEGMENT + '-beta\\.' + SEGMENT + '$');
const SUFFIX = Object.freeze({
  'windows-x86_64': 'windows-x64.exe',
  'darwin-aarch64': 'macos-arm64.app.tar.gz',
  'darwin-x86_64': 'macos-x64.app.tar.gz'
});

export function previewVersionParts(version) {
  if (typeof version !== 'string') throw Error('INVALID_PREVIEW_VERSION');
  const match = PREVIEW.exec(version);
  if (!match || match[4] === '0') throw Error('INVALID_PREVIEW_VERSION');
  return match.slice(1).map(value => BigInt(value));
}
export function comparePreviewVersions(left, right) {
  const a = previewVersionParts(left), b = previewVersionParts(right);
  for (let i = 0; i < 4; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
export function previewSignedVersion(signature, version) {
  previewVersionParts(version);
  if (typeof signature !== 'string' || signature.length > 8192 ||
      !/^[A-Za-z0-9+/=]{80,}$/.test(signature))
    throw Error('INVALID_PREVIEW_SIGNATURE');
  const text = Buffer.from(signature, 'base64').toString('utf8');
  const lines = text.split(/\r?\n/);
  if (!lines.some(line => line.startsWith('untrusted comment: ')))
    throw Error('INVALID_PREVIEW_SIGNATURE');
  const trusted = lines.filter(line => line.startsWith('trusted comment: '));
  if (trusted.length !== 1)
    throw Error('INVALID_PREVIEW_SIGNATURE');
  const matched = /(?:^|\t)version:([^\t ]+)/.exec(
    trusted[0].slice('trusted comment: '.length));
  if (matched?.[1] !== version) throw Error('PREVIEW_SIGNED_VERSION_MISMATCH');
  return true;
}
export function previewManifest({version, platform, asset, signature}) {
  previewVersionParts(version);
  if (!PLATFORMS.has(platform)) throw Error('PREVIEW_PLATFORM_INVALID');
  if (asset !== 'Vyneo-Desktop-Preview-' + version + '-' + SUFFIX[platform])
    throw Error('PREVIEW_ASSET_INVALID');
  previewSignedVersion(signature, version);
  return {
    version,
    notes: 'Vynéo Preview : préversion signée, proposée aux testeurs.',
    platforms: {
      [platform]: {
        url: 'https://github.com/' + REPOSITORY +
          '/releases/download/desktop-preview-v' + version + '/' + asset,
        signature
      }
    }
  };
}
