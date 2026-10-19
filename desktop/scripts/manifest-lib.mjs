import { basename } from 'node:path';

export const PLATFORMS = new Set([
  'windows-x86_64', 'darwin-aarch64', 'darwin-x86_64'
]);
const REPOSITORY = 'CocoPerinet/vyneo-mobile-releases';

export function compareVersions(left, right) {
  // Bound each component: avoid Number precision loss, Infinity and an
  // unreasonably large (attacker-controlled) semver component.
  const pattern = /^(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})\.(0|[1-9]\d{0,14})$/;
  if (typeof left !== 'string' || typeof right !== 'string') {
    throw Error('INVALID_DESKTOP_VERSION');
  }
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  if (!a || !b) throw Error('INVALID_DESKTOP_VERSION');
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(a[i]);
    const y = BigInt(b[i]);
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function ensureBoundSignedVersion(signature, version) {
  // Preflight ONLY: the updater itself cryptographically verifies minisign
  // signatures against its embedded pubkey. This checks that the release
  // builder wrote the exact tagged version in the *signed* comment.
  compareVersions(version, '0.0.0');
  if (typeof signature !== 'string' || signature.length > 8192 ||
      !/^[A-Za-z0-9+/=]{80,}$/.test(signature)) {
    throw Error('INVALID_MINISIGN_SIGNATURE');
  }
  const decoded = Buffer.from(signature, 'base64').toString('utf8');
  const lines = decoded.split(/\r?\n/);
  if (!lines.some(line => line.startsWith('untrusted comment: '))) {
    throw Error('INVALID_MINISIGN_ENVELOPE');
  }
  const trusted = lines.filter(line => line.startsWith('trusted comment: '));
  if (trusted.length !== 1) throw Error('INVALID_MINISIGN_ENVELOPE');
  const match = /(?:^|\t)version:([^\t ]+)/.exec(
    trusted[0].slice('trusted comment: '.length)
  );
  if (!match || match[1] !== version) {
    throw Error('SIGNED_VERSION_MISMATCH');
  }
  return true;
}

export function createManifest({ version, platform, asset, signature }) {
  compareVersions(version, '0.0.0');
  if (!PLATFORMS.has(platform)) throw Error('INVALID_PLATFORM');
  if (!/^Vyneo-Desktop-[0-9A-Za-z._-]{6,110}$/.test(asset) ||
      basename(asset) !== asset) throw Error('INVALID_ASSET_NAME');
  const expected = platform.startsWith('windows-') ? '.exe' : '.app.tar.gz';
  if (!asset.endsWith(expected)) throw Error('INVALID_ASSET_TYPE');
  ensureBoundSignedVersion(signature, version);
  return {
    version,
    notes: 'Mise à jour Vynéo Desktop signée et vérifiée.',
    platforms: {
      [platform]: {
        url: `https://github.com/${REPOSITORY}/releases/download/desktop-v${version}/${asset}`,
        signature
      }
    }
  };
}
