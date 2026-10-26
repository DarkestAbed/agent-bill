// agent-bill — provider contract (documented interface, no runtime code).
//
// Each provider module (providers/claude.js, providers/codex.js,
// providers/ollama.js) MUST export exactly:
//
//   const Provider = {
//     id:    'claude' | 'codex' | 'ollama',   // string, matches keyring provider
//     label: 'Claude' | 'Codex' | 'Ollama',   // string, card title
//
//     // range: '5h' | '24h' | '7d'   (UI-selected look-back window)
//     // key:   the provider API key, already retrieved from the keyring.
//     // Returns a Promise that resolves to the RAW parsed JSON payload
//     // from the provider's usage endpoint (the desklet never interprets
//     // this directly — lib/usage.js normalizes it into a UsageSnapshot).
//     // On failure the Promise must reject with an Error (optionally with
//     // .status = HTTP status and .retryAfterSeconds for 429s).
//     fetchUsage(range, key) { ... },
//   };
//
// Keeping this contract identical across providers lets the desklet poll
// them uniformly and lets one provider fail without affecting the others.

const Provider = {};
