import { escapeHtml, formatMoney, getAdditionalCharges, getShopCartTotal, makeId, state } from '../state.js';
import { persistState } from '../storage.js';
import { setHash } from '../router.js';
import { showToast } from './toast.js';
import { confirmAction, openModal } from './modal.js';

const ACCESS_HASH = '7edc0bae3e9f99054d5fa31e97a57f2f2d4149ce30a271ebf6295faa4cc0ca71';
const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const PRIMARY_MODEL_TIMEOUT_MS = 75_000;
const FALLBACK_MODEL_TIMEOUT_MS = 20_000;
const AI_REQUEST_TIMEOUT_MS = 180_000;
const CHAT_MODELS = {
  openrouter: [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'poolside/laguna-s-2.1:free',
    'nvidia/nemotron-3.5-lightning:free',
    'dots-studio/dots-3-note-preview:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'apodex/apodex-1.1-mini:free',
    'thinkingmachines/inkling:free',
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'google/gemma-4-26b-a4b-it:free',
    'google/gemma-4-31b-it:free'
  ],
  groq: [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.8-27b'
  ]
};
const PROVIDER_NAMES = { openrouter: 'OpenRouter', groq: 'Groq Cloud API' };
const chatHistory = [];
let configuredProviders = {};
const aiPageSession = {
  goal: '',
  turns: [],
  labelAnimated: false
};

function restoreAiResponse(target) {
  const output = target.querySelector('[data-ai-response]');
  if (!output) return;

  output.innerHTML = aiPageSession.turns.map((turn, turnIndex) => `
    <article class="ai-chat-turn">
      <div class="ai-chat-user-bubble">${escapeHtml(turn.goal)}</div>
      ${turn.loading
        ? `<div class="ai-typing-bubble" role="status" aria-label="${escapeHtml(turn.loading)}"><span class="ai-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr-only">${escapeHtml(turn.loading)}</span></div>`
        : `<div class="ai-chat-assistant-bubble">${turn.responseHtml}</div>`}
    </article>
  `).join('');

  aiPageSession.turns.forEach((turn, turnIndex) => {
    output.querySelectorAll(`[data-ai-turn-index="${turnIndex}"][data-apply-ai-action]`).forEach((button) => {
      button.addEventListener('click', () => {
        applyAiAction(turn.responseData[Number(button.dataset.applyAiAction)], target, turnIndex);
      });
    });
    output.querySelector(`[data-ai-turn-index="${turnIndex}"][data-apply-ai-plan]`)?.addEventListener('click', () => {
      applyBudgetPlan(turn.responseData, target, turnIndex);
    });
  });

  output.querySelectorAll('[data-ai-attribution]').forEach((button) => {
    button.addEventListener('click', () => {
      openModal(`<p>${escapeHtml(button.dataset.aiAttribution)}</p>`, 'Response details');
    });
  });
}

function addAiTurn(target, goal, loading) {
  aiPageSession.turns.push({
    goal,
    loading,
    responseHtml: '',
    responseData: null
  });
  restoreAiResponse(target);
}

function saveAiResponse(target, html, data = null, turnIndex) {
  const index = Number.isInteger(turnIndex) ? turnIndex : aiPageSession.turns.length - 1;
  const turn = aiPageSession.turns[index];
  if (!turn) return;
  turn.loading = '';
  turn.responseHtml = html;
  turn.responseData = data;
  restoreAiResponse(target);
}

function saveAiResponseText(target, text, turnIndex) {
  saveAiResponse(target, `<div class="ai-message">${escapeHtml(text)}</div>`, null, turnIndex);
}

function configuredAi() {
  return state.settings.aiBudgeting || { enabled: false, consent: false, provider: 'openrouter', model: '' };
}

function defaultAiProxyUrl() {
  if (window.cordova?.platformId === 'android' || window.location.protocol === 'file:') return '';
  if (['http:', 'https:'].includes(window.location.protocol)) {
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return 'http://127.0.0.1:8002';
    return window.location.origin;
  }
  return '';
}

function resolveAiProxyUrl(configuredUrl = configuredAi().proxyUrl) {
  return String(configuredUrl || defaultAiProxyUrl()).trim().replace(/\/+$/, '');
}

function normalizeAiProxyUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a complete AI proxy URL, such as https://your-domain.example.');
  }
  const isLocalHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('AI proxy URLs must use HTTPS, except for localhost during development.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The AI proxy URL cannot include credentials, a query, or a fragment.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function proxyHeaders(accessToken = configuredAi().proxyAccessToken) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function defaultModel(provider) {
  return provider === 'groq' ? DEFAULT_GROQ_MODEL : DEFAULT_OPENROUTER_MODEL;
}

function configuredModelAttempts(provider, model) {
  const providers = [provider, ...Object.keys(CHAT_MODELS).filter((candidate) => candidate !== provider)];
  return providers
    .filter((candidate) => configuredProviders[candidate])
    .flatMap((candidate) => {
      const models = candidate === provider
        ? [model, ...CHAT_MODELS[candidate].filter((candidateModel) => candidateModel !== model)]
        : CHAT_MODELS[candidate];
      return models.map((candidateModel) => ({ provider: candidate, model: candidateModel }));
    });
}

function addFallbackContext(messages, failures) {
  if (!failures.length) return messages;
  const retryMessages = messages.map((message) => ({ ...message }));
  const recovery = failures.slice(-4).map((failure) => (
    `${failure.provider}/${failure.model}: ${failure.reason}`
    + (failure.response ? `; invalid response: ${failure.response}` : '')
  )).join('\n');
  const instruction = `\n\nFallback instruction: Continue the same request using the supplied data and prior conversation. Earlier models failed:\n${recovery}\nReturn a complete valid JSON object with a string "message" field and requested structured fields. In user-facing message text, express all money in Philippine pesos with ₱ and exactly two decimal places. Do not show centavo integers to the user.`;
  const systemMessage = retryMessages.find((message) => message.role === 'system');
  if (systemMessage) {
    systemMessage.content += instruction;
  } else {
    const lastUserMessage = [...retryMessages].reverse().find((message) => message.role === 'user');
    if (lastUserMessage) lastUserMessage.content += instruction;
  }
  return retryMessages;
}

