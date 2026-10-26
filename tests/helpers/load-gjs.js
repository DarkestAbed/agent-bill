// tests/helpers/load-gjs.js
// Loads a legacy-GJS desklet module into Node so its PURE LOGIC can be
// unit-tested without Cinnamon. It mirrors GJS module semantics:
//   - top-level `function` declarations become exports (on the returned obj)
//   - top-level `const`/`let` stay module-private (visible to the functions)
//   - a minimal `global` with logError/log spies is provided
//   - `imports` is a stub that throws if used (those modules need Cinnamon)
const fs = require('fs');
const vm = require('vm');

function loadGjsModule(filePath, options = {}) {
    const code = fs.readFileSync(filePath, 'utf8');
    const logErrorCalls = [];
    const logCalls = [];
    const sandbox = {
        global: {
            logError: (...args) => { logErrorCalls.push(args); if (options.onLogError) options.onLogError(...args); },
            log: (...args) => { logCalls.push(args); },
        },
        imports: new Proxy({}, {
            get() { throw new Error('GJS `imports` used outside Cinnamon — not available in unit tests'); },
        }),
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: filePath });
    return { module: sandbox, logErrorCalls, logCalls };
}

module.exports = { loadGjsModule };
