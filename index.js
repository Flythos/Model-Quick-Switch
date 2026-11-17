// Model Quick Switch — floating modal to remember and one-click-apply models
// per chat-completion provider.
//
// Tab "Remembered": models saved for the current provider; clicking one sets
//   it on the live connection AND writes it into the active connection
//   profile. SillyTavern does not auto-save panel edits into profiles (that
//   is what the profile Update button does), so we update the stored profile
//   surgically — model field only — and emit the same events the Update
//   button emits.
// Tab "Available": mirrors the provider's "Available Models" control from the
//   API connections window plus a free-text model-id field, with a Remember
//   button.
//
// The panel shell reuses SillyTavern's moving-UI machinery (dragElement),
// so dragging works and the position is persisted for free.

import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { animation_duration, eventSource, event_types, main_api, saveSettingsDebounced } from '../../../../script.js';
import { oai_settings } from '../../../../scripts/openai.js';
import { loadMovingUIState } from '../../../../scripts/power-user.js';
import { dragElement } from '../../../../scripts/RossAscends-mods.js';
import { delay, escapeHtml } from '../../../../scripts/utils.js';
import {
    MODULE_NAME,
    addRemembered,
    findRemembered,
    isChatCompletionApi,
    mergeSettings,
    normalizeModelId,
    providerKeyOf,
    removeRemembered,
    rememberedFor,
    resolveControlId,
    updateActiveProfile,
} from './src/store.js';

// `$` (jQuery), `toastr` and the jQuery `.transition` plugin are page-level globals provided by SillyTavern.

const PANEL_ID = 'mqsPanel';

// data-id of the Remembered tab's "currently selected" info row (shown when
// the live model is not among the remembered entries).
const CURRENT_ROW_ID = '__mqs_current__';

let settings = null;
let panelElement = null;
let buttonInjected = false;
let injectionObserver = null;

function log(message, ...rest) {
    console.debug(`[${MODULE_NAME}]`, message, ...rest);
}

function toast(kind, message) {
    if (typeof toastr === 'function') {
        toastr[kind](message, '', { timeOut: 2500 });
    } else {
        console.warn(`[${MODULE_NAME}] toastr missing: ${message}`);
    }
}

/**
 * Install-folder name for template loading, derived from this module's URL so
 * the folder can be renamed without breaking template paths.
 */
function getExtensionName() {
    try {
        // '.' keeps the file's own directory (the extension root); '../' would
        // climb above it, since URL resolution drops index.js before applying it.
        const rootUrl = new URL('.', import.meta.url);
        const match = rootUrl.pathname.match(/\/scripts\/extensions\/(.+?)\/?$/);
        if (match) {
            return match[1];
        }
    } catch {
        /* fall through */
    }
    return 'third-party/Model-Quick-Switch';
}

function getSettings() {
    settings = mergeSettings(extension_settings[MODULE_NAME]);
    extension_settings[MODULE_NAME] = settings;
    return settings;
}

// --- Provider / model resolution ---

function getCurrentProviderKey() {
    return providerKeyOf(main_api, oai_settings.chat_completion_source);
}

/** The DOM control SillyTavern uses for the current provider's model. */
function resolveModelControl() {
    const id = resolveControlId(main_api, oai_settings.chat_completion_source);
    return id ? document.getElementById(id) : null;
}

function getCurrentModelId() {
    const control = resolveModelControl();
    return control ? normalizeModelId(control.value) : '';
}

function getProviderLabel() {
    if (!isChatCompletionApi(main_api)) {
        return String(main_api);
    }
    const option = document.getElementById('chat_completion_source')?.selectedOptions?.[0];
    return option?.text ?? String(oai_settings.chat_completion_source ?? main_api);
}

/** Display text of `modelId` in the provider's own list, if it is listed. */
function findOptionText(modelId) {
    const control = resolveModelControl();
    if (!control) {
        return '';
    }
    const options = control instanceof HTMLSelectElement
        ? Array.from(control.options)
        : (control.list ? Array.from(control.list.options) : []);
    const match = options.find(option => option.value === modelId);
    return match && match.text && match.text !== match.value ? match.text : '';
}

// --- Core mechanic: apply a remembered model ---

