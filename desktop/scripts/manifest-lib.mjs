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

export function createManifest({ version, platform, asset, signature }) {
  compareVersions(version, '0.0.0');
  if (!PLATFORMS.has(platform)) throw Error('INVALID_PLATFORM');
  if (!/^Vyneo-Desktop-[0-9A-Za-z._-]{6,110}$/.test(asset) ||
      basename(asset) !== asset) throw Error('INVALID_ASSET_NAME');
  const expected = platform.startsWith('windows-') ? '.exe' : '.app.tar.gz';
  if (!asset.endsWith(expected)) throw Error('INVALID_ASSET_TYPE');
  if (typeof signature !== 'string' ||
      !/^[A-Za-z0-9+/=]{80,}$/.test(signature)) {
    throw Error('INVALID_MINISIGN_SIGNATURE');
  }
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
