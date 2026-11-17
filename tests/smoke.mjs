// Smoke tests for the DOM-free store logic (src/store.js).
// Plain Node, no dependencies: `npm test`.
import assert from 'node:assert/strict';
import {
    MODULE_NAME,
    MODEL_CONTROL_MAP,
    addRemembered,
    defaultSettings,
    findRemembered,
    isChatCompletionApi,
    mergeSettings,
    normalizeModelId,
    providerKeyOf,
    removeRemembered,
    rememberedFor,
    resolveControlId,
    updateActiveProfile,
} from '../src/store.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`PASS  ${name}`);
    } catch (error) {
        failed++;
        console.log(`FAIL  ${name}\n      ${error?.message ?? error}`);
    }
}

// --- mergeSettings ---

test('mergeSettings: undefined yields defaults', () => {
    const settings = mergeSettings(undefined);
    assert.deepEqual(settings, { remembered: [], ui: { open: false, tab: 'remembered' } });
});

test('mergeSettings: preserves stored entries + ui state', () => {
    const settings = mergeSettings({
        remembered: [{ id: 'e1', providerKey: 'openai:custom', modelId: 'gpt-x', label: '', addedAt: 1 }],
        ui: { open: true, tab: 'available' },
    });
    assert.equal(settings.remembered.length, 1);
    assert.equal(settings.ui.open, true);
    assert.equal(settings.ui.tab, 'available');
});

test('mergeSettings: repairs broken shapes', () => {
    const settings = mergeSettings({ remembered: 'nope', ui: { tab: 'bogus' } });
    assert.deepEqual(settings.remembered, []);
    assert.equal(settings.ui.tab, 'remembered');
    assert.equal(settings.ui.open, false);
});

// --- provider identity ---

test('providerKeyOf composes main api + source', () => {
    assert.equal(providerKeyOf('openai', 'custom'), 'openai:custom');
    assert.equal(providerKeyOf('openai', 'openrouter'), 'openai:openrouter');
    assert.equal(providerKeyOf('textgenerationwebui', undefined), 'textgenerationwebui:');
});

test('isChatCompletionApi only accepts openai main api', () => {
    assert.equal(isChatCompletionApi('openai'), true);
    assert.equal(isChatCompletionApi('textgenerationwebui'), false);
    assert.equal(isChatCompletionApi('novel'), false);
});

// --- control map ---

test('resolveControlId maps chat-completion sources to ST control ids', () => {
    assert.equal(resolveControlId('openai', 'custom'), 'custom_model_id');
    assert.equal(resolveControlId('openai', 'makersuite'), 'model_google_select');
    assert.equal(resolveControlId('openai', 'openrouter'), 'model_openrouter_select');
    assert.equal(resolveControlId('openai', 'openai'), 'model_openai_select');
    assert.equal(resolveControlId('openai', 'mistralai'), 'model_mistralai_select');
});

test('resolveControlId: null for text completion and unknown sources', () => {
    assert.equal(resolveControlId('textgenerationwebui', '0'), null);
    assert.equal(resolveControlId('novel', undefined), null);
    assert.equal(resolveControlId('openai', 'azure_openai'), null);
});

test('MODEL_CONTROL_MAP covers every ST chat-completion source with a public model control', () => {
    // All chat_completion_sources values from openai.js minus azure_openai
    // (which has no row in ST's own modelSelectMap either).
    const expected = [
        'openai', 'claude', 'openrouter', 'ai21', 'makersuite', 'vertexai', 'mistralai',
        'custom', 'cohere', 'perplexity', 'groq', 'electronhub', 'chutes', 'nanogpt',
        'deepseek', 'aimlapi', 'xai', 'pollinations', 'moonshot', 'fireworks', 'cometapi',
        'zai', 'siliconflow', 'workers_ai', 'minimax',
    ];
    for (const source of expected) {
        assert.ok(MODEL_CONTROL_MAP[source], `missing control id for source "${source}"`);
    }
    assert.equal(Object.keys(MODEL_CONTROL_MAP).length, expected.length);
});

// --- remembered store ---

test('normalizeModelId trims and stringifies', () => {
    assert.equal(normalizeModelId('  gpt-4o  '), 'gpt-4o');
    assert.equal(normalizeModelId(undefined), '');
    assert.equal(normalizeModelId(123), '123');
});

test('addRemembered adds an entry with label fallback', () => {
    const settings = defaultSettings();
    const result = addRemembered(settings, { providerKey: 'openai:custom', modelId: ' gpt-x ', label: '' });
    assert.equal(result.added, true);
    assert.equal(settings.remembered.length, 1);
    assert.equal(settings.remembered[0].modelId, 'gpt-x');
    assert.equal(settings.remembered[0].label, 'gpt-x');
    assert.ok(settings.remembered[0].id);
    assert.ok(settings.remembered[0].addedAt > 0);
});

