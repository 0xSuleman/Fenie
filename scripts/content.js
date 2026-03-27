/**
 * Content Script — Runs on TradingView pages.
 * Role: "Stage Manager" — handles ticker detection and timeframe switching ONLY.
 * All captureVisibleTab calls happen in background.js.
 */

(() => {
  'use strict';

  /**
   * Scrape the active ticker symbol from the TradingView DOM.
   */
  function getActiveTicker() {
    // 1. Most robust: The main symbol search button text
    const symbolElement = document.getElementById('header-toolbar-symbol-search') ||
                          document.querySelector('[data-name="header-toolbar-symbol-search"]');
    if (symbolElement) {
      const text = symbolElement.textContent.trim();
      if (text && text.length > 0) return text;
    }

    // 2. Fallbacks
    const symbolEl = document.querySelector('[data-symbol-short]');
    if (symbolEl) return symbolEl.getAttribute('data-symbol-short');

    const titleEl = document.querySelector('.chart-controls-bar .apply-common-tooltip');
    if (titleEl) return titleEl.textContent.trim();

    const urlMatch = window.location.pathname.match(/\/chart\/[^/]+\/([^/]+)/);
    if (urlMatch) return urlMatch[1];

    // Fallback: search the header text nodes
    const headerEls = document.querySelectorAll('#header-toolbar-symbol-search span, .titleWrapper span');
    for (const el of headerEls) {
      const text = el.textContent.trim();
      if (text && text.length > 1 && text.length < 20 && /^[A-Z0-9.:]+$/i.test(text)) {
        return text;
      }
    }

    return null;
  }

  /**
   * Get the current price displayed on the chart.
   */
  function getCurrentPrice() {
    // 1. Try to get price from the chart legend (most robust)
    const legend = document.querySelector('div[class*="series-"]');
    if (legend) {
      const items = Array.from(legend.querySelectorAll('div[class*="valueItem-"]'));
      const closeItem = items.find(item => item.textContent.trim().startsWith('C'));
      if (closeItem) {
        const valueEl = closeItem.querySelector('div[class*="valueValue-"]');
        if (valueEl) {
          const raw = valueEl.textContent.replace(/[^0-9.]/g, '');
          if (raw) return parseFloat(raw);
        }
      }
    }

    // 2. Try the primary price element
    const priceEl = document.querySelector('.lastContainer-JWoJqCpY .js-symbol-last');
    if (priceEl) {
      const raw = priceEl.textContent.replace(/[^0-9.]/g, '');
      return parseFloat(raw) || null;
    }

    // 3. Try the alternative price element
    const altPriceEl = document.querySelector('[class*="last-"] [class*="value"]');
    if (altPriceEl) {
      const raw = altPriceEl.textContent.replace(/[^0-9.]/g, '');
      return parseFloat(raw) || null;
    }

    return null;
  }

  /**
   * All possible text labels TradingView uses for each timeframe.
   * TradingView is inconsistent — buttons can show "4h", "4H", "240", etc.
   */
  const TF_ALIASES = {
    '15m': ['15m', '15', '15min'],
    '1H':  ['1h', '1H', '60', '1hr', '1hour'],
    '4H':  ['4h', '4H', '240', '4hr', '4hour'],
    '1D':  ['1D', '1d', 'D', '1day', 'Daily'],
  };

  /**
   * Switch to a specific timeframe by clicking the TradingView toolbar button.
   * Uses case-insensitive matching with multiple aliases.
   */
  async function switchTimeframe(timeframe) {
    const aliases = TF_ALIASES[timeframe] || [timeframe];

    // Strategy 1: Click a matching button in the intervals toolbar
    const tfButtons = document.querySelectorAll(
      '#header-toolbar-intervals button, ' +
      '[data-name="date-ranges-tabs"] button, ' +
      'button[data-value], ' +
      '.header-chart-panel button'
    );

    for (const btn of tfButtons) {
      const btnText = btn.textContent.trim().toLowerCase();
      const btnValue = (btn.getAttribute('data-value') || '').toLowerCase();

      for (const alias of aliases) {
        const lower = alias.toLowerCase();
        if (btnText === lower || btnValue === lower) {
          btn.click();
          console.log(`[Fenie] Switched to ${timeframe} via button "${btn.textContent.trim()}"`);
          return true;
        }
      }
    }

    // Strategy 2: Try the timeframe dropdown menu
    const dropdownTrigger = document.querySelector(
      '[id*="time-interval-button"], ' +
      '[data-name="time-interval-button"], ' +
      'button[class*="timeInterval"]'
    );

    if (dropdownTrigger) {
      dropdownTrigger.click();
      await delay(500);

      const menuItems = document.querySelectorAll(
        '[class*="menuItem"], [role="option"], [class*="item-"]'
      );

      for (const item of menuItems) {
        const itemText = item.textContent.trim().toLowerCase();
        for (const alias of aliases) {
          if (itemText.includes(alias.toLowerCase())) {
            item.click();
            console.log(`[Fenie] Switched to ${timeframe} via dropdown "${item.textContent.trim()}"`);
            return true;
          }
        }
      }

      // Close the dropdown if nothing matched
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }

    // Strategy 3: Try keyboard shortcut — TradingView supports number shortcuts
    // Note: this is a last resort and may not work if chart isn't focused
    console.warn(`[Fenie] Could not find button for ${timeframe}, will capture current view`);
    return false;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Scrape the exact text of all visible indicators (EMA, RSI, etc) from the chart legends.
   * This prevents the AI vision model from hallucinating tiny numbers.
   */
  function getChartLegends() {
    const textBlocks = [];
    const items = document.querySelectorAll(
      'div[data-name="legend-series-item"], div[data-name="legend-source-item"], div[class*="legendItem-"], div[class*="study-"]'
    );
    
    items.forEach(item => {
      // innerText retains visible text. Replace newlines with spaces for a clean string.
      const text = item.innerText.replace(/\n+/g, ' ').trim();
      if (text && text.length > 2) textBlocks.push(text);
    });
    
    return [...new Set(textBlocks)];
  }

  // ── Message Listener ──
  // The content script ONLY handles stage management commands.
  // It never calls captureVisibleTab — that's background.js's job.

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getTicker':
        sendResponse({ ticker: getActiveTicker(), price: getCurrentPrice(), legends: getChartLegends() });
        return false;

      case 'getLegends':
        sendResponse({ legends: getChartLegends() });
        return false;

      case 'switchTimeframe':
        switchTimeframe(message.timeframe).then(ok => sendResponse({ success: ok }));
        return true; // async

      case 'ping':
        sendResponse({ alive: true });
        return false;
    }
  });

  console.log('%c[Fenie]%c Content script loaded on TradingView', 'color:#00d4aa;font-weight:bold', 'color:inherit');
})();
