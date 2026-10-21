// Used by CI only when Apple signing secrets are present: signs with the
// Developer ID certificate from CSC_LINK and notarizes. Local builds use the
// package.json config, which is ad-hoc signed and never touches your keychain.
const base = require('../package.json').build;
const mac = { ...base.mac, hardenedRuntime: true };
delete mac.identity;
module.exports = { ...base, mac };