test('addRemembered rejects empty ids', () => {
    const settings = defaultSettings();
    const result = addRemembered(settings, { providerKey: 'openai:custom', modelId: '   ' });
    assert.equal(result.added, false);
    assert.equal(result.reason, 'empty');
    assert.equal(settings.remembered.length, 0);
});

test('addRemembered dedupes per provider (exact + case-insensitive), keeps cross-provider entries', () => {
    const settings = defaultSettings();
    addRemembered(settings, { providerKey: 'openai:custom', modelId: 'gpt-x' });
    const dup = addRemembered(settings, { providerKey: 'openai:custom', modelId: 'GPT-X', label: 'New Label' });
    assert.equal(dup.added, false);
    assert.equal(dup.reason, 'duplicate');
    assert.equal(dup.entry.modelId, 'gpt-x'); // original casing kept
    assert.equal(settings.remembered.length, 1);
    addRemembered(settings, { providerKey: 'openai:openrouter', modelId: 'gpt-x' });
    assert.equal(settings.remembered.length, 2); // other provider = separate entry
});

test('removeRemembered removes by id', () => {
    const settings = defaultSettings();
    const { entry } = addRemembered(settings, { providerKey: 'openai:custom', modelId: 'gpt-x' });
    assert.equal(removeRemembered(settings, entry.id), true);
    assert.equal(settings.remembered.length, 0);
    assert.equal(removeRemembered(settings, 'missing'), false);
});

test('rememberedFor filters by provider', () => {
    const settings = defaultSettings();
    addRemembered(settings, { providerKey: 'openai:custom', modelId: 'a' });
    addRemembered(settings, { providerKey: 'openai:openrouter', modelId: 'b' });
    addRemembered(settings, { providerKey: 'openai:custom', modelId: 'c' });
    const custom = rememberedFor(settings, 'openai:custom');
    assert.deepEqual(custom.map(entry => entry.modelId), ['a', 'c']);
});

test('findRemembered matches case-insensitively, returns null otherwise', () => {
    const settings = defaultSettings();
    addRemembered(settings, { providerKey: 'openai:custom', modelId: 'gpt-x' });
    assert.ok(findRemembered(settings, 'openai:custom', 'GPT-X'));
    assert.equal(findRemembered(settings, 'openai:custom', 'other'), null);
    assert.equal(findRemembered(settings, 'openai:openrouter', 'gpt-x'), null);
});

// --- profile update ---

test('updateActiveProfile: no profile → no change', () => {
    const result = updateActiveProfile(null, 'gpt-x');
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'no-profile');
});

test('updateActiveProfile: honors the exclude list', () => {
    const profile = { id: 'p1', mode: 'cc', model: 'old', exclude: ['model'] };
    const result = updateActiveProfile(profile, 'gpt-x');
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'excluded');
    assert.equal(profile.model, 'old');
});

test('updateActiveProfile: unchanged model reports unchanged', () => {
    const profile = { id: 'p1', mode: 'cc', model: 'gpt-x' };
    const result = updateActiveProfile(profile, 'gpt-x');
    assert.equal(result.changed, false);
    assert.equal(result.reason, 'unchanged');
    assert.ok(result.previous);
    assert.equal(result.previous.model, 'gpt-x');
});

test('updateActiveProfile: writes only the model field and snapshots the old state', () => {
    const profile = { id: 'p1', mode: 'cc', name: 'Main', model: 'old', preset: 'Default' };
    const result = updateActiveProfile(profile, 'gpt-x');
    assert.equal(result.changed, true);
    assert.equal(result.reason, 'updated');
    assert.equal(profile.model, 'gpt-x');
    assert.equal(profile.name, 'Main'); // untouched
    assert.equal(profile.preset, 'Default'); // untouched
    assert.equal(result.previous.model, 'old'); // snapshot independent of the mutation
    assert.equal(result.previous.name, 'Main');
});

test('updateActiveProfile: works when exclude key is absent', () => {
    const profile = { id: 'p1', mode: 'cc', model: 'old', exclude: ['proxy'] };
    const result = updateActiveProfile(profile, 'gpt-x');
    assert.equal(result.changed, true);
    assert.equal(profile.model, 'gpt-x');
});

// --- module identity ---

test('MODULE_NAME is stable regardless of install folder name', () => {
    assert.equal(MODULE_NAME, 'modelQuickSwitch');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
