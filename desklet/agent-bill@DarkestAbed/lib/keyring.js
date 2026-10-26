// agent-bill — secure credential storage via the GNOME keyring (libsecret).
// Secrets are NEVER written to the desklet settings JSON or to git.
// Each provider's key is stored under a per-desklet, per-provider attribute.

const Secret = imports.gi.Secret;

const UUID = 'agent-bill@DarkestAbed';

// One schema for all agent-bill secrets. Attributes are lookup keys only
// (stored unencrypted); the secret itself is the password payload.
const SCHEMA = new Secret.Schema(
    `org.cinnamon.desklet.${UUID}`,
    Secret.SchemaFlags.NONE,
    {
        'desklet-uuid': Secret.SchemaAttributeType.STRING,
        'provider': Secret.SchemaAttributeType.STRING,
    }
);

function _attributes(provider) {
    return {
        'desklet-uuid': UUID,
        'provider': provider,
    };
}

function _label(provider) {
    return `agent-bill — ${provider} API key`;
}

// Store (or overwrite) a provider's API key in the default (login) keyring.
// Returns a Promise<boolean> — true on success.
function storeKey(provider, key) {
    return new Promise((resolve) => {
        Secret.password_store(
            SCHEMA,
            _attributes(provider),
            Secret.COLLECTION_DEFAULT,
            _label(provider),
            key,
            null,
            (source, result) => {
                try {
                    Secret.password_store_finish(result);
                    resolve(true);
                } catch (e) {
                    global.logError(`agent-bill: failed to store ${provider} key: ${e}`);
                    resolve(false);
                }
            }
        );
    });
}

// Look up a provider's API key synchronously. Returns the key string or null.
function lookupKey(provider) {
    try {
        return Secret.password_lookup_sync(SCHEMA, _attributes(provider), null);
    } catch (e) {
        global.logError(`agent-bill: failed to look up ${provider} key: ${e}`);
        return null;
    }
}

// Remove a provider's API key from the keyring. Returns a Promise<boolean>.
function clearKey(provider) {
    return new Promise((resolve) => {
        Secret.password_clear(
            SCHEMA,
            _attributes(provider),
            null,
            (source, result) => {
                try {
                    Secret.password_clear_finish(result);
                    resolve(true);
                } catch (e) {
                    global.logError(`agent-bill: failed to clear ${provider} key: ${e}`);
                    resolve(false);
                }
            }
        );
    });
}
