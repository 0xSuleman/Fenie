# Software Engineering Principles — TradeGenie

## 1. Modularity
- **Automation vs. Analysis**: The logic for manipulating the TradingView UI must be entirely decoupled from the LLM prompt logic. 
- **View vs. Controller**: The side panel (View) should only handle display and input; the Service Worker (Controller) handles all data processing.

## 2. Separation of Concerns (SoC)
- **Mathematical Accuracy**: The JavaScript engine is the "Source of Truth" for math. The AI is the "Source of Interpretation." Never let them swap roles.
- **Input Validation**: The UI must prevent invalid inputs (e.g., negative risk, >125x leverage) before any automation begins.

## 3. Robustness & The 10-Second Rule
- **Fail-Fast Automation**: If a timeframe fails to switch within a 3-second timeout, the extension should notify the user and attempt to proceed with the current view rather than hanging.
- **State Persistence**: If the side panel is closed, the `background.js` should maintain the current analysis state so it can be re-rendered immediately upon re-opening.

## 4. Anticipation of Change
- **Model Agnostic**: Model names are stored in a dropdown. Switching from `gemini-3-flash` to a future `gemini-4` should require zero code changes.
- **Asset Classes**: The logic for Forex, Crypto, and Gold must be abstracted into a single `AssetFactory` to easily add new classes (e.g., Stocks or Options) later.

## 5. Correctness & Rigor
- **Prompt Consistency**: Use a system-level template for the LLM to ensure the "Trade Setup" table is returned with consistent columns every time.
- **Grounding Verification**: Ensure the "News Sentiment" section of the prompt explicitly requests citations or links via Gemini's `Google Search` tool.