async function applyRemembered(entry) {
    const control = resolveModelControl();
    if (!control) {
        toast('warning', 'No model control exists for the current provider.');
        return;
    }

    // Route through SillyTavern's own change/input handlers so their side
    // effects run (oai_settings persistence, context caps, CHATCOMPLETION_MODEL_CHANGED).
    if (control instanceof HTMLInputElement) {
        control.value = entry.modelId;
        $(control).trigger('input');
    } else {
        const hasOption = Array.from(control.options).some(option => option.value === entry.modelId);
        if (!hasOption) {
            control.append(new Option(entry.label || entry.modelId, entry.modelId));
        }
        control.value = entry.modelId;
        $(control).trigger('change');
    }

    // Update the ACTIVE connection profile (model field only), mirroring the
    // profile Update button's event emissions.
    const connectionManager = extension_settings.connectionManager;
    const profile = Array.isArray(connectionManager?.profiles)
        ? connectionManager.profiles.find(p => p.id === connectionManager.selectedProfile)
        : null;
    const result = updateActiveProfile(profile, entry.modelId);
    if (result.changed) {
        saveSettingsDebounced();
        await eventSource.emit(event_types.CONNECTION_PROFILE_UPDATED, result.previous, profile);
        await eventSource.emit(event_types.CONNECTION_PROFILE_LOADED, profile.name);
        toast('success', `Model set to "${entry.modelId}" — profile "${profile.name}" updated.`);
    } else if (result.reason === 'excluded') {
        toast('success', `Model set to "${entry.modelId}" — profile excludes the model field, not stored.`);
    } else if (profile) {
        toast('success', `Model set to "${entry.modelId}".`);
    } else {
        toast('success', `Model set to "${entry.modelId}" (no active profile).`);
    }

    refreshPanel();
}

// --- Panel lifecycle ---

async function buildPanel() {
    const template = await renderExtensionTemplateAsync(getExtensionName(), 'panel');
    panelElement = $(template);
    $('#movingDivs').append(panelElement);

    wirePanel();
    loadMovingUIState();
    dragElement(panelElement);

    switchTab(settings.ui.tab, { save: false });
}

function showPanel() {
    if (!panelElement) {
        return;
    }
    settings.ui.open = true;
    saveSettingsDebounced();
    if (panelElement.css('display') !== 'flex') {
        panelElement.addClass('resizing');
        panelElement.css('display', 'flex');
        panelElement.css('opacity', 0);
        panelElement.transition({
            opacity: 1.0,
            duration: animation_duration,
        }, async function () {
            await delay(50);
            panelElement.removeClass('resizing');
        });
    }
    refreshPanel();
}

function hidePanel() {
    if (!panelElement) {
        return;
    }
    settings.ui.open = false;
    saveSettingsDebounced();
    panelElement.addClass('resizing');
    panelElement.transition({
        opacity: 0.0,
        duration: animation_duration,
    });
    setTimeout(function () {
        panelElement.removeClass('resizing');
        panelElement.hide();
    }, animation_duration);
}

function togglePanel() {
    if (!panelElement) {
        return;
    }
    if (panelElement.css('display') === 'flex') {
        hidePanel();
    } else {
        showPanel();
    }
}

function switchTab(tab, { save = true } = {}) {
    if (tab !== 'remembered' && tab !== 'available') {
        tab = 'remembered';
    }
    settings.ui.tab = tab;
    if (save) {
        saveSettingsDebounced();
    }
    panelElement?.find('#mqs_tab_remembered_content').toggleClass('mqs-hidden', tab !== 'remembered');
    panelElement?.find('#mqs_tab_available_content').toggleClass('mqs-hidden', tab !== 'available');
    panelElement?.find('.mqs-tab').each(function () {
        $(this).toggleClass('mqs-active', String($(this).data('tab')) === tab);
    });
}

// --- Panel wiring ---

