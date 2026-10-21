// afterPack hook: ad-hoc signs the Mac app with `codesign -s -`, which never
// looks at the keychain. electron-builder's own signing is switched off
// (mac.identity: null) because it can still pick up unrelated keychain
// certificates. Skipped when CI signs with Blaube's Developer ID.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.BLAUBE_DEVELOPER_ID) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
