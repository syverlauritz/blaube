// Used by CI only when Apple signing secrets are present: signs with the
// Developer ID certificate from CSC_LINK and notarizes. Local builds use the
// package.json config, which skips electron-builder's signing entirely and
// ad-hoc signs in build/adhoc-sign.js, so it never touches your keychain.
process.env.BLAUBE_DEVELOPER_ID = '1';
const base = require('../package.json').build;
const mac = { ...base.mac, hardenedRuntime: true };
delete mac.identity;
// blaubeSigned lets the app install its own updates (src/main/updater.js):
// Squirrel.Mac only accepts a Developer ID signature.
const config = { ...base, mac, extraMetadata: { blaubeSigned: true } };
delete config.afterPack;
module.exports = config;