function wirePanel() {
    const panel = panelElement;

    panel.find('#mqsPanelClose').on('click', hidePanel);

    panel.find('.mqs-tab').on('click', function () {
        switchTab(String($(this).data('tab')));
    });

    // Available tab: picking from the dropdown fills the model-id field.
    panel.find('#mqsModelSelect').on('change', function () {
        const value = normalizeModelId($(this).val());
        if (value) {
            panel.find('#mqsModelId').val(value);
        }
    });

    panel.find('#mqsRememberButton').on('click', function () {
        const modelId = normalizeModelId(panel.find('#mqsModelId').val());
        if (!modelId) {
            toast('warning', 'Enter or pick a model id first.');
            return;
        }
        const result = addRemembered(settings, {
            providerKey: getCurrentProviderKey(),
            modelId,
            label: findOptionText(modelId),
        });
        if (!result.added) {
            if (result.reason === 'duplicate') {
                toast('info', `"${modelId}" is already remembered.`);
            }
        } else {
            saveSettingsDebounced();
            toast('success', `Remembered "${modelId}" for ${getProviderLabel()}.`);
        }
        switchTab('remembered');
        refreshPanel();
    });

    // Remembered tab (delegated): row click applies, ✕ forgets.
    panel.on('click', '#mqsRememberedList .mqs-row', function (event) {
        if ($(event.target).closest('.mqs-remove').length) {
            return;
        }
        const entryId = String($(this).data('id'));
        if (entryId === CURRENT_ROW_ID) {
            // "Currently selected" info row — re-applies the live model.
            const modelId = getCurrentModelId();
            if (modelId) {
                applyRemembered({ modelId, label: findOptionText(modelId) }).catch(error => {
                    console.error(`[${MODULE_NAME}] apply failed`, error);
                    toast('error', `Applying the model failed: ${error?.message ?? error}`);
                });
            }
            return;
        }
        const entry = settings.remembered.find(candidate => candidate.id === entryId);
        if (entry) {
            applyRemembered(entry).catch(error => {
                console.error(`[${MODULE_NAME}] apply failed`, error);
                toast('error', `Applying the model failed: ${error?.message ?? error}`);
            });
        }
    });

    panel.on('click', '#mqsRememberedList .mqs-remove', function (event) {
        event.stopPropagation();
        const entryId = String($(this).closest('.mqs-row').data('id'));
        if (removeRemembered(settings, entryId)) {
            saveSettingsDebounced();
            refreshPanel();
        }
    });
}

// --- Rendering ---

function refreshPanel() {
    if (!panelElement || panelElement.css('display') !== 'flex') {
        return;
    }
    refreshNotice();
    refreshRememberedTab();
    refreshAvailableTab();
    refreshStatus();
}

function refreshNotice() {
    const supported = Boolean(resolveControlId(main_api, oai_settings.chat_completion_source));
    const $notice = panelElement.find('#mqsNotice');
    $notice.toggleClass('mqs-hidden', supported);
    $notice.text(supported ? '' : `Model Quick Switch supports chat-completion providers only — "${main_api}" has no model field this extension can set.`);
}

function refreshRememberedTab() {
    const list = panelElement.find('#mqsRememberedList');
    const hint = panelElement.find('#mqsRememberedHint');
    list.empty();

    const entries = isChatCompletionApi(main_api) ? rememberedFor(settings, getCurrentProviderKey()) : [];
    const current = getCurrentModelId();
    hint.text(entries.length
        ? `${entries.length} remembered for ${getProviderLabel()} — click one to apply it.`
        : `Nothing remembered for ${getProviderLabel()} yet — use the Available tab.`);

    for (const entry of entries) {
        const isCurrent = Boolean(current) && current.toLowerCase() === entry.modelId.toLowerCase();
        const showModel = entry.label !== entry.modelId;
        list.append($(`
            <div class="mqs-row${isCurrent ? ' mqs-row-current' : ''}" data-id="${escapeHtml(entry.id)}" title="Apply ${escapeHtml(entry.modelId)}">
                <i class="fa-solid ${isCurrent ? 'fa-circle-check mqs-current-icon' : 'fa-star mqs-star-icon'}"></i>
                <div class="mqs-row-texts">
                    <div class="mqs-row-label">${escapeHtml(entry.label || entry.modelId)}</div>
                    ${showModel ? `<div class="mqs-row-model">${escapeHtml(entry.modelId)}</div>` : ''}
                </div>
                <i class="fa-solid fa-xmark mqs-remove" title="Forget this model"></i>
            </div>
        `));
    }

    if (current && !findRemembered(settings, getCurrentProviderKey(), current)) {
        // The live model is not remembered — still always show it as current.
        list.prepend($(`
            <div class="mqs-row mqs-row-current" data-id="${CURRENT_ROW_ID}" title="Re-apply ${escapeHtml(current)} (currently in use)">
                <i class="fa-solid fa-circle-check mqs-current-icon"></i>
                <div class="mqs-row-texts">
                    <div class="mqs-row-label">${escapeHtml(current)}</div>
                    <div class="mqs-row-model">Currently selected — not remembered yet</div>
                </div>
            </div>
        `));
    }
}

