/**
 * Background Service Worker — The central brain of Fenie.
 * Orchestrates: capture sequence, Gemini API calls, risk calculations, state management.
 * ALL captureVisibleTab calls happen HERE — content script is stage manager only.
 */

import { detectAssetClass, getAssetConfig, ASSET_CLASSES } from './utils/asset-factory.js';
import { calculatePositionSize, round } from './utils/risk-engine.js';
import { downscaleImage, stripDataUriPrefix } from './utils/image-utils.js';

// ── State ──
let analysisState = null;
let isAnalyzing = false;

// ── Timeframes for the "Fenie Flip" ──
const TIMEFRAMES = ['15m', '1H', '4H', '1D'];

// ── Extension Lifecycle ──

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'defaultRisk', 'defaultLeverage', 'liveApi'], (result) => {
    if (!result.geminiModel) chrome.storage.sync.set({ geminiModel: 'gemini-2.5-flash' });
    if (!result.defaultRisk) chrome.storage.sync.set({ defaultRisk: 2 });
    if (!result.defaultLeverage) chrome.storage.sync.set({ defaultLeverage: 1 });
    if (result.liveApi === undefined) chrome.storage.sync.set({ liveApi: true });
  });
});

// ── Message Router ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'analyze':
      handleAnalysis(message.params).then(sendResponse);
      return true;

    case 'getState':
      sendResponse({ state: analysisState, isAnalyzing });
      return false;

    case 'quickDetect':
      handleQuickDetect(sender.tab?.id).then(sendResponse);
      return true;

    case 'setLiveApi':
      chrome.storage.sync.set({ liveApi: message.enabled });
      sendResponse({ ok: true });
      return false;
  }
});

// ── Quick Detect ──

async function handleQuickDetect(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!tabId) return { ticker: null, price: null };

  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'getTicker' });
  } catch {
    return { ticker: null, price: null };
  }
}

// ── Randomized Jitter Delay (1.8s – 2.2s) ──

