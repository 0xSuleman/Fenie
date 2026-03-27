/**
 * Settings Page Controller — Manages API key, model selection, and defaults.
 */

(() => {
  'use strict';

  const apiKeyInput = document.getElementById('apiKey');
  const toggleBtn = document.getElementById('toggleApiKey');
  const modelSelect = document.getElementById('modelSelect');
  const defaultRisk = document.getElementById('defaultRisk');
  const defaultLeverage = document.getElementById('defaultLeverage');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');

  // ── Load saved settings ──

  chrome.storage.sync.get(
    ['geminiApiKey', 'geminiModel', 'defaultRisk', 'defaultLeverage'],
    (result) => {
      if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
      if (result.geminiModel) modelSelect.value = result.geminiModel;
      if (result.defaultRisk) defaultRisk.value = result.defaultRisk;
      if (result.defaultLeverage) defaultLeverage.value = result.defaultLeverage;
    }
  );

  // ── Toggle API key visibility ──

  toggleBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // ── Save settings ──

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const risk = parseFloat(defaultRisk.value);
    const leverage = parseInt(defaultLeverage.value);

    // Validate
    if (key && key.length < 10) {
      showStatus('Invalid API key format', 'error');
      return;
    }

    if (risk <= 0 || risk > 100) {
      showStatus('Risk must be between 0.1 and 100', 'error');
      return;
    }

    if (leverage < 1 || leverage > 500) {
      showStatus('Leverage must be between 1 and 500', 'error');
      return;
    }

    chrome.storage.sync.set({
      geminiApiKey: key,
      geminiModel: model,
      defaultRisk: risk,
      defaultLeverage: leverage
    }, () => {
      showStatus('Settings saved!', 'success');
    });
  });

  function showStatus(msg, type) {
    saveStatus.textContent = msg;
    saveStatus.className = `save-status ${type}`;
    setTimeout(() => {
      saveStatus.textContent = '';
      saveStatus.className = 'save-status';
    }, 3000);
  }
})();