async function requestWithFallback(aiSettings, messages, validateResponse = () => {}) {
  const attempts = configuredModelAttempts(aiSettings.provider, aiSettings.model);
  if (!attempts.length) throw new Error('No provider is configured on the AI proxy. Check the proxy address and provider keys.');
  const proxyUrl = resolveAiProxyUrl(aiSettings.proxyUrl);
  if (!proxyUrl) {
    throw new Error('Set the shared HTTPS AI proxy URL in AI privileges before sending a request from this device.');
  }

  const failures = [];
  const skippedProviders = new Set();
  const startedAt = Date.now();
  for (const [index, attempt] of attempts.entries()) {
    if (skippedProviders.has(attempt.provider)) continue;
    const remainingMs = AI_REQUEST_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    const remainingAttempts = attempts.slice(index)
      .filter((candidate) => !skippedProviders.has(candidate.provider)).length;
    const timeoutMs = index === 0
      ? Math.min(PRIMARY_MODEL_TIMEOUT_MS, remainingMs)
      : Math.min(FALLBACK_MODEL_TIMEOUT_MS, Math.max(1, Math.floor(remainingMs / remainingAttempts)));
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${proxyUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...proxyHeaders(aiSettings.proxyAccessToken) },
        body: JSON.stringify({
          provider: attempt.provider,
          model: attempt.model,
          messages: addFallbackContext(messages, failures),
          temperature: 0.3
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        failures.push({
          ...attempt,
          reason: `HTTP ${response.status}: ${detail.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')}`
        });
        if ([401, 402, 403].includes(response.status)) skippedProviders.add(attempt.provider);
        continue;
      }

      let result;
      try {
        result = await response.json();
      } catch {
        failures.push({ ...attempt, reason: 'provider returned invalid JSON' });
        continue;
      }
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        failures.push({ ...attempt, reason: 'provider returned an empty answer' });
        continue;
      }
      try {
        const parsed = extractJson(content);
        validateResponse(parsed);
        return {
          parsed,
          content,
          provider: attempt.provider,
          model: attempt.model,
          attempts: failures.length + 1
        };
      } catch (error) {
        failures.push({
          ...attempt,
          reason: error.message || 'provider response was not valid budgeting JSON',
          response: content.slice(0, 500)
        });
      }
    } catch (error) {
      failures.push({
        ...attempt,
        reason: error.name === 'AbortError' ? 'model request timed out' : 'unable to reach the proxy or provider'
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  const attempted = failures.map((failure) => `${PROVIDER_NAMES[failure.provider]}/${failure.model}`);
  const recentFailures = failures.slice(-3).map((failure) => failure.reason).join('; ');
  throw new Error(
    `No available model returned a valid response after trying ${attempted.length} model${attempted.length === 1 ? '' : 's'}`
    + `${attempted.length ? ` (${attempted.join(', ')})` : ''}.`
    + `${recentFailures ? ` Last errors: ${recentFailures}` : ' The retry time limit was reached.'}`
  );
}

async function refreshProxyProviders(statusElement, configuredUrl, accessToken = configuredAi().proxyAccessToken) {
  const proxyUrl = resolveAiProxyUrl(configuredUrl);
  if (!proxyUrl) {
    configuredProviders = {};
    updateProxyStatus(statusElement, 'Set a shared HTTPS AI proxy URL in AI privileges to use AI on this device.', false);
    return configuredProviders;
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${proxyUrl}/api/providers`, {
      headers: proxyHeaders(accessToken),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI proxy returned ${response.status}.`);
    const result = await response.json();
    if (!result.providers || typeof result.providers !== 'object') {
      throw new Error('Local AI proxy returned invalid provider status.');
    }
    configuredProviders = {
      openrouter: result.providers.openrouter === true,
      groq: result.providers.groq === true
    };
    updateProxyStatus(
      statusElement,
      configuredProviders.openrouter || configuredProviders.groq
        ? 'Local AI proxy connected. Provider availability is checked below.'
        : 'Local AI proxy is running, but neither provider API key is configured. Add a key to .env next to package.json, then restart npm run ai-proxy.',
      configuredProviders.openrouter || configuredProviders.groq
    );
    return configuredProviders;
  } catch (error) {
    configuredProviders = {};
    updateProxyStatus(
      statusElement,
      `Unable to reach the AI proxy at ${proxyUrl}: ${error.message || 'connection failed'}. On web development, start npm run ai-proxy. For an APK or other devices, configure a shared HTTPS AI proxy URL and allow this app's origin.`,
      false
    );
    return configuredProviders;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function updateProxyStatus(statusElement, message, connected) {
  if (!statusElement) return;
  if (!statusElement.matches('[data-ai-proxy-indicator]')) {
    statusElement.textContent = message;
    return;
  }
  statusElement.dataset.statusText = message;
  statusElement.classList.toggle('is-connected', connected);
  statusElement.classList.toggle('is-disconnected', !connected);
  statusElement.classList.remove('is-checking');
  statusElement.setAttribute('aria-label', `AI proxy ${connected ? 'connected' : 'not connected'}. Click to view details.`);
  statusElement.title = connected ? 'AI proxy connected. View details.' : 'AI proxy not connected. View details.';
}

async function hashAccessCode(value) {
  const bytes = new TextEncoder().encode(`SalaryWise-AI-privileges:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function openAiPrivileges() {
  const modal = openModal(`
    <form class="form-grid" data-ai-access-form>
      <p class="modal-help">Unlock AI provider settings. This is a local app gate, not account authentication.</p>
      <div class="input-group">
        <label for="ai-access-code">Password</label>
        <input id="ai-access-code" name="password" type="password" autocomplete="current-password" required />
      </div>
      <button class="primary-btn" type="submit">Continue</button>
    </form>
  `, 'AI privileges');
  if (!modal) return;

  modal.querySelector('[data-ai-access-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = event.currentTarget.elements.password.value;
    try {
      if (await hashAccessCode(password) !== ACCESS_HASH) {
        showToast('Incorrect password.', 'error');
        return;
      }
      modal.remove();
      openAiConfiguration();
    } catch (error) {
      showToast(error.message || 'Unable to verify the password on this device.', 'error');
    }
  });
}

function openAiConfiguration() {
  const ai = configuredAi();
  const initialModel = ai.model || defaultModel(ai.provider);
  const initialProxyUrl = ai.proxyUrl || defaultAiProxyUrl();
  const modal = openModal(`
    <form class="form-grid" data-ai-config-form>
      <div class="warning-banner">
        The agent sends selected salary, fund, shop-product, and transaction data to the provider you choose.
        Provider keys stay on the AI proxy server and are never included in the app.
      </div>
      <div class="input-group">
        <label for="ai-proxy-url">AI proxy URL</label>
        <input id="ai-proxy-url" name="proxyUrl" type="url" maxlength="300" value="${escapeHtml(initialProxyUrl)}" placeholder="https://your-secure-proxy.example" autocomplete="url" />
        <small class="allocation-help">Web development can use the local proxy automatically. For an APK or other devices, enter your deployed HTTPS proxy address.</small>
      </div>
      <div class="input-group">
        <label for="ai-proxy-token">AI proxy access token (if required)</label>
        <input id="ai-proxy-token" name="proxyAccessToken" type="password" maxlength="300" value="${escapeHtml(ai.proxyAccessToken || '')}" autocomplete="off" />
        <small class="allocation-help">Optional. This is the access token configured on your proxy server, not an OpenRouter or Groq API key.</small>
      </div>
      <div class="input-group">
        <label for="ai-provider">Provider</label>
        <select id="ai-provider" name="provider">
          <option value="openrouter" ${ai.provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
          <option value="groq" ${ai.provider === 'groq' ? 'selected' : ''}>Groq Cloud API</option>
        </select>
      </div>
      <div class="input-group">
        <label for="ai-model">Model name (or enter a custom model ID)</label>
        <div class="model-picker">
          <div class="model-picker-controls">
            <input id="ai-model" name="model" type="text" maxlength="160" value="${escapeHtml(initialModel)}" placeholder="Choose a listed model or type a custom model ID" required />
            <button type="button" class="model-picker-toggle" data-toggle-model-list aria-expanded="false" aria-controls="ai-model-options">Models <span aria-hidden="true">▾</span></button>
          </div>
          <div id="ai-model-options" class="model-picker-options hidden" role="listbox" aria-label="Available chat models"></div>
        </div>
        <small class="allocation-help">Only listed models intended for text chat are shown. If a model is unavailable or rate-limited, SalaryWise tries the other configured chat models and then the other provider.</small>
      </div>
      <p class="allocation-help" data-ai-proxy-status aria-live="polite">Checking AI proxy…</p>
      <label class="row budget-toggle">
        <input name="consent" type="checkbox" ${ai.consent ? 'checked' : ''} required />
        I agree that my budgeting data will be sent to this provider when I ask the AI agent.
      </label>
      <label class="row budget-toggle">
        <input name="enabled" type="checkbox" ${ai.enabled ? 'checked' : ''} />
        Enable the AI budgeting agent
      </label>
      <div class="button-row">
        <button type="button" class="secondary-btn" data-cancel-ai-config>Cancel</button>
        <button type="submit" class="primary-btn">Save AI privileges</button>
      </div>
    </form>
  `, 'AI provider settings');
  if (!modal) return;

  modal.querySelector('[data-cancel-ai-config]').addEventListener('click', () => modal.remove());
  const providerInput = modal.querySelector('#ai-provider');
  const proxyUrlInput = modal.querySelector('#ai-proxy-url');
  const proxyTokenInput = modal.querySelector('#ai-proxy-token');
  const modelInput = modal.querySelector('#ai-model');
  const modelOptions = modal.querySelector('#ai-model-options');
  const modelToggle = modal.querySelector('[data-toggle-model-list]');
  const providerStatus = modal.querySelector('[data-ai-proxy-status]');
  const setModelListOpen = (isOpen) => {
    modelOptions.classList.toggle('hidden', !isOpen);
    modelToggle.setAttribute('aria-expanded', String(isOpen));
  };
  const updateModelOptions = (useProviderDefault = false) => {
    const models = CHAT_MODELS[providerInput.value];
    modelOptions.innerHTML = models
      .map((model) => `<button type="button" class="model-picker-option" role="option" data-model-option="${escapeHtml(model)}">${escapeHtml(model)}</button>`)
      .join('');
    setModelListOpen(false);
    if (useProviderDefault) modelInput.value = defaultModel(providerInput.value);
  };
  updateModelOptions();
  modelToggle.addEventListener('click', () => {
    setModelListOpen(modelOptions.classList.contains('hidden'));
  });
  modelOptions.addEventListener('click', (event) => {
    const option = event.target.closest('[data-model-option]');
    if (!option) return;
    modelInput.value = option.dataset.modelOption;
    setModelListOpen(false);
    modelInput.focus();
  });
  modal.addEventListener('click', (event) => {
    if (!event.target.closest('.model-picker')) setModelListOpen(false);
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modelOptions.classList.contains('hidden')) {
      setModelListOpen(false);
      modelToggle.focus();
    }
  });
  const checkProxyProviders = () => refreshProxyProviders(
    providerStatus,
    resolveAiProxyUrl(proxyUrlInput.value),
    proxyTokenInput.value
  ).then(showProviderStatus);
  const showProviderStatus = () => {
    if (!Object.keys(configuredProviders).length) return;
    if (!Object.values(configuredProviders).some(Boolean)) {
      providerStatus.textContent = 'The AI proxy is reachable, but neither provider API key is configured on its server.';
      return;
    }
    const providerName = providerInput.value === 'groq' ? 'Groq Cloud API' : 'OpenRouter';
    const configured = configuredProviders[providerInput.value];
    providerStatus.textContent = configured
      ? `${providerName} is configured on the AI proxy. Other configured chat models/providers are tried automatically if a model is unavailable.`
      : Object.values(configuredProviders).some(Boolean)
        ? `${providerName} is not configured on the proxy. AI requests can use the other configured provider and its chat models.`
        : `${providerName} is not configured on the proxy server.`;
  };
  checkProxyProviders().then(showProviderStatus);
  providerInput.addEventListener('change', () => {
    updateModelOptions(true);
    showProviderStatus();
  });
  proxyUrlInput.addEventListener('change', checkProxyProviders);
  proxyTokenInput.addEventListener('change', checkProxyProviders);
  modal.querySelector('[data-ai-config-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const provider = form.elements.provider.value;
    const model = form.elements.model.value.trim();
    const consent = form.elements.consent.checked;
    const enabled = form.elements.enabled.checked;
    let proxyUrl;
    try {
      proxyUrl = normalizeAiProxyUrl(form.elements.proxyUrl.value);
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }
    const proxyAccessToken = form.elements.proxyAccessToken.value.trim();
    if (!model || (enabled && !consent)) {
      showToast('Add a model and accept the data-sharing notice to enable AI.', 'error');
      return;
    }
    try {
      await persistState({
        ...state,
        settings: {
          ...state.settings,
          aiBudgeting: { enabled, consent, provider, model, proxyUrl, proxyAccessToken }
        }
      });
      modal.remove();
      showToast(enabled ? 'AI privileges saved' : 'AI budgeting disabled');
    } catch (error) {
      showToast(error.message || 'Unable to save AI privileges.', 'error');
    }
  });
}

function collectBudgetData() {
  const now = new Date();
  const monthlyTransactions = (state.transactions || []).filter((transaction) => {
    const date = new Date(transaction.timestamp);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const spendingTransactions = monthlyTransactions.filter((transaction) => !['fund-transfer', 'fund-removal'].includes(transaction.kind)
    && !(transaction.items || []).some((item) => item.source === 'adjustment' || item.source === 'automatic-cashin'));
  const spendingByType = { Grocery: 0, Merchandise: 0, Medicine: 0, Other: 0 };
  spendingTransactions.forEach((transaction) => {
    (transaction.items || []).forEach((item) => {
      const category = Object.prototype.hasOwnProperty.call(spendingByType, item.type) ? item.type : 'Other';
      spendingByType[category] += Number(item.price || 0) * Number(item.qty || 0);
    });
  });

  return {
    currency: { code: 'PHP', symbol: '₱', centavosPerPeso: 100 },
    currentSalaryBalance: Number(state.user?.salaryBalance || 0),
    shopBudget: state.user?.shopBudget || { enabled: false, limit: 0, spent: 0 },
    availableToSpend: state.user?.shopBudget?.enabled
      ? Math.max(0, Number(state.user.shopBudget.limit || 0) - Number(state.user.shopBudget.spent || 0))
      : Number(state.user?.salaryBalance || 0),
    salaryPortions: state.funds.map((fund) => ({ id: fund.id, name: fund.name, balance: Number(fund.balance || 0) })),
    productsInShop: state.products.map((product) => ({
      name: product.name,
      type: product.type,
      store: product.store,
      price: Number(product.price || 0)
    })),
    spentThisMonth: spendingTransactions.reduce((sum, transaction) => sum + Number(transaction.total || 0), 0),
    checkoutsThisMonth: spendingTransactions.filter((transaction) => !['manual-expense', 'fund-expense'].includes(transaction.kind)).length,
    spendingByType,
    transactionLogs: (state.transactions || []).slice(0, 100).map((transaction) => ({
      date: transaction.timestamp,
      kind: transaction.kind || 'checkout',
      total: Number(transaction.total || 0),
      reason: transaction.reason || '',
      items: (transaction.items || []).map((item) => ({
        name: item.name,
        type: item.type,
        price: Number(item.price || 0),
        quantity: Number(item.qty || 0)
      }))
    }))
  };
}

function extractJson(content) {
  const clean = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The selected model did not return the required JSON response. Try another model.');
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.message !== 'string') {
    throw new Error('The selected model returned an incomplete response.');
  }
  return parsed;
}

function validateActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 5).filter((action) => {
    if (!action || typeof action !== 'object') return false;
    if (action.type === 'transfer') {
      const sources = ['salary', ...state.funds.map((fund) => fund.id)];
      const destinations = ['salary', ...state.funds.map((fund) => fund.id)];
      return sources.includes(action.from)
        && destinations.includes(action.to)
        && action.from !== action.to
        && Number.isSafeInteger(action.amountCents)
        && action.amountCents > 0;
    }
    return action.type === 'shop-budget'
      && typeof action.enabled === 'boolean'
      && Number.isSafeInteger(action.limitCents)
      && action.limitCents >= 0;
  });
}

function validateBudgetPlan(plan) {
  if (plan?.feasible !== true) {
    throw new Error('The AI plan did not confirm that its proposed budget is feasible.');
  }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.transfers) || plan.transfers.length > 10) {
    throw new Error('The AI did not return a complete, valid salary plan. Please try again.');
  }
  if (!plan.shopBudget || plan.shopBudget.enabled !== true || !Number.isSafeInteger(plan.shopBudget.limitCents)) {
    throw new Error('The AI plan must include a valid Shop spending limit. Please try again.');
  }

  const balances = new Map([
    ['salary', Number(state.user?.salaryBalance || 0)],
    ...state.funds.map((fund) => [fund.id, Number(fund.balance || 0)])
  ]);
  const transfers = [];
  for (const transfer of plan.transfers) {
    if (!transfer || typeof transfer !== 'object'
      || !balances.has(transfer.from) || !balances.has(transfer.to)
      || transfer.from === transfer.to
      || !Number.isSafeInteger(transfer.amountCents) || transfer.amountCents <= 0) {
      throw new Error('The AI plan contains an invalid transfer. No changes were made.');
    }
    const sourceBalance = balances.get(transfer.from);
    const destinationBalance = balances.get(transfer.to);
    if (transfer.amountCents > sourceBalance
      || !Number.isSafeInteger(destinationBalance + transfer.amountCents)) {
      throw new Error('The AI plan transfers more than an available balance. No changes were made.');
    }
    balances.set(transfer.from, sourceBalance - transfer.amountCents);
    balances.set(transfer.to, destinationBalance + transfer.amountCents);
    transfers.push({
      from: transfer.from,
      to: transfer.to,
      amountCents: transfer.amountCents,
      reason: String(transfer.reason || 'AI salary allocation').slice(0, 120)
    });
  }

  const monthlySpent = Math.max(0, Number(state.user?.shopBudget?.spent || 0));
  const currentShopCart = getShopCartTotal() + getAdditionalCharges('shop');
  if (plan.shopBudget.limitCents < monthlySpent) {
    throw new Error('The proposed Shop limit is below this month’s spending. No changes were made.');
  }
  if (plan.shopBudget.limitCents - monthlySpent < currentShopCart) {
    throw new Error('The proposed Shop limit does not cover your current cart. No changes were made.');
  }
  if (plan.shopBudget.limitCents - monthlySpent > balances.get('salary')) {
    throw new Error('The proposed Shop limit exceeds the salary left after the transfers. No changes were made.');
  }

  return { transfers, shopBudget: { enabled: true, limitCents: plan.shopBudget.limitCents } };
}

function validateBudgetPlanResponse(parsed) {
  const plan = parsed.plan;
  if (plan?.feasible === false) {
    if (!Array.isArray(plan.transfers) || plan.transfers.length
      || plan.shopBudget?.enabled !== false
      || !Number.isSafeInteger(plan.shopBudget.limitCents)
      || plan.shopBudget.limitCents < 0) {
      throw new Error('The model returned an invalid infeasible-plan response.');
    }
    return;
  }
  validateBudgetPlan(plan);
}

function renderProviderNote(metadata) {
  const attribution = `Answered by ${PROVIDER_NAMES[metadata.provider] || metadata.provider} using ${metadata.model}${metadata.attempts > 1 ? ` after ${metadata.attempts - 1} fallback attempt${metadata.attempts === 2 ? '' : 's'}` : ''}.`;
  return `<button type="button" class="ai-provider-note" data-ai-attribution="${escapeHtml(attribution)}">Model</button>`;
}

function renderResponse(target, parsed, metadata) {
  const safeMessage = escapeHtml(String(parsed.message || 'Budgeting suggestions are ready.'));
  const actions = validateActions(parsed.actions);
  const actionHtml = actions.map((action, index) => {
    const description = action.type === 'transfer'
      ? `Transfer ${formatMoney(action.amountCents)} from ${escapeHtml(action.from === 'salary' ? 'Current salary balance' : state.funds.find((fund) => fund.id === action.from)?.name || 'portion')} to ${escapeHtml(action.to === 'salary' ? 'Current salary balance' : state.funds.find((fund) => fund.id === action.to)?.name || 'portion')}`
      : `${action.enabled ? 'Set' : 'Disable'} Shop budget${action.enabled ? ` to ${formatMoney(action.limitCents)}` : ''}`;
    return `<div class="ai-action"><span>${description}</span><button type="button" class="secondary-btn" data-ai-turn-index="${aiPageSession.turns.length - 1}" data-apply-ai-action="${index}">Review and apply</button></div>`;
  }).join('');

  saveAiResponse(target, `<div class="ai-message">${safeMessage}</div>${actionHtml}${renderProviderNote(metadata)}`, actions);
}

function renderBudgetPlan(target, parsed, metadata) {
  if (parsed.plan?.feasible === false || parsed.plan?.shopBudget?.enabled === false) {
    const plan = parsed.plan;
    validateBudgetPlanResponse(parsed);
    saveAiResponse(target, `
      <div class="ai-message">${escapeHtml(String(parsed.message || 'A safe salary plan is not possible with the current balances.'))}</div>
      <div class="ai-message"><strong>No changes were made.</strong> Review the explanation, add available salary or adjust your current cart, then try again.</div>
      ${renderProviderNote(metadata)}
    `);
    return;
  }
  const plan = validateBudgetPlan(parsed.plan);
  const transferItems = plan.transfers.length
    ? plan.transfers.map((transfer) => {
      const fromName = transfer.from === 'salary'
        ? 'Current salary balance'
        : state.funds.find((fund) => fund.id === transfer.from).name;
      const toName = transfer.to === 'salary'
        ? 'Current salary balance'
        : state.funds.find((fund) => fund.id === transfer.to).name;
      const salaryPercentage = transfer.from === 'salary' && Number(state.user.salaryBalance) > 0
        ? ` (${((transfer.amountCents / Number(state.user.salaryBalance)) * 100).toFixed(1)}% of current salary)`
        : '';
      return `<li>Move ${formatMoney(transfer.amountCents)} from ${escapeHtml(fromName)} to ${escapeHtml(toName)}${salaryPercentage}${transfer.reason ? ` — ${escapeHtml(transfer.reason)}` : ''}</li>`;
    }).join('')
    : '<li>No salary transfers recommended.</li>';
  const safeMessage = escapeHtml(String(parsed.message || 'Review this proposed salary plan before applying it.'));
  saveAiResponse(target, `
    <div class="ai-message">${safeMessage}</div>
    <div class="ai-message">
      <strong>Proposed salary plan</strong>
      <ul>${transferItems}</ul>
      <p>Shop spending limit: ${formatMoney(plan.shopBudget.limitCents)}</p>
      <p>This plan does not change anything until you review and confirm it.</p>
      <button type="button" class="secondary-btn" data-ai-turn-index="${aiPageSession.turns.length - 1}" data-apply-ai-plan>Review and apply complete plan</button>
    </div>
  ${renderProviderNote(metadata)}`, plan);
}

async function applyBudgetPlan(plan, target, turnIndex) {
  let checkedPlan;
  try {
    checkedPlan = validateBudgetPlan(plan);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }

  const transferSummary = checkedPlan.transfers.length
    ? checkedPlan.transfers.map((transfer) => {
      const fromName = transfer.from === 'salary'
        ? 'Current salary balance'
        : state.funds.find((fund) => fund.id === transfer.from)?.name || 'portion';
      const toName = transfer.to === 'salary'
        ? 'Current salary balance'
        : state.funds.find((fund) => fund.id === transfer.to)?.name || 'portion';
      return `${formatMoney(transfer.amountCents)} from ${escapeHtml(fromName)} to ${escapeHtml(toName)}`;
    }).join('<br>')
    : 'No salary transfers';
  confirmAction(
    'Review complete salary plan',
    `${transferSummary}<br>Set Shop spending limit to ${formatMoney(checkedPlan.shopBudget.limitCents)}?`,
    async () => {
      try {
        checkedPlan = validateBudgetPlan(plan);
      } catch (error) {
        showToast(error.message, 'error');
        return;
      }
      const fundBalances = new Map(state.funds.map((fund) => [fund.id, Number(fund.balance || 0)]));
      let salaryBalance = Number(state.user.salaryBalance || 0);
      const transactions = checkedPlan.transfers.map((transfer, index) => {
        const salaryBefore = salaryBalance;
        const sourceBefore = transfer.from === 'salary' ? salaryBalance : fundBalances.get(transfer.from);
        const destinationBefore = transfer.to === 'salary' ? salaryBalance : fundBalances.get(transfer.to);
        if (transfer.from === 'salary') salaryBalance -= transfer.amountCents;
        else fundBalances.set(transfer.from, sourceBefore - transfer.amountCents);
        if (transfer.to === 'salary') salaryBalance += transfer.amountCents;
        else fundBalances.set(transfer.to, destinationBefore + transfer.amountCents);
        const sourceAfter = transfer.from === 'salary' ? salaryBalance : fundBalances.get(transfer.from);
        const destinationAfter = transfer.to === 'salary' ? salaryBalance : fundBalances.get(transfer.to);
        const fromName = transfer.from === 'salary'
          ? 'Current salary balance'
          : state.funds.find((fund) => fund.id === transfer.from).name;
        const toName = transfer.to === 'salary'
          ? 'Current salary balance'
          : state.funds.find((fund) => fund.id === transfer.to).name;
        return {
          id: makeId('ai-plan-transfer'),
          timestamp: new Date(Date.now() + index).toISOString(),
          kind: 'fund-transfer',
          reason: transfer.reason,
          from: fromName,
          to: toName,
          total: transfer.amountCents,
          items: [],
          balanceBefore: salaryBefore,
          balanceAfter: salaryBalance,
          sourceBalanceBefore: sourceBefore,
          sourceBalanceAfter: sourceAfter,
          destinationBalanceBefore: destinationBefore,
          destinationBalanceAfter: destinationAfter
        };
      });
      const nextUser = {
        ...state.user,
        salaryBalance,
        shopBudget: {
          enabled: true,
          limit: checkedPlan.shopBudget.limitCents,
          spent: Number(state.user.shopBudget?.spent || 0)
        }
      };
      const nextFunds = state.funds.map((fund) => ({ ...fund, balance: fundBalances.get(fund.id) }));
      try {
        await persistState({
          ...state,
          user: nextUser,
          funds: nextFunds,
          transactions: [...transactions.reverse(), ...state.transactions]
        });
        saveAiResponseText(target, 'The approved salary plan has been applied.', turnIndex);
        renderAiBudgetingPage(target);
        showToast('Approved salary plan applied');
      } catch (error) {
        showToast(error.message || 'Unable to apply the approved salary plan.', 'error');
      }
    }
  );
}

async function applyAiAction(action, target, turnIndex) {
  if (action.type === 'transfer') {
    const source = action.from === 'salary' ? null : state.funds.find((fund) => fund.id === action.from);
    const destination = action.to === 'salary' ? null : state.funds.find((fund) => fund.id === action.to);
    const sourceBalance = source ? Number(source.balance || 0) : Number(state.user.salaryBalance || 0);
    if ((action.from !== 'salary' && !source) || (action.to !== 'salary' && !destination) || action.amountCents > sourceBalance) {
      showToast('The balances changed or the suggested transfer is no longer valid.', 'error');
      return;
    }
    const fromName = source ? source.name : 'Current salary balance';
    const toName = destination ? destination.name : 'Current salary balance';
    confirmAction('Review AI transfer', `Transfer ${formatMoney(action.amountCents)} from ${escapeHtml(fromName)} to ${escapeHtml(toName)}?`, async () => {
      let nextUser = state.user;
      const nextFunds = state.funds.map((fund) => {
        if (source && fund.id === source.id) return { ...fund, balance: Number(fund.balance || 0) - action.amountCents };
        if (destination && fund.id === destination.id) return { ...fund, balance: Number(fund.balance || 0) + action.amountCents };
        return fund;
      });
      if (!source) nextUser = { ...state.user, salaryBalance: Number(state.user.salaryBalance || 0) - action.amountCents };
      if (!destination) nextUser = { ...nextUser, salaryBalance: Number(nextUser.salaryBalance || 0) + action.amountCents };
      const transaction = {
        id: makeId('ai-transfer'),
        timestamp: new Date().toISOString(),
        kind: 'fund-transfer',
        reason: String(action.reason || 'AI budgeting transfer').slice(0, 120),
        from: fromName,
        to: toName,
        total: action.amountCents,
        items: [],
        balanceBefore: Number(state.user.salaryBalance || 0),
        balanceAfter: Number(nextUser.salaryBalance || 0),
        sourceBalanceBefore: sourceBalance,
        sourceBalanceAfter: sourceBalance - action.amountCents,
        destinationBalanceBefore: destination
          ? Number(destination.balance || 0)
          : Number(state.user.salaryBalance || 0),
        destinationBalanceAfter: (destination
          ? Number(destination.balance || 0)
          : Number(state.user.salaryBalance || 0)) + action.amountCents
      };
      try {
        await persistState({ ...state, user: nextUser, funds: nextFunds, transactions: [transaction, ...state.transactions] });
        saveAiResponseText(target, 'The approved transfer has been applied.', turnIndex);
        renderAiBudgetingPage(target);
        showToast('Approved transfer applied');
      } catch (error) {
        showToast(error.message || 'Unable to apply the approved transfer.', 'error');
      }
    });
    return;
  }

  const spent = Number(state.user.shopBudget?.spent || 0);
  if (action.enabled && action.limitCents < spent) {
    showToast('The proposed limit is below the amount already spent this month.', 'error');
    return;
  }
  confirmAction('Review Shop budget', `${action.enabled ? `Set the Shop budget to ${formatMoney(action.limitCents)}` : 'Disable the Shop budget'}?`, async () => {
    const nextUser = {
      ...state.user,
      shopBudget: {
        enabled: action.enabled,
        limit: action.enabled ? action.limitCents : 0,
        spent
      }
    };
    try {
      await persistState({ ...state, user: nextUser });
      saveAiResponseText(target, 'The approved Shop budget change has been applied.', turnIndex);
      renderAiBudgetingPage(target);
      showToast('Approved Shop budget updated');
    } catch (error) {
      showToast(error.message || 'Unable to apply the approved budget change.', 'error');
    }
  });
}

export function renderAiBudgetingPage(target) {
  const ai = configuredAi();
  if (!state.user) {
    target.innerHTML = '<div class="empty-state">No user profile data found.</div>';
    return;
  }

  const animateLabel = !aiPageSession.labelAnimated;
  aiPageSession.labelAnimated = true;
  target.innerHTML = `
    <div class="page">
      <div class="page-header">
        <button type="button" class="secondary-btn" data-ai-back>← Profile</button>
        <h2>AI Budgeting Agent</h2>
      </div>
      <section class="summary-grid ai-summary-grid">
        <div class="summary-card"><div class="eyebrow">Current salary balance</div><div class="summary-value">${formatMoney(Number(state.user.salaryBalance || 0))}</div></div>
        <div class="summary-card"><div class="eyebrow">Spent this month</div><div class="summary-value">${formatMoney(collectBudgetData().spentThisMonth)}</div></div>
        <div class="summary-card"><div class="eyebrow">Available to spend</div><div class="summary-value">${formatMoney(collectBudgetData().availableToSpend)}</div></div>
      </section>
      <section class="card ai-chat-card">
        ${!ai.enabled || !ai.consent ? '<p class="allocation-help">AI budgeting is not enabled. Configure it in Profile → Settings → AI Privileges.</p>' : ''}
        <button type="button" class="ai-proxy-indicator is-checking" data-ai-proxy-status data-ai-proxy-indicator data-status-text="Checking AI proxy…" aria-label="Checking AI proxy status" title="Checking AI proxy status"><span class="ai-proxy-status-dot" aria-hidden="true"></span><span class="sr-only">View AI proxy status</span></button>
        <form class="form-grid" data-ai-prompt-form>
          <div class="input-group">
            <label for="ai-budget-goal"><span class="${animateLabel ? 'ai-typing-label' : ''}">What budgeting help do you need?</span></label>
            <div class="ai-response" data-ai-response aria-live="polite" aria-relevant="additions text"></div>
            <textarea id="ai-budget-goal" name="goal" rows="4" maxlength="1200" placeholder="For example: help me divide my remaining salary between savings and groceries." required>${escapeHtml(aiPageSession.goal)}</textarea>
          </div>
          <button type="submit" class="primary-btn" data-ai-submit name="intent" value="advice" ${!ai.enabled || !ai.consent || !configuredProviders[ai.provider] ? 'disabled' : ''}>Ask AI</button>
          <button type="submit" class="secondary-btn" data-ai-manage name="intent" value="full-plan" formnovalidate ${!ai.enabled || !ai.consent || !configuredProviders[ai.provider] ? 'disabled' : ''}>Let AI agent budget your salary for you</button>
        </form>
      </section>
      <p class="allocation-help ai-data-notice">Your balances change only after you review and approve a suggested action.</p>
    </div>
  `;

  target.querySelector('[data-ai-back]').addEventListener('click', () => setHash('#/profile'));
  target.querySelector('#ai-budget-goal').addEventListener('input', (event) => {
    aiPageSession.goal = event.currentTarget.value;
  });
  target.querySelector('[data-ai-proxy-indicator]').addEventListener('click', (event) => {
    const message = event.currentTarget.dataset.statusText || 'AI proxy status is not available yet.';
    openModal(`<p>${escapeHtml(message)}</p>`, 'AI proxy status');
  });
  restoreAiResponse(target);
  const providerStatus = target.querySelector('[data-ai-proxy-status]');
  refreshProxyProviders(providerStatus).then((providers) => {
    target.querySelectorAll('[data-ai-submit], [data-ai-manage]').forEach((button) => {
      button.disabled = !ai.enabled || !ai.consent || !Object.values(providers).some(Boolean);
    });
  });
  target.querySelector('[data-ai-prompt-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fullPlan = event.submitter?.value === 'full-plan';
    const aiSettings = configuredAi();
    if (!aiSettings.enabled || !aiSettings.consent) {
      showToast('Enable AI and accept the data-sharing notice in AI Privileges first.', 'error');
      return;
    }
    if (!Object.values(configuredProviders).some(Boolean)) {
      configuredProviders = await refreshProxyProviders(providerStatus);
      if (!Object.values(configuredProviders).some(Boolean)) {
        showToast('No AI provider is configured on the AI proxy. Check the proxy address and server provider keys.', 'error');
        return;
      }
    }

    const goal = form.elements.goal.value.trim();
    if (!fullPlan && !goal) return;
    aiPageSession.goal = '';
    form.elements.goal.value = '';
    const submitButtons = form.querySelectorAll('[data-ai-submit], [data-ai-manage]');
    submitButtons.forEach((button) => { button.disabled = true; });
    addAiTurn(
      target,
      fullPlan ? 'Create a careful salary budget for me.' : goal,
      fullPlan ? 'Preparing a careful salary plan.' : 'Thinking through your budgeting question.'
    );
    try {
      const context = collectBudgetData();
      const currencyGuidance = 'You are a careful Philippine personal budgeting assistant. Use only supplied data; never invent salary, expenses, portions, or prices. All input amounts and structured action amounts are integer centavos (PHP), where 100 centavos = ₱1.00. Check all calculations in centavos, but express every user-facing money amount in Philippine pesos using ₱ and exactly two decimal places. Never show centavo integers in user-facing text. Explain recommendations using actual balances, spending and needs, identify uncertainty, and use conservative assumptions.';
      const planInstructions = `${currencyGuidance} Create the most practical complete salary plan possible based on the user’s actual balance and spending pattern. Prioritize daily essentials, upcoming known needs and a realistic emergency cash buffer. Suggest measured percentage allocations only to portions that exist; explain why each percentage and peso amount is appropriate. Preserve existing balances unless a justified transfer is needed. A feasible plan sets an enabled Shop limit at least equal to month-to-date Shop spending plus current cart charges, and no more than that spending plus salary remaining after transfers. If that is impossible, return feasible:false, no transfers and disabled limit, explaining why. Use only existing portion IDs. Return only valid JSON: {"message":"accurate explanation and rationale in PHP pesos","plan":{"feasible":boolean,"transfers":[{"from":"salary or supplied portion id","to":"salary or supplied portion id","amountCents":integer,"reason":"specific, accurate rationale"}],"shopBudget":{"enabled":boolean,"limitCents":integer}}}. Each transfer must be positive and affordable in sequence; maximum 10 transfers. feasible:false requires no transfers and shopBudget.enabled=false; feasible:true requires shopBudget.enabled=true. Never claim a change has been applied. The complete plan will be reviewed before any change.`;
      const userMessage = JSON.stringify({
        goal: fullPlan
          ? 'Prepare my complete, careful salary allocation plan and shop limit for daily life.'
          : goal,
        budgetData: {
          ...context,
          currentShopCartCents: getShopCartTotal() + getAdditionalCharges('shop')
        }
      });
      const messages = [
        {
          role: 'system',
          content: fullPlan
            ? planInstructions
            : `${currencyGuidance} Return only valid JSON with shape {"message":"accurate concise advice in PHP pesos","actions":[]}. Allowed actions are {"type":"transfer","from":"salary or a supplied portion id","to":"salary or a supplied portion id","amountCents":integer,"reason":"short reason"} and {"type":"shop-budget","enabled":boolean,"limitCents":integer,"reason":"short reason"}. Never claim an action was applied. Suggest at most 5 affordable actions and explain the trade-offs.`
        },
        ...(fullPlan ? [] : chatHistory.slice(-6)),
        { role: 'user', content: userMessage }
      ];
      const result = await requestWithFallback(
        { ...aiSettings, model: aiSettings.model || defaultModel(aiSettings.provider) },
        messages,
        fullPlan ? validateBudgetPlanResponse : undefined
      );
      const metadata = { provider: result.provider, model: result.model, attempts: result.attempts };
      if (fullPlan) {
        renderBudgetPlan(target, result.parsed, metadata);
      } else {
        chatHistory.push({ role: 'user', content: userMessage }, { role: 'assistant', content: result.content });
        renderResponse(target, result.parsed, metadata);
      }
    } catch (error) {
      saveAiResponseText(target, error.message || 'Unable to get budgeting suggestions.');
    } finally {
      const providerReady = Object.values(configuredProviders).some(Boolean);
      submitButtons.forEach((button) => {
        button.disabled = !aiSettings.enabled || !aiSettings.consent || !providerReady;
      });
    }
  });
}
