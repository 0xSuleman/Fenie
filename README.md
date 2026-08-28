# Fenie — Your Financial Genie

> **AI-powered multi-timeframe trading assistant for TradingView**

> **Authorship status:** The repository's only published commit is authored by Usman Akbar. Until the project origin and individual contributions are confirmed, Fenie must be presented as a collaboration or maintained experiment—not as sole-authored work. See [ATTRIBUTION.md](ATTRIBUTION.md).

Fenie is a Chrome Extension that automatically captures 4 timeframes (15m, 1H, 4H, 1D) from any TradingView chart and sends them to Google's Gemini AI for a complete trade analysis — including direction, entry/exit levels, DCA strategy, hedge setup, and live news sentiment.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-00897B)
![Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%20AI-8E24AA?logo=google&logoColor=white)

---

## Features

- **Automated Multi-Timeframe Capture** — One click cycles through 15m, 1H, 4H, and 1D charts with randomized jitter delays to let indicators fully render
- **AI Chart Analysis** — Gemini 2.5 Flash reads your exact chart setup (your indicators, your drawings) instead of guessing
- **Indicator Legend Scraping** — Exact indicator values (EMA, RSI, etc.) are scraped from TradingView's DOM and sent alongside screenshots, so the AI never hallucinates numbers
- **Pure JS Risk Engine** — Position sizing, lot sizes, and risk amounts are calculated in JavaScript before being passed to the AI. The LLM never does math.
- **3 Trade Modes** — Spot, Futures, and Forex with pill-button selection
- **Forex / Gold Support** — When Forex mode is selected, the UI switches to lot-size input with pip-based analysis, supporting XAUUSD, GBPUSD, EURUSD, and all major pairs
- **Google Search Grounding** — The AI searches for live news, sentiment, and ATR values to validate its analysis
- **Chat History** — All analyses are saved locally and can be reviewed anytime
- **Premium Dark UI** — Glass morphism, gold accents, Montserrat typography

---

## Setup Guide

### 1. Get a Gemini API Key (Free)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the generated key — you'll need it in step 3

> The free tier provides generous usage limits. Fenie downscales screenshots to 720p to stay within token limits.

### 2. Install the Extension

1. Download or clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/Fenie.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **"Load unpacked"**
5. Select the `Fenie` folder (the one containing `manifest.json`)
6. Fenie's icon will appear in your Chrome toolbar

### 3. Configure Your API Key

1. Click the **Fenie icon** in the toolbar to open the side panel
2. Click the **gear icon** (top-right) to open Settings
3. Paste your **Gemini API Key** in the API Key field
4. Click **Save Settings**

### 4. Start Analyzing

1. Open any chart on [TradingView](https://www.tradingview.com/)
2. Click the Fenie icon to open the side panel
3. Set your **Portfolio size**, **Risk %**, and select your **Trade Mode** (Spot / Futures / Forex)
4. Click **Analyze** — Fenie will:
   - Detect your ticker and current price
   - Cycle through 4 timeframes (15m → 1H → 4H → 1D)
   - Capture each chart screenshot
   - Scrape indicator values from the chart legend
   - Send everything to Gemini AI
   - Display the complete trade plan

---

## Trade Modes

| Mode | Input Field | Use Case |
|------|------------|----------|
| **Spot** | Leverage locked to 1x | Buying/holding crypto, stocks |
| **Futures** | Leverage (1x–500x) | Leveraged crypto/futures trading |
| **Forex** | Lot Size (0.01–100) | FX pairs (GBPUSD, EURUSD) and commodities (XAUUSD, XAGUSD) |

When **Forex** is selected:
- The Leverage input becomes a **Lot Size** input
- The AI uses **pip-based analysis** (distances in pips, not dollars)
- Position sizing uses standard forex lot calculations (1 lot = 100,000 units for FX, 100 oz for Gold)
- The AI includes session timing and economic calendar context

---

## What the AI Delivers

Every analysis includes these sections:

1. **Direction & Conviction** — LONG/SHORT with HIGH/MEDIUM/LOW confidence
2. **Multi-Timeframe Technical Summary** — One-line breakdown per timeframe + confluence
3. **Position Data** — Pre-calculated risk amounts, position size, lot size
4. **Entry / Stop Loss / Take Profit** — Price levels with rationale (pip distances for Forex)
5. **DCA Strategy** — 3-4 dollar-cost-average levels based on support/resistance
6. **Hedge Setup (Plan B)** — Opposite-direction trade if primary bias fails
7. **News & Sentiment** — Live news via Google Search with overall bias

---

## Project Structure

```
Fenie/
├── manifest.json           # Chrome MV3 extension config
├── background.js           # Service worker — capture pipeline, Gemini API, risk engine orchestration
├── scripts/
│   └── content.js          # TradingView DOM interaction — ticker detection, TF switching, legend scraping
├── sidepanel/
│   ├── sidepanel.html      # Main UI
│   ├── sidepanel.css       # Premium dark theme
│   └── sidepanel.js        # UI controller, markdown renderer, chat history
├── settings/
│   ├── settings.html       # Settings page
│   ├── settings.css        # Settings theme
│   └── settings.js         # API key & defaults management
├── utils/
│   ├── asset-factory.js    # Asset class detection (crypto/forex/gold)
│   ├── risk-engine.js      # Position sizing, DCA, hedge calculations
│   └── image-utils.js      # Screenshot downscaling for token optimization
├── icons/                  # Extension icons (16/32/48/128px)
└── README.md
```

---

## Architecture

```
TradingView Tab                    Fenie Side Panel
     │                                    │
     │  content.js                        │  sidepanel.js
     │  ├─ getTicker()                    │  ├─ Pill buttons (Spot/Futures/Forex)
     │  ├─ switchTimeframe()              │  ├─ Portfolio/Risk/Leverage inputs
     │  └─ getLegends()                   │  ├─ Markdown renderer
     │         │                          │  └─ Chat history
     │         ▼                          │
     └────── background.js ◄──────────────┘
              (Service Worker)
              ├─ Capture pipeline (4 TFs)
              ├─ Image downscaling
              ├─ Risk engine (pure JS math)
              ├─ Gemini API (multimodal)
              ├─ Response deduplication
              └─ State management
```

---

## Important Notes

- **API Key Security** — Your Gemini API key is stored in `chrome.storage.sync` (encrypted by Chrome). It is never hardcoded or exposed.
- **No Data Leaves Your Browser** — Chart screenshots are sent directly to Google's Gemini API. Fenie has no backend server.
- **Free Tier Friendly** — Screenshots are downscaled to ~720p to stay within Gemini's free TPM limits.
- **TradingView Only** — Fenie works exclusively on `tradingview.com` charts.

---

## Disclaimer

*This extension is for informational purposes only and does not constitute financial advice. Trading involves significant risk. Always do your own research before making trading decisions.*

---

## License

MIT
