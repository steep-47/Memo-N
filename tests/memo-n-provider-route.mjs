import { ROUTE, normalizeProviderRoute, resolveManualProviderRoute } from '../scripts/runtime/providerRoute.js';

const cases = [
    { explicit: ROUTE.DEEPSEEK, stored: ROUTE.RELAY, expected: ROUTE.DEEPSEEK, name: 'explicit DeepSeek overrides stored relay' },
    { explicit: ROUTE.RELAY, stored: ROUTE.DEEPSEEK, expected: ROUTE.RELAY, name: 'explicit relay overrides stored DeepSeek' },
    { explicit: '', stored: ROUTE.RELAY, expected: ROUTE.RELAY, name: 'empty explicit uses stored relay' },
    { explicit: '', stored: ROUTE.DEEPSEEK, expected: ROUTE.DEEPSEEK, name: 'empty explicit uses stored DeepSeek' },
    { explicit: 'invalid', stored: ROUTE.RELAY, expected: ROUTE.RELAY, name: 'invalid explicit safely uses stored relay' },
    { explicit: 'invalid', stored: '', expected: ROUTE.DEEPSEEK, name: 'invalid and empty safely default to DeepSeek' },
];

for (const test of cases) {
    const actual = resolveManualProviderRoute(test.explicit, test.stored);
    if (actual !== test.expected) throw new Error(`${test.name}: expected ${test.expected}, got ${actual}`);
}

if (normalizeProviderRoute(' DEEPSEEK ') !== ROUTE.DEEPSEEK) throw new Error('DeepSeek route normalization failed');
if (normalizeProviderRoute('中转站') !== null) throw new Error('Localized label must not become an implicit route');

console.log(`memo-n-provider-route PASS: ${cases.length + 2} cases`);
