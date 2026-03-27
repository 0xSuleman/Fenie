/**
 * RiskEngine — Pure JS calculations for position sizing, DCA levels, and hedge setups.
 * The LLM never does math — this module is the source of truth.
 */

import { detectAssetClass, getAssetConfig, ASSET_CLASSES } from './asset-factory.js';

/**
 * Calculate position size based on portfolio, risk, and leverage.
 */
function calculatePositionSize({ portfolio, riskPercent, leverage, currentPrice, ticker, tradeType, lotSize: userLotSize }) {
  const assetClass = detectAssetClass(ticker);
  const config = getAssetConfig(assetClass);

  const riskAmount = portfolio * (riskPercent / 100);

  // Forex mode: user specifies lot size directly
  // Only apply lot-size logic when the asset has a contractSize (forex/gold)
  if (tradeType === 'forex' && userLotSize && config.contractSize) {
    const ls = parseFloat(userLotSize);
    let notionalValue;
    if (assetClass === ASSET_CLASSES.GOLD) {
      notionalValue = ls * config.contractSize * currentPrice;
    } else {
      notionalValue = ls * config.contractSize;
    }
    return {
      assetClass,
      riskAmount: round(riskAmount, 2),
      notionalValue: round(notionalValue, 2),
      positionSize: round(notionalValue, 6),
      lotSize: round(ls, 4),
      effectiveLeverage: round(notionalValue / portfolio, 1),
      lotSizeLabel: config.lotSizeLabel,
      currentPrice
    };
  }

  // Spot / Futures mode
  const effectiveLeverage = tradeType === 'spot' ? 1 : Math.min(leverage, config.maxLeverage);
  const notionalValue = riskAmount * effectiveLeverage;

  let positionSize, lotSize = null;

  if (assetClass === ASSET_CLASSES.FOREX) {
    lotSize = notionalValue / config.contractSize;
    positionSize = notionalValue;
  } else if (assetClass === ASSET_CLASSES.GOLD) {
    lotSize = notionalValue / (currentPrice * config.contractSize);
    positionSize = notionalValue;
  } else {
    positionSize = notionalValue / currentPrice;
  }

  return {
    assetClass,
    riskAmount: round(riskAmount, 2),
    notionalValue: round(notionalValue, 2),
    positionSize: round(positionSize, 6),
    lotSize: lotSize !== null ? round(lotSize, 4) : null,
    effectiveLeverage,
    lotSizeLabel: config.lotSizeLabel,
    currentPrice
  };
}

/**
 * Generate DCA levels for a given direction.
 */
function generateDCALevels({ currentPrice, direction, ticker, levels = 4 }) {
  const assetClass = detectAssetClass(ticker);
  const config = getAssetConfig(assetClass);
  const spreads = config.dcaSpread.slice(0, levels);

  return spreads.map((spread, i) => {
    const multiplier = direction === 'long'
      ? 1 - spread
      : 1 + spread;
    const price = currentPrice * multiplier;
    return {
      level: i + 1,
      price: round(price, getPrecision(assetClass)),
      percentFromEntry: round(spread * 100, 2),
      label: `DCA ${i + 1}`
    };
  });
}

/**
 * Generate a hedge (Plan B) trade setup in the opposite direction.
 */
function generateHedgeSetup({ currentPrice, direction, ticker, riskAmount }) {
  const oppositeDir = direction === 'long' ? 'short' : 'long';
  const assetClass = detectAssetClass(ticker);
  const precision = getPrecision(assetClass);

  const hedgeEntry = direction === 'long'
    ? round(currentPrice * 0.97, precision)
    : round(currentPrice * 1.03, precision);

  const hedgeSL = direction === 'long'
    ? round(hedgeEntry * 1.02, precision)
    : round(hedgeEntry * 0.98, precision);

  const hedgeTP = direction === 'long'
    ? round(hedgeEntry * 0.94, precision)
    : round(hedgeEntry * 1.06, precision);

  const hedgeDCA = generateDCALevels({
    currentPrice: hedgeEntry,
    direction: oppositeDir,
    ticker,
    levels: 3
  });

  return {
    direction: oppositeDir,
    triggerCondition: direction === 'long'
      ? `Price breaks below ${hedgeEntry}`
      : `Price breaks above ${hedgeEntry}`,
    entry: hedgeEntry,
    stopLoss: hedgeSL,
    takeProfit: hedgeTP,
    riskAmount: round(riskAmount * 0.5, 2),
    dcaLevels: hedgeDCA
  };
}

function getPrecision(assetClass) {
  switch (assetClass) {
    case ASSET_CLASSES.FOREX: return 5;
    case ASSET_CLASSES.GOLD: return 2;
    case ASSET_CLASSES.CRYPTO: return 4;
    default: return 4;
  }
}

function round(value, decimals) {
  return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

export {
  calculatePositionSize,
  generateDCALevels,
  generateHedgeSetup,
  round
};
