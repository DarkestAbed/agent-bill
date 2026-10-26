// scripts/smoke-keyring.js — integration test for lib/keyring.js under REAL GJS.
// This can only run on the LMDE 7 target (it needs GJS + the Secret Service
// keyring, which this WSL sandbox does not have). It loads the ACTUAL
// desklet/agent-bill@DarkestAbed/lib/keyring.js module and round-trips a
// throwaway value through the GNOME keyring: store -> lookup -> clear.
//
// Usage (on target):
//   AGENT_BILL_DESKLET_DIR=~/.local/share/cinnamon/desklets/agent-bill@DarkestAbed \
//     gjs scripts/smoke-keyring.js
const Secret = imports.gi.Secret; // fail fast if libsecret is unavailable
const GLib = imports.gi.GLib;

const dir = GLib.getenv('AGENT_BILL_DESKLET_DIR') ||
    GLib.get_home_dir() + '/.local/share/cinnamon/desklets/agent-bill@DarkestAbed';

imports.searchPath.push(dir);
const keyring = imports.lib.keyring; // the REAL module under test

const PROVIDER = 'smoke-test';          // throwaway namespace, cleared afterwards
const VALUE = 'roundtrip-value-123';

const loop = new GLib.MainLoop(null, false);
let failed = false;

function fail(msg) {
    print('FAIL: ' + msg);
    failed = true;
    loop.quit();
}

keyring.storeKey(PROVIDER, VALUE).then((ok) => {
    if (!ok) { fail('storeKey returned false (keyring locked or unavailable?)'); return null; }
    const got = keyring.lookupKey(PROVIDER);
    if (got !== VALUE) { fail('lookup mismatch after store: got=' + got); return null; }
    return keyring.clearKey(PROVIDER).then((ok2) => {
        if (!ok2) { fail('clearKey returned false'); return; }
        const after = keyring.lookupKey(PROVIDER);
        if (after !== null) { fail('key still present after clear: ' + after); return; }
        print('PASS: keyring round-trip (store -> lookup -> clear) via lib/keyring.js');
        loop.quit();
    });
}).catch((e) => { fail('exception: ' + e); });

loop.run();
imports.system.exit(failed ? 1 : 0);