function jitterDelay() {
  const ms = 1800 + Math.random() * 400;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── The "Fenie Flip" — Main Analysis Pipeline ──

async function handleAnalysis(params) {
  if (isAnalyzing) {
    return { success: false, error: 'Analysis already in progress.' };
  }

  isAnalyzing = true;
  broadcastStatus('capturing', 'Summoning Fenie...');

  try {
    const { portfolio, riskPercent, leverage, tradeType, lotSize } = params;

    // Step 1: Get active TradingView tab + ticker/price
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');

    // Ensure the content script is injected and responding
    let detection;
    try {
      detection = await chrome.tabs.sendMessage(tab.id, { action: 'getTicker' });
    } catch {
      // Content script may not be injected yet — try injecting it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['scripts/content.js']
      });
      await new Promise(r => setTimeout(r, 500));
      detection = await chrome.tabs.sendMessage(tab.id, { action: 'getTicker' });
    }

    if (!detection?.ticker) throw new Error('Could not detect ticker. Ensure a TradingView chart is open.');

    const { ticker, price: currentPrice } = detection;
    if (!currentPrice) throw new Error('Could not read current price from chart.');

    const windowId = tab.windowId;

    broadcastStatus('capturing', `Detected ${ticker} at $${currentPrice}`);

    // Step 2: The "Fenie Flip" — cycle through 4 timeframes
    // Content script switches TF → we wait for render → background captures
    const screenshots = [];

    for (let i = 0; i < TIMEFRAMES.length; i++) {
      const tf = TIMEFRAMES[i];
      broadcastStatus('capturing', `Flipping to ${tf}... (${i + 1}/${TIMEFRAMES.length})`);

      // Tell content script to switch timeframe
      try {
        const switched = await chrome.tabs.sendMessage(tab.id, {
          action: 'switchTimeframe',
          timeframe: tf
        });
        if (!switched?.success) {
          console.warn(`[Fenie] Could not switch to ${tf}, capturing current view`);
        }
      } catch (err) {
        console.warn(`[Fenie] switchTimeframe message failed for ${tf}:`, err.message);
      }

      // Wait with randomized jitter for indicators/drawings to render
      await jitterDelay();

      // Scrape precise indicator values from the DOM for this timeframe
      let legends = [];
      try {
        const legendData = await chrome.tabs.sendMessage(tab.id, { action: 'getLegends' });
        if (legendData && legendData.legends) legends = legendData.legends;
      } catch (err) {
        console.warn(`[Fenie] Failed to get legends for ${tf}:`, err.message);
      }

      // Background captures the visible tab using the correct windowId
      const dataUrl = await captureTab(windowId);
      if (dataUrl) {
        screenshots.push({ timeframe: tf, dataUrl, legends });
        console.log(`[Fenie] Captured ${tf} (${Math.round(dataUrl.length / 1024)}KB)`);
      } else {
        console.warn(`[Fenie] Capture returned null for ${tf}`);
      }
    }

    if (screenshots.length === 0) {
      throw new Error('Failed to capture screenshots. Check that TradingView is the active tab and try again.');
    }

    broadcastStatus('processing', `Captured ${screenshots.length} timeframes. Processing...`);

    // Step 3: Downscale images for token optimization
    const processedShots = [];
    for (const shot of screenshots) {
      const downscaled = await downscaleImage(shot.dataUrl);
      processedShots.push({
        timeframe: shot.timeframe,
        legends: shot.legends,
        base64: stripDataUriPrefix(downscaled)
      });
    }

    // Step 4: Calculate risk math (pure JS — source of truth for position sizing)
    const positionData = calculatePositionSize({
      portfolio, riskPercent, leverage, currentPrice, ticker, tradeType, lotSize
    });

    // Step 5: Check Live API toggle
    const settings = await getSettings();
    const isLiveApi = settings.liveApi !== false;

    let aiResult;

    if (!isLiveApi) {
      // Test mode: log base64 strings to console, skip API call
      console.log(`%c[Fenie Test Mode]%c ${screenshots.length} screenshots captured for ${ticker}`, 'color:#ffd700;font-weight:bold', 'color:inherit');
      for (const shot of processedShots) {
        console.log(`[Fenie] ${shot.timeframe}: ${shot.base64.substring(0, 80)}...  (${shot.base64.length} chars)`);
      }
      aiResult = generateTestModeOutput(ticker, currentPrice, screenshots);
    } else {
      // Live mode: call Gemini API
      if (!settings.geminiApiKey) {
        throw new Error('Gemini API Key not configured. Open Fenie Settings.');
      }

      broadcastStatus('analyzing', 'Fenie is reading the charts...');

      aiResult = await callGeminiAPI({
        screenshots: processedShots, ticker, currentPrice,
        positionData, tradeType, settings
      });
    }

    // Step 6: Save state and respond
    analysisState = {
      ticker, currentPrice, positionData,
      aiAnalysis: aiResult,
      timeframesCaptured: screenshots.map(s => s.timeframe),
      testMode: !isLiveApi,
      timestamp: Date.now()
    };

    broadcastStatus('complete', 'Fenie has granted your wish!');
    isAnalyzing = false;
    return { success: true, data: analysisState };

  } catch (err) {
    isAnalyzing = false;
    broadcastStatus('error', err.message);
    return { success: false, error: err.message };
  }
}

// ── Tab Capture (background.js only) ──
// Uses the actual windowId — passing null/undefined can fail in MV3.

function captureTab(windowId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 85 }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.warn('[Fenie] captureVisibleTab error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(dataUrl);
        }
      });
    } catch (err) {
      console.warn('[Fenie] captureVisibleTab threw:', err.message);
      resolve(null);
    }
  });
}

// ── Test Mode Output ──

