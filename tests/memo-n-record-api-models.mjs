import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const file = new URL('../scripts/settings/recordApiModels.js', import.meta.url);
const code = await fs.readFile(file, 'utf8');
const { modelsEndpoint, availableChatModelIds, discoverChatModels } =
    await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

assert.equal(modelsEndpoint('https://api.example/v1/'), 'https://api.example/v1/models');
assert.equal(modelsEndpoint('https://api.example/v1/chat/completions'), 'https://api.example/v1/models');
assert.equal(modelsEndpoint('https://api.example/v1?query=ignored'), 'https://api.example/v1/models');
assert.throws(() => modelsEndpoint('ftp://api.example/v1'), /http/);

assert.deepEqual(
    availableChatModelIds({ data: [
        { id: 'text-embedding-3-small' },
        { id: 'gpt-general' },
        { id: 'gpt-mini' },
        { id: 'gpt-mini' },
        { id: 'audio-model' },
    ] }),
    ['gpt-mini', 'gpt-general'],
);

let recorded;
const listed = await discoverChatModels('https://api.example/v1', 'example-key', async (url, options) => {
    recorded = { url, options };
    return {
        ok: true,
        json: async () => ({ data: [{ id: 'chat-large' }, { id: 'chat-flash' }] }),
    };
});
assert.deepEqual(listed, ['chat-flash', 'chat-large']);
assert.equal(recorded.url, 'https://api.example/v1/models');
assert.equal(recorded.options.method, 'GET');
assert.equal(recorded.options.headers.Authorization, 'Bearer example-key');

await assert.rejects(
    discoverChatModels('https://api.example/v1', 'example-key', async () => ({ ok:false, status:404 })),
    /HTTP 404/,
);
await assert.rejects(
    discoverChatModels('https://api.example/v1', 'bad-key', async () => ({ ok:false, status:401 })),
    /Key 无效/,
);

const api = await fs.readFile(new URL('../scripts/settings/standaloneAPI.js', import.meta.url), 'utf8');
assert.match(api, /handleApiTestRequest[\s\S]*resolveRecordApiModel/);
assert.match(api, /handleCustomAPIRequest[\s\S]*resolveRecordApiModel/);
assert.match(api, /max_tokens: 32/);

console.log('memo-n-record-api-models PASS: URL normalization, filtering, rank, discovery, 401/404, test/record linkage');
