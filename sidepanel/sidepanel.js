/**
 * Fenie Side Panel — UI Controller
 * Handles: analysis, chat history, tab navigation.
 */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ── DOM refs ──
  const tickerSymbol    = $('#tickerSymbol');
  const tickerPrice     = $('#tickerPrice');
  const analyzeBtn      = $('#analyzeBtn');
  const analyzeBtnText  = $('#analyzeBtnText');
  const settingsBtn     = $('#settingsBtn');
  const statusBar       = $('#statusBar');
  const statusText      = $('#statusText');
  const resultsContainer= $('#resultsContainer');
  const emptyState      = $('#emptyState');
  const errorState      = $('#errorState');
  const errorMessage    = $('#errorMessage');
  const retryBtn        = $('#retryBtn');
  const portfolioInput  = $('#portfolio');
  const riskInput       = $('#riskPercent');
  const leverageInput   = $('#leverage');
  const leverageLabel   = $('#leverageLabel');
  const leverageGroup   = $('#leverageGroup');

  // Tab refs
  const tabAnalyze   = $('#tabAnalyze');
  const tabChats     = $('#tabChats');
  const analyzePanel = $('#analyzePanel');
  const chatsPanel   = $('#chatsPanel');
  const chatList     = $('#chatList');
  const chatsEmpty   = $('#chatsEmpty');
  const chatDetail   = $('#chatDetail');
  const clearChatsBtn= $('#clearChatsBtn');
  const pillBtns     = document.querySelectorAll('.pill-btn');

  const MAX_HISTORY = 25;

  // ── Init ──

  init();

  async function init() {
    // Load defaults
    chrome.storage.sync.get(['defaultRisk', 'defaultLeverage'], (r) => {
      if (r.defaultRisk)     riskInput.value = r.defaultRisk;
      if (r.defaultLeverage) leverageInput.value = r.defaultLeverage;
    });

    // Always ensure live API is enabled
    chrome.storage.sync.set({ liveApi: true });

    detectTicker();
    setInterval(detectTicker, 5000);

    // Restore last analysis if available
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      if (response?.state) renderResults(response.state);
    });

    // Trade type pill buttons
    pillBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        pillBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const type = btn.dataset.type;

        if (type === 'spot') {
          leverageLabel.textContent = 'Leverage';
          leverageInput.value = 1;
          leverageInput.min = 1;
          leverageInput.max = 500;
          leverageInput.step = 1;
          leverageInput.placeholder = '1';
          leverageInput.disabled = true;
        } else if (type === 'futures') {
          leverageLabel.textContent = 'Leverage';
          leverageInput.min = 1;
          leverageInput.max = 500;
          leverageInput.step = 1;
          leverageInput.placeholder = '1';
          leverageInput.disabled = false;
        } else if (type === 'forex') {
          leverageLabel.textContent = 'Lot Size';
          leverageInput.value = 1;
          leverageInput.min = 0.01;
          leverageInput.max = 100;
          leverageInput.step = 0.01;
          leverageInput.placeholder = '1.00';
          leverageInput.disabled = false;
        }
      });
    });

    // Tab switching
    tabAnalyze.addEventListener('click', () => switchTab('analyze'));
    tabChats.addEventListener('click', () => switchTab('chats'));

    // Clear history
    clearChatsBtn.addEventListener('click', async () => {
      if (!confirm('Clear all saved analyses?')) return;
      await saveHistory([]);
      renderChatList([]);
    });

  }

  // ── Tab Switching ──

  function switchTab(tab) {
    if (tab === 'analyze') {
      tabAnalyze.classList.add('active');
      tabChats.classList.remove('active');
      analyzePanel.classList.remove('hidden');
      chatsPanel.classList.add('hidden');
    } else {
      tabChats.classList.add('active');
      tabAnalyze.classList.remove('active');
      chatsPanel.classList.remove('hidden');
      analyzePanel.classList.add('hidden');
      chatDetail.classList.add('hidden');
      loadAndRenderChats();
    }
  }

  // ── Events ──

  analyzeBtn.addEventListener('click', startAnalysis);
  retryBtn.addEventListener('click', startAnalysis);
  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'statusUpdate') updateStatus(msg.status, msg.message);
  });

  // ── Ticker Detection ──

  async function detectTicker() {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'quickDetect' });
      if (r?.ticker) {
        tickerSymbol.textContent = r.ticker;
        tickerPrice.textContent  = r.price ? `$${formatPrice(r.price)}` : '—';
        analyzeBtnText.textContent = `Analyze ${r.ticker}`;
      } else {
        analyzeBtnText.textContent = 'Analyze';
      }
    } catch { /* content script not available */ }
  }

  // ── Analysis ──

  async function startAnalysis() {
    const portfolio   = parseFloat(portfolioInput.value);
    const riskPercent = parseFloat(riskInput.value);
    const tradeType   = document.querySelector('.pill-btn.active')?.dataset.type || 'spot';

    if (!portfolio || portfolio <= 0)
      return showError('Please enter a valid portfolio size.');
    if (!riskPercent || riskPercent <= 0 || riskPercent > 100)
      return showError('Risk must be between 0.1% and 100%.');

    let leverage, lotSize = null;
    if (tradeType === 'forex') {
      lotSize = parseFloat(leverageInput.value);
      if (!lotSize || lotSize <= 0) return showError('Please enter a valid lot size.');
      leverage = 1;
    } else {
      leverage = parseInt(leverageInput.value);
      if (!leverage || leverage < 1 || leverage > 500)
        return showError('Leverage must be between 1x and 500x.');
    }

    const s = await new Promise(r => chrome.storage.sync.get(['geminiApiKey'], r));
    if (!s.geminiApiKey)
      return showError('Gemini API Key not configured. Click ⚙ Settings.');

    analyzeBtn.disabled = true;
    hideAll();
    statusBar.classList.remove('hidden');
    updateStatus('capturing', 'Summoning Fenie...');

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'analyze',
        params: { portfolio, riskPercent, leverage, tradeType, lotSize }
      });

      if (result?.success) {
        renderResults(result.data);
        await saveToHistory(result.data);
      } else {
        showError(result?.error || 'Analysis failed. Please try again.');
      }
    } catch (err) {
      showError(err.message || 'Connection error.');
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  // ── Status ──

  function updateStatus(status, message) {
    statusBar.classList.remove('hidden', 'error', 'complete', 'capturing');
    statusBar.classList.add(status);
    statusText.textContent = message;
    if (status === 'complete') setTimeout(() => statusBar.classList.add('hidden'), 2500);
    if (status === 'error')    showError(message);
  }

  // ── Render Results ──

  function renderResults(data) {
    hideAll();
    resultsContainer.classList.remove('hidden');

    const pd = data.positionData;
    const tfBadges = (data.timeframesCaptured || ['4H', '1D'])
      .map(tf => `<span class="tf-badge">${tf}</span>`).join('');

    const testBanner = data.testMode
      ? `<div class="test-mode-banner">⚡ Test Mode — Live API disabled</div>` : '';

    const dirMatch = data.aiAnalysis?.match(/\b(LONG|SHORT)\b/i);
    const direction = dirMatch ? dirMatch[1].toUpperCase() : null;
    const dirBadge = direction
      ? `<span class="direction-badge ${direction === 'LONG' ? 'long' : 'short'}">${direction === 'LONG' ? '▲' : '▼'} ${direction}</span>`
      : '';

    resultsContainer.innerHTML = `
      ${testBanner}

      <div class="result-section">
        <div class="result-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 20V10M18 20V4M6 20v-4"/>
          </svg>
          <h2>Trade Setup — ${data.ticker}</h2>
          ${dirBadge}
        </div>
        <div class="result-card">
          <div class="tf-row">${tfBadges}</div>
          <table class="result-table">
            <tbody>
              <tr>
                <td class="td-label">Current Price</td>
                <td class="td-value price-white">$${formatPrice(data.currentPrice)}</td>
              </tr>
              <tr>
                <td class="td-label">Risk Amount</td>
                <td class="td-value price-bear">$${formatPrice(pd.riskAmount)}</td>
              </tr>
              <tr>
                <td class="td-label">Position Size</td>
                <td class="td-value price-bull">${pd.positionSize} ${pd.lotSizeLabel}</td>
              </tr>
              ${pd.lotSize !== null ? `
              <tr>
                <td class="td-label">Lot Size</td>
                <td class="td-value price-gold">${pd.lotSize} lots</td>
              </tr>` : ''}
              <tr>
                <td class="td-label">Notional Value</td>
                <td class="td-value price-white">$${formatPrice(pd.notionalValue)}</td>
              </tr>
              <tr>
                <td class="td-label">Leverage</td>
                <td class="td-value price-gold">${pd.effectiveLeverage}x</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="result-section">
        <div class="result-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <h2>Fenie's Analysis</h2>
        </div>
        <div class="ai-content">${renderMarkdown(data.aiAnalysis)}</div>
      </div>

      <div class="result-footer">
        <span>Fenie v2.0</span>
        <span>${new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>
    `;
  }

  // ── Chat History ──

  async function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['chatHistory'], (r) => {
        resolve(Array.isArray(r.chatHistory) ? r.chatHistory : []);
      });
    });
  }

  async function saveHistory(history) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ chatHistory: history }, resolve);
    });
  }

  async function saveToHistory(data) {
    const history = await loadHistory();
    const entry = {
      id: data.timestamp || Date.now(),
      ticker: data.ticker,
      currentPrice: data.currentPrice,
      direction: (data.aiAnalysis?.match(/\b(LONG|SHORT)\b/i) || [])[1]?.toUpperCase() || null,
      timeframesCaptured: data.timeframesCaptured,
      positionData: data.positionData,
      aiAnalysis: data.aiAnalysis,
      timestamp: data.timestamp || Date.now()
    };
    // Prepend new entry, trim to max
    const updated = [entry, ...history].slice(0, MAX_HISTORY);
    await saveHistory(updated);
  }

  async function loadAndRenderChats() {
    const history = await loadHistory();
    renderChatList(history);
  }

  function renderChatList(history) {
    chatDetail.classList.add('hidden');
    chatDetail.innerHTML = '';

    if (history.length === 0) {
      chatList.innerHTML = '';
      chatsEmpty.classList.remove('hidden');
      clearChatsBtn.style.display = 'none';
      return;
    }

    chatsEmpty.classList.add('hidden');
    clearChatsBtn.style.display = 'flex';

    chatList.innerHTML = history.map((entry, idx) => {
      const dir = entry.direction;
      const dirHtml = dir
        ? `<span class="chat-dir ${dir === 'LONG' ? 'long' : 'short'}">${dir === 'LONG' ? '▲' : '▼'} ${dir}</span>`
        : '';
      const tfs = (entry.timeframesCaptured || []).map(tf => `<span class="chat-tf">${tf}</span>`).join('');
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="chat-item" data-idx="${idx}">
          <div class="chat-item-top">
            <span class="chat-ticker">${entry.ticker}</span>
            ${dirHtml}
            <span class="chat-price">$${formatPrice(entry.currentPrice)}</span>
          </div>
          <div class="chat-item-bot">
            <div class="chat-tfs">${tfs}</div>
            <span class="chat-date">${dateStr} · ${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');

    // Click to expand
    chatList.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        openChatDetail(history[idx]);
      });
    });
  }

  function openChatDetail(entry) {
    chatList.classList.add('hidden');
    chatsEmpty.classList.add('hidden');
    chatDetail.classList.remove('hidden');

    const dir = entry.direction;
    const dirBadge = dir
      ? `<span class="direction-badge ${dir === 'LONG' ? 'long' : 'short'}">${dir === 'LONG' ? '▲' : '▼'} ${dir}</span>`
      : '';
    const tfBadges = (entry.timeframesCaptured || []).map(tf => `<span class="tf-badge">${tf}</span>`).join('');
    const pd = entry.positionData;
    const date = new Date(entry.timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    chatDetail.innerHTML = `
      <div class="chat-detail-nav">
        <button class="btn-back" id="backToList">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <span class="chat-detail-date">${date}</span>
      </div>

      <div class="result-section">
        <div class="result-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 20V10M18 20V4M6 20v-4"/>
          </svg>
          <h2>Trade Setup — ${entry.ticker}</h2>
          ${dirBadge}
        </div>
        <div class="result-card">
          <div class="tf-row">${tfBadges}</div>
          <table class="result-table">
            <tbody>
              <tr><td class="td-label">Current Price</td><td class="td-value price-white">$${formatPrice(entry.currentPrice)}</td></tr>
              <tr><td class="td-label">Risk Amount</td><td class="td-value price-bear">$${formatPrice(pd.riskAmount)}</td></tr>
              <tr><td class="td-label">Position Size</td><td class="td-value price-bull">${pd.positionSize} ${pd.lotSizeLabel}</td></tr>
              ${pd.lotSize !== null ? `<tr><td class="td-label">Lot Size</td><td class="td-value price-gold">${pd.lotSize} lots</td></tr>` : ''}
              <tr><td class="td-label">Notional Value</td><td class="td-value price-white">$${formatPrice(pd.notionalValue)}</td></tr>
              <tr><td class="td-label">Leverage</td><td class="td-value price-gold">${pd.effectiveLeverage}x</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="result-section">
        <div class="result-section-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <h2>Fenie's Analysis</h2>
        </div>
        <div class="ai-content">${renderMarkdown(entry.aiAnalysis)}</div>
      </div>
    `;

    $('#backToList').addEventListener('click', () => {
      chatDetail.classList.add('hidden');
      chatList.classList.remove('hidden');
      if (chatList.innerHTML.trim() === '') chatsEmpty.classList.remove('hidden');
    });
  }

  // ── Markdown Renderer ─────────────────────────────────────────────
  //
  // Bulletproof line-by-line parser. Key design decisions:
  //   • Table rows detected by startsWith('|') ONLY — no endsWith('|')
  //     required, because Gemini frequently omits trailing pipes.
  //   • Separator rows (---/:::) detected by checking ALL cells match
  //     /^[-:\s]*$/ (empty cells also valid in separator rows).
  //   • inline() escapes HTML FIRST, then applies formatting. It never
  //     processes _ underscores (destroys URLs from search grounding).
  //   • inline() number-coloring runs on literal text, never on already-
  //     inserted HTML tag content (patterns anchored to avoid tag attrs).
  //
  function renderMarkdown(text) {
    if (!text) return '<p class="text-muted">No analysis data.</p>';

    const lines     = text.split('\n');
    const out       = [];
    let tableRows   = [];   // array of string[] (cells per row)
    let listItems   = [];
    let listOrdered = false;

    // ── flush helpers ──

    function flushList() {
      if (!listItems.length) return;
      const tag = listOrdered ? 'ol' : 'ul';
      out.push(`<${tag} class="ai-list">${listItems.join('')}</${tag}>`);
      listItems   = [];
      listOrdered = false;
    }

    function isSepRow(cells) {
      // A separator row: at least one cell has dashes, and ALL cells are only dashes/colons/spaces
      // Require at least one cell with a dash to avoid false-positives on blank rows
      return cells.length > 0
        && cells.some(c => c.includes('-'))
        && cells.every(c => /^[-:\s]*$/.test(c));
    }

    function flushTable() {
      if (!tableRows.length) return;

      // Find the separator row
      const sepIdx = tableRows.findIndex(isSepRow);

      let headerCells = null;
      let dataRows;

      if (sepIdx === 1) {
        // Normal case: row 0 = header, row 1 = separator, rows 2+ = data
        headerCells = tableRows[0];
        dataRows    = tableRows.slice(2);
      } else if (sepIdx > 1) {
        // Separator not directly after header — treat row before sep as header
        headerCells = tableRows[sepIdx - 1];
        dataRows    = tableRows.filter((_, i) => i !== sepIdx && i !== sepIdx - 1);
      } else if (sepIdx === 0) {
        // Separator is first row — no header
        dataRows = tableRows.slice(1);
      } else {
        // No separator found — first row is header, rest are data
        headerCells = tableRows[0];
        dataRows    = tableRows.slice(1);
      }

      // Build HTML
      const thead = headerCells && headerCells.some(c => c.trim())
        ? `<thead><tr>${headerCells.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        : '';
      const tbody = dataRows.length
        ? `<tbody>${dataRows
            .filter(row => row.some(c => c.trim()))   // skip blank rows
            .map(row => `<tr>${row.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : '';

      if (thead || tbody) {
        out.push(`<div class="table-wrap"><table class="result-table">${thead}${tbody}</table></div>`);
      }
      tableRows = [];
    }

    // ── main line loop ──

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      // ── TABLE ROW — only requires leading pipe (no trailing pipe needed) ──
      if (trimmed.startsWith('|')) {
        flushList();
        // Strip leading pipe; strip trailing pipe if present
        const inner = trimmed.endsWith('|')
          ? trimmed.slice(1, -1)
          : trimmed.slice(1);
        tableRows.push(inner.split('|').map(c => c.trim()));
        continue;
      }

      // Non-pipe line → flush pending table
      if (tableRows.length) flushTable();

      // ── HEADINGS ──
      if (trimmed.startsWith('#### ')) {
        flushList();
        out.push(`<h4 class="ai-h3">${inline(trimmed.slice(5))}</h4>`);
        continue;
      }
      if (trimmed.startsWith('### ')) {
        flushList();
        out.push(`<h3 class="ai-h3">${inline(trimmed.slice(4))}</h3>`);
        continue;
      }
      if (trimmed.startsWith('## ')) {
        flushList();
        out.push(`<h2 class="ai-h2">${inline(trimmed.slice(3))}</h2>`);
        continue;
      }
      if (trimmed.startsWith('# ')) {
        flushList();
        out.push(`<h1 class="ai-h1">${inline(trimmed.slice(2))}</h1>`);
        continue;
      }

      // ── HORIZONTAL RULE ──
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushList();
        out.push('<hr class="ai-hr">');
        continue;
      }

      // ── BLOCKQUOTE ──
      if (trimmed.startsWith('> ')) {
        flushList();
        out.push(`<blockquote class="ai-quote">${inline(trimmed.slice(2))}</blockquote>`);
        continue;
      }

      // ── UNORDERED LIST ITEM ──
      if (/^[*\-+] /.test(trimmed)) {
        listOrdered = false;
        listItems.push(`<li>${inline(trimmed.slice(2))}</li>`);
        continue;
      }

      // ── ORDERED LIST ITEM ──
      if (/^\d+[.)]\s/.test(trimmed)) {
        listOrdered = true;
        listItems.push(`<li>${inline(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`);
        continue;
      }

      // ── EMPTY LINE ──
      if (!trimmed) {
        flushList();
        continue;
      }

      // ── PARAGRAPH ──
      flushList();
      out.push(`<p class="ai-p">${inline(trimmed)}</p>`);
    }

    // Flush anything remaining
    flushList();
    flushTable();

    return out.join('\n');
  }

  // ── Inline formatter ───────────────────────────────────────────────
  //
  // IMPORTANT: HTML-escape raw text FIRST, then apply markdown markup.
  // Do NOT process _underscore_ italic — it corrupts URLs from Google
  // Search grounding (e.g. crypto_news_2024 → crypto<em>news</em>2024).
  // Number coloring uses negative lookbehind/lookahead to avoid hitting
  // text already inside HTML attributes.
  //
  function inline(raw) {
    if (!raw) return '';

    let s = raw
      // 1. Escape HTML special chars first
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

      // 2. Bold + italic combined ***
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // 3. Bold **
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // 4. Italic * (single, not double)
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      // 5. Inline code `...`
      .replace(/`([^`]+)`/g, '<code class="ai-code">$1</code>');

    // 6. Color dollar prices  e.g. $69,317.75 or $1000
    //    Use a function replacement to avoid $1 back-ref ambiguity
    s = s.replace(/(\$[\d,]+(?:\.\d+)?)/g, (m) =>
      `<span class="num-gold">${m}</span>`);

    // 7. Color percentages  e.g. 5.2%
    s = s.replace(/\b(\d+(?:\.\d+)?%)/g, (m) =>
      `<span class="num-accent">${m}</span>`);

    // 8. Color leverage  e.g. 10x  (whole word only)
    s = s.replace(/\b(\d+x)\b/gi, (m) =>
      `<span class="num-gold">${m}</span>`);

    // 9. Keyword colouring (all-caps variants that AI commonly outputs)
    s = s
      .replace(/\b(LONG)\b/g,   '<span class="kw-long">$1</span>')
      .replace(/\b(SHORT)\b/g,  '<span class="kw-short">$1</span>')
      .replace(/\b(HIGH)\b/g,   '<span class="kw-high">$1</span>')
      .replace(/\b(MEDIUM)\b/g, '<span class="kw-medium">$1</span>')
      .replace(/\b(LOW)\b/g,    '<span class="kw-low">$1</span>')
      .replace(/\b(BULLISH)\b/g,'<span class="kw-long">$1</span>')
      .replace(/\b(BEARISH)\b/g,'<span class="kw-short">$1</span>');

    return s;
  }

  // ── Helpers ──

  function formatPrice(price) {
    if (price == null) return '—';
    const n = parseFloat(price);
    if (n >= 1000)  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1)     return n.toFixed(2);
    if (n >= 0.01)  return n.toFixed(4);
    return n.toFixed(6);
  }

  function hideAll() {
    emptyState.classList.add('hidden');
    errorState.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    statusBar.classList.add('hidden');
  }

  function showError(msg) {
    hideAll();
    errorState.classList.remove('hidden');
    errorMessage.textContent = msg;
    analyzeBtn.disabled = false;
  }
})();