function generateTestModeOutput(ticker, currentPrice, screenshots) {
  const capturedTFs = screenshots.map(s => s.timeframe).join(', ');
  return `## Test Mode — API Disabled

**Fenie successfully captured ${screenshots.length} timeframe(s).**

This is a test run. The full capture pipeline completed without calling the Gemini API.

| Detail | Value |
|--------|-------|
| Symbol | ${ticker} |
| Price | $${currentPrice} |
| Mode | Test (Live API OFF) |
| Captured | ${capturedTFs} |

> Toggle **Live API** ON in the sidebar to send screenshots to Gemini for full analysis.

Check the browser **DevTools console** (F12 → Console) for captured Base64 image data.`;
}

// ── Gemini API ──

async function callGeminiAPI({ screenshots, ticker, currentPrice, positionData, tradeType, settings }) {
  const { geminiApiKey, geminiModel } = settings;
  const assetClass = detectAssetClass(ticker);

  const systemPrompt = buildSystemPrompt(tradeType);
  const userPrompt = buildUserPrompt({
    ticker, currentPrice, assetClass, positionData, tradeType,
    timeframes: screenshots.map(s => s.timeframe)
  });

  // Build multimodal content parts — images + labels + prompt
  const parts = [];

  for (const shot of screenshots) {
    parts.push({
      inlineData: { mimeType: 'image/jpeg', data: shot.base64 }
    });
    
    const legendText = shot.legends && shot.legends.length > 0
      ? `\n\n**EXACT INDICATOR VALUES (Scraped from Chart DOM):**\n- ${shot.legends.join('\n- ')}\n`
      : '';

    parts.push({
      text: `[Chart Screenshot: ${shot.timeframe} timeframe — describe exactly what indicators, overlays, drawings, and price action you see]${legendText}`
    });
  }

  parts.push({ text: userPrompt });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.3,
      topP: 0.85,
      maxOutputTokens: 8192
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }
    ],
    tools: [{
      googleSearch: {}
    }]
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg = errorData?.error?.message || `API error: ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const textParts = data?.candidates?.[0]?.content?.parts || [];
  let analysisText = textParts.filter(p => p.text).map(p => p.text).join('\n');

  if (!analysisText) {
    throw new Error('Fenie received an empty response from AI. Try again.');
  }

  // Deduplicate: Gemini with Google Search grounding can return multiple text
  // parts that repeat the same sections. Detect if numbered headings restart
  // (e.g. "### 1." appears a second time) and truncate at the repetition.
  analysisText = deduplicateSections(analysisText);

  return analysisText;
}

// ── Fenie LLM Persona ──

function buildSystemPrompt(tradeType) {
  const isForex = tradeType === 'forex';

  const forexRules = isForex ? `

### FOREX MODE — IMPORTANT
This is a **Forex / Commodities** trade. You MUST tailor your entire analysis accordingly:
- Express ALL price levels (Entry, SL, TP, DCA) with the correct decimal precision for the instrument (5 decimals for FX pairs like GBPUSD, 2 decimals for Gold XAUUSD, etc.)
- Express risk distances in **pips** (1 pip = 0.0001 for FX pairs, 0.10 for Gold)
- Reference **lot sizes** (not token/coin quantities). The user has specified their lot size directly.
- Include a **Pip Value** estimate where relevant (e.g., "$10/pip for 1.0 lot on EURUSD")
- Use Forex terminology: spread, swap/rollover, session times (London/NY/Asian), liquidity zones
- For Gold (XAUUSD): reference key round-number levels, Fed/macro drivers, DXY correlation
- For FX pairs: reference central bank policy, rate differentials, economic calendar events
- In the DCA table, show pip distance from entry for each level` : '';

  return `You are **Fenie** — a Financial Genie, an elite AI trading analyst. Your tagline: "Granting Every Trade a Logical Wish."

You receive **4 chart screenshots** from different timeframes (15m, 1H, 4H, 1D) of the same instrument, plus pre-calculated risk/position data.

## YOUR CORE RULES:

### 1. User-Led Chart Interpretation
**Your job**: Describe and analyze EXACTLY what you see. DO NOT guess or hallucinate the exact numerical values of indicators (like EMAs or RSI) from the image. Instead, use the "EXACT INDICATOR VALUES" provided alongside each image, which are correctly pre-scraped from the chart's legend.

