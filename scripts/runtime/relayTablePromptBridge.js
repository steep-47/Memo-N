// Relay protocol injection is intentionally owned by recordEngine.js.
// This module remains as a compatibility import target only; it must not
// mutate CHAT_COMPLETION_SETTINGS_READY or compete with the record engine.

globalThis.__memoNRelayTablePromptProbe = Object.freeze({
    at: Date.now(),
    owner: 'recordEngine',
    bridgePassive: true,
});