function refreshAvailableTab() {
    const select = panelElement.find('#mqsModelSelect');
    const hint = panelElement.find('#mqsAvailableHint');
    select.empty();

    const control = resolveModelControl();
    if (!isChatCompletionApi(main_api) || !control) {
        select.append('<option value="">(not available for this API)</option>');
        hint.text('');
        return;
    }

    const currentModel = normalizeModelId(control.value);

    // Always offer the live model as a marked entry so the current selection
    // is visible even when the provider list hasn't loaded or lacks it.
    if (currentModel) {
        select.append(new Option(`★ Currently selected — ${currentModel}`, currentModel));
    }

    if (control instanceof HTMLSelectElement) {
        // Mirror the provider's own dropdown, preserving its optgroups.
        let count = 0;
        for (const child of Array.from(control.children)) {
            if (child instanceof HTMLOptGroupElement) {
                const group = $(`<optgroup label="${escapeHtml(child.label ?? '')}"></optgroup>`);
                for (const option of Array.from(child.children).filter(el => el instanceof HTMLOptionElement)) {
                    if (!option.value) {
                        continue;
                    }
                    group.append(new Option(option.text, option.value));
                    count++;
                }
                if (group.children().length) {
                    select.append(group);
                }
            } else if (child instanceof HTMLOptionElement) {
                if (!child.value) {
                    continue;
                }
                select.append(new Option(child.text, child.value));
                count++;
            }
        }
        if (currentModel) {
            select.val(currentModel);
        }
        hint.text(count
            ? `${count} models reported by ${getProviderLabel()}.`
            : `No models listed yet — connect to ${getProviderLabel()} first, or type a model id below.`);
    } else {
        // Input + datalist (e.g. Custom OpenAI-compatible): mirror suggestions.
        const suggestions = control.list ? Array.from(control.list.options) : [];
        for (const option of suggestions) {
            if (option.value) {
                select.append(new Option(option.text || option.value, option.value));
            }
        }
        if (currentModel) {
            select.val(currentModel);
        }
        hint.text(suggestions.length
            ? `Suggestions from the provider's model list — or type any id below.`
            : `No cached model list — connect once, or type the model id below.`);
    }
}

function refreshStatus() {
    const connectionManager = extension_settings.connectionManager;
    const profile = Array.isArray(connectionManager?.profiles)
        ? connectionManager.profiles.find(p => p.id === connectionManager.selectedProfile)
        : null;
    const model = getCurrentModelId();
    const parts = [getProviderLabel()];
    if (model) {
        parts.push(`model: ${model}`);
    }
    parts.push(profile ? `profile: ${profile.name}` : 'no active profile');
    panelElement.find('#mqsStatus').text(parts.join('  ·  '));
}

// --- Entry-point button in the connection drawer ---

function injectDrawerButton() {
    if (buttonInjected) {
        return;
    }
    const profilesSelect = document.getElementById('connection_profiles');
    if (!profilesSelect) {
        // Connection-manager UI not injected yet (load order) — wait for it.
        watchForProfilesRow();
        return;
    }
    if (document.getElementById('mqs_open_button')) {
        buttonInjected = true;
        return;
    }

    const button = document.createElement('i');
    button.id = 'mqs_open_button';
    button.className = 'menu_button fa-solid fa-right-left';
    button.title = 'Model Quick Switch';
    button.setAttribute('role', 'button');
    profilesSelect.after(button);
    $(button).on('click', togglePanel);

    buttonInjected = true;
    if (injectionObserver) {
        injectionObserver.disconnect();
        injectionObserver = null;
    }
    log('drawer button injected');
}

function watchForProfilesRow() {
    if (injectionObserver) {
        return;
    }
    const target = document.getElementById('rm_api_block') ?? document.body;
    injectionObserver = new MutationObserver(function () {
        if (document.getElementById('connection_profiles')) {
            injectDrawerButton();
        }
    });
    injectionObserver.observe(target, { childList: true, subtree: true });
}

// --- Events / init ---

function registerEventListeners() {
    // All handlers no-op while the panel is hidden (refreshPanel guards).
    eventSource.on(event_types.MAIN_API_CHANGED, refreshPanel);
    eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, refreshPanel);
    eventSource.on(event_types.CHATCOMPLETION_MODEL_CHANGED, refreshPanel);
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, refreshPanel);
    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, refreshPanel);
}

async function init() {
    getSettings();
    await buildPanel();
    injectDrawerButton();
    registerEventListeners();
    if (settings.ui.open) {
        showPanel();
    }
    log('ready');
}

jQuery(() => {
    init().catch(error => {
        console.error(`[${MODULE_NAME}] init failed`, error);
    });
});