Focus your visual analysis strictly on structural price action: horizontal support/resistance zones, major swing highs/lows, and visible patterns. If you need indicator values, read them from the provided text list.

### 2. Multi-Timeframe Confluence (The "Fenie Flip")
You receive 4 timeframes. For each one:
- Note the trend direction (up/down/sideways)
- Note where price sits relative to visible indicators
- Note any patterns or formations

Then synthesize: Where do timeframes AGREE? Where do they DIVERGE? Confluence = higher conviction.

### 3. Technical Entries & DCA
Position sizes, lot sizes, and maximum risk amounts are pre-calculated in JavaScript. However, YOU must determine the exact price levels for Entry, DCA (Dollar Cost Averaging), Stop Loss, and Take Profit based purely on the technical structure (support/resistance, EMAs, order blocks) visible in the charts.

### 4. Concise, Scannable Output
Traders need fast decisions. Use:
- Tables for all price levels (Entry, SL, TP, DCA)
- Brief bullet points for sentiment and news
- Bold for key numbers
- NO walls of text, NO lengthy explanations
${forexRules}
## YOUR TOOLS:
Use **Google Search** to find:
- Current news headlines and sentiment for the specific symbol
- The **14-day ATR** value to validate whether the pre-calculated DCA spacing is appropriate for current volatility${isForex ? '\n- Upcoming economic calendar events affecting this pair/commodity' : ''}

## OUTPUT STRUCTURE

You MUST use markdown ### headings exactly as shown below. You MUST use markdown pipe tables (|col|col|) for ALL price level data. Do NOT skip any section.

### 1. Direction & Conviction
State LONG or SHORT with conviction level (HIGH/MEDIUM/LOW). One sentence why.

### 2. Multi-Timeframe Technical Summary
- **15m:** one line
- **1H:** one line
- **4H:** one line
- **1D:** one line
- **Confluence:** summary line

### 3. Position Data
Copy the pre-calculated table here exactly as provided.

### 4. Entry / Stop Loss / Take Profit
Output a markdown table with columns: Level | Price | ${isForex ? 'Pips | ' : ''}Rationale
Include rows: Entry, Stop Loss, Take Profit 1, Take Profit 2

| Level | Price | ${isForex ? 'Pips | ' : ''}Rationale |
|-------|-------|${isForex ? '-----|' : ''}-----------|
| Entry | ${isForex ? 'X.XXXXX' : '$X'} | ${isForex ? '— | ' : ''}reason |
| Stop Loss | ${isForex ? 'X.XXXXX' : '$X'} | ${isForex ? 'XX | ' : ''}reason |
| Take Profit 1 | ${isForex ? 'X.XXXXX' : '$X'} | ${isForex ? 'XX | ' : ''}reason |
| Take Profit 2 | ${isForex ? 'X.XXXXX' : '$X'} | ${isForex ? 'XX | ' : ''}reason |

### 5. DCA Strategy
Output a markdown table with columns: DCA Level | Price | ${isForex ? 'Pips from Entry | ' : ''}Rationale
Include 3-4 DCA levels based on support/resistance visible in charts.

| DCA Level | Price | ${isForex ? 'Pips from Entry | ' : ''}Rationale |
|-----------|-------|${isForex ? '----------------|' : ''}-----------|
| DCA 1 | ${isForex ? 'X.XXXXX' : '$X'} | ${isForex ? 'XX | ' : ''}reason |

### 6. Hedge Setup (Plan B)
Output a markdown table with columns: Level | Price | Rationale
Only if primary bias is invalidated.

| Level | Price | Rationale |
|-------|-------|-----------|
${isForex ? `
### 7. Key Sessions & Economic Calendar
Note which trading session(s) are optimal for this setup and any upcoming high-impact events.

### 8. News & Sentiment` : `
### 7. News & Sentiment`}
Overall: BULLISH / BEARISH / NEUTRAL
- bullet point news item with source
- bullet point news item with source

