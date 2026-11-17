// Model Quick Switch — pure logic, DOM-free.
//
// Everything in this file must stay importable from plain Node (see
// tests/smoke.mjs): no jQuery, no DOM access, no SillyTavern imports.
// Source values below were verified against the SillyTavern release clone.

export const MODULE_NAME = 'modelQuickSwitch';

/** Settings shape stored under extension_settings[MODULE_NAME]. */
export function defaultSettings() {
    return {
        // Remembered models: { id, providerKey, modelId, label, addedAt }
        remembered: [],
        ui: {
            open: false,
            minimized: false,
            tab: 'remembered',
        },
    };
}

/** Merges stored settings over the defaults; repairs broken shapes. */
export function mergeSettings(existing) {
    const defaults = defaultSettings();
    const merged = { ...defaults, ...(existing && typeof existing === 'object' ? existing : {}) };
    if (!Array.isArray(merged.remembered)) {
        merged.remembered = [];
    }
    merged.ui = { ...defaults.ui, ...(merged.ui && typeof merged.ui === 'object' ? merged.ui : {}) };
    if (merged.ui.tab !== 'remembered' && merged.ui.tab !== 'available') {
        merged.ui.tab = 'remembered';
    }
    return merged;
}

/** Provider identity: SillyTavern main API + chat-completion source. */
export function providerKeyOf(mainApi, ccSource) {
    return `${mainApi}:${ccSource ?? ''}`;
}

export function isChatCompletionApi(mainApi) {
    return mainApi === 'openai';
}

/**
 * Which DOM control holds the model for each chat-completion source.
 * Mirror of the chat-completion rows of SillyTavern's modelSelectMap
 * (public/scripts/slash-commands.js) — keyed by the string values of
 * `chat_completion_sources` (public/scripts/openai.js). Sources without
 * an entry (e.g. azure_openai) have no model field SillyTavern exposes
 * through that map either.
 */
export const MODEL_CONTROL_MAP = {
    openai: 'model_openai_select',
    claude: 'model_claude_select',
    openrouter: 'model_openrouter_select',
    ai21: 'model_ai21_select',
    makersuite: 'model_google_select',
    vertexai: 'model_vertexai_select',
    mistralai: 'model_mistralai_select',
    custom: 'custom_model_id',
    cohere: 'model_cohere_select',
    perplexity: 'model_perplexity_select',
    groq: 'model_groq_select',
    electronhub: 'model_electronhub_select',
    chutes: 'model_chutes_select',
    nanogpt: 'model_nanogpt_select',
    deepseek: 'model_deepseek_select',
    aimlapi: 'model_aimlapi_select',
    xai: 'model_xai_select',
    pollinations: 'model_pollinations_select',
    moonshot: 'model_moonshot_select',
    fireworks: 'model_fireworks_select',
    cometapi: 'model_cometapi_select',
    zai: 'model_zai_select',
    siliconflow: 'model_siliconflow_select',
    workers_ai: 'model_workers_ai_select',
    minimax: 'model_minimax_select',
};

/** Element id of the model control for the current API, or null if unsupported. */
export function resolveControlId(mainApi, ccSource) {
    if (!isChatCompletionApi(mainApi)) {
        return null;
    }
    return MODEL_CONTROL_MAP[ccSource] ?? null;
}

export function normalizeModelId(modelId) {
    return String(modelId ?? '').trim();
}

/** Adds a model to the remembered list; dedupes per provider (case-insensitive). */
export function addRemembered(settings, { providerKey, modelId, label = '' }) {
    const id = normalizeModelId(modelId);
    if (!id) {
        return { added: false, reason: 'empty', entry: null };
    }
    const existing = settings.remembered.find(
        entry => entry.providerKey === providerKey
            && normalizeModelId(entry.modelId).toLowerCase() === id.toLowerCase(),
    );
    if (existing) {
        return { added: false, reason: 'duplicate', entry: existing };
    }
    const entry = {
        id: randomId(),
        providerKey,
        modelId: id,
        label: String(label || id),
        addedAt: Date.now(),
    };
    settings.remembered.push(entry);
    return { added: true, reason: 'added', entry };
}

export function removeRemembered(settings, entryId) {
    const index = settings.remembered.findIndex(entry => entry.id === entryId);
    if (index === -1) {
        return false;
    }
    settings.remembered.splice(index, 1);
    return true;
}

/** All remembered models of one provider, oldest first. */
export function rememberedFor(settings, providerKey) {
    return settings.remembered.filter(entry => entry.providerKey === providerKey);
}

export function findRemembered(settings, providerKey, modelId) {
    const id = normalizeModelId(modelId).toLowerCase();
    return settings.remembered.find(
        entry => entry.providerKey === providerKey
            && normalizeModelId(entry.modelId).toLowerCase() === id,
    ) ?? null;
}

/**
 * Writes the model into the ACTIVE connection profile — surgical, so only the
 * `model` field changes (same key the `/model` slash command feeds into a
 * profile). Honors the profile's per-field exclusion list.
 *
 * @returns {{changed: boolean, previous: object|null, reason: string}}
 *   reason: 'no-profile' | 'excluded' | 'unchanged' | 'updated'
 */
export function updateActiveProfile(profile, modelId, { modelKey = 'model' } = {}) {
    if (!profile) {
        return { changed: false, previous: null, reason: 'no-profile' };
    }
    const exclude = Array.isArray(profile.exclude) ? profile.exclude : [];
    if (exclude.includes(modelKey)) {
        return { changed: false, previous: null, reason: 'excluded' };
    }
    const previous = { ...profile };
    if (profile[modelKey] === modelId) {
        return { changed: false, previous, reason: 'unchanged' };
    }
    profile[modelKey] = modelId;
    return { changed: true, previous, reason: 'updated' };
}

function randomId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `mqs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