---
**CRITICAL: Output each numbered section EXACTLY ONCE. After the final section (News & Sentiment), STOP. Do NOT loop back and repeat any section. Do NOT output section 1 again.**

Be the genie. Tables for all numbers. No walls of text.`;
}

function buildUserPrompt({ ticker, currentPrice, assetClass, positionData, tradeType, timeframes }) {
  const isForex = tradeType === 'forex';
  const modeLabel = isForex ? 'FOREX' : tradeType.toUpperCase();

  const forexContext = isForex ? `
**Trade Mode: FOREX** — Use pip-based analysis. Express all distances in pips.
${assetClass === 'gold' ? '**Instrument: Gold (XAUUSD)** — 1 pip = $0.10, 1 lot = 100 oz' : `**Instrument: FX Pair** — 1 pip = 0.0001, 1 lot = 100,000 units`}
` : '';

  return `
## ANALYZE: **${ticker}** (${assetClass.toUpperCase()} — ${modeLabel})
**Current Price: ${isForex && assetClass !== 'gold' ? '' : '$'}${currentPrice}**
**Timeframes provided: ${timeframes.join(' → ')}**
${forexContext}
### INSTRUCTIONS:
1. Look at each of the ${timeframes.length} chart screenshots carefully
2. Identify every visible indicator, overlay, and drawing — name them explicitly
3. Do NOT assume indicators that aren't visible (e.g., don't mention "200 SMA" unless you can see it)
4. Note the chart type (candlestick, line, etc.) and any visible patterns
5. Use Google Search to find current news for ${ticker} and the 14-day ATR value${isForex ? ' and upcoming economic calendar events' : ''}
6. Deliver the trade plan following the output structure

---

## PRE-CALCULATED DATA (Source of Truth — present as-is, do NOT recalculate):

**Position Sizing:**
| Metric | Value |
|--------|-------|
| Risk Amount | $${positionData.riskAmount} |
| Notional Value | $${positionData.notionalValue} |
| Position Size | ${positionData.positionSize} ${positionData.lotSizeLabel} |
${positionData.lotSize !== null ? `| Lot Size | ${positionData.lotSize} lots |\n` : ''}| Leverage | ${positionData.effectiveLeverage}x |

**You must now determine the DCA levels, Stop Loss, and Take Profit based on the technical structure visible in the chart screenshots.${isForex ? ' Express all price distances in pips.' : ''}**

---

Now analyze all ${timeframes.length} chart screenshots and deliver the complete trade plan. Be the genie.`;
}

// ── Response Deduplication ──
// Gemini with Google Search grounding can emit multiple text parts that repeat
// entire sections. This detects when a numbered heading (### 1.) reappears and
// truncates everything from the second occurrence onward.

function deduplicateSections(text) {
  const lines = text.split('\n');
  const seenHeadings = new Set();
  let cutIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    // Match numbered section headings: "### 1.", "## 1.", "### 2.", etc.
    const match = lines[i].match(/^#{1,4}\s+(\d+)\.\s/);
    if (match) {
      const key = match[1]; // just the number
      if (seenHeadings.has(key)) {
        // This heading number already appeared — everything from here is a repeat
        cutIndex = i;
        break;
      }
      seenHeadings.add(key);
    }
  }

  if (cutIndex > 0) {
    // Trim trailing whitespace/separators before the cut
    let end = cutIndex;
    while (end > 0 && /^(\s*|---+|\*\*\*+|___+)$/.test(lines[end - 1].trim())) {
      end--;
    }
    console.log(`[Fenie] Truncated repeated sections at line ${cutIndex} (heading "${lines[cutIndex].trim()}")`);
    return lines.slice(0, end).join('\n');
  }

  return text;
}

// ── Helpers ──

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'defaultRisk', 'defaultLeverage', 'liveApi'], resolve);
  });
}

function broadcastStatus(status, message) {
  chrome.runtime.sendMessage({ action: 'statusUpdate', status, message }).catch(() => {});
}
