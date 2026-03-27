/**
 * AssetFactory — Determines asset class and provides class-specific logic.
 */

const ASSET_CLASSES = {
  CRYPTO: 'crypto',
  FOREX: 'forex',
  GOLD: 'gold',
  UNKNOWN: 'unknown'
};

const FOREX_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD',
  'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY',
  'CHFJPY', 'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD',
  'GBPCAD', 'GBPCHF', 'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD',
  'CADCHF', 'NZDCAD', 'NZDCHF', 'NZDJPY'
];

const GOLD_SYMBOLS = ['XAUUSD', 'GOLD', 'GC1!', 'GC2!', 'XAGUSD', 'SILVER', 'SI1!', 'SI2!'];

const CRYPTO_SUFFIXES = ['USD', 'USDT', 'USDC', 'BTC', 'ETH', 'BUSD', 'PERP'];

function detectAssetClass(ticker) {
  const clean = ticker.replace(/^[A-Z]+:/, '').toUpperCase();

  if (GOLD_SYMBOLS.includes(clean) || clean.startsWith('XAUUSD')) {
    return ASSET_CLASSES.GOLD;
  }

  if (FOREX_PAIRS.includes(clean)) {
    return ASSET_CLASSES.FOREX;
  }

  for (const suffix of CRYPTO_SUFFIXES) {
    if (clean.endsWith(suffix) && clean.length > suffix.length) {
      return ASSET_CLASSES.CRYPTO;
    }
  }

  return ASSET_CLASSES.UNKNOWN;
}

function getAssetConfig(assetClass) {
  switch (assetClass) {
    case ASSET_CLASSES.CRYPTO:
      return {
        leverageAllowed: true,
        maxLeverage: 125,
        dcaSpread: [0.02, 0.04, 0.07, 0.12],
        lotSizeLabel: 'Quantity',
        pipValue: null,
        contractSize: null
      };
    case ASSET_CLASSES.FOREX:
      return {
        leverageAllowed: true,
        maxLeverage: 500,
        dcaSpread: [0.003, 0.006, 0.01, 0.015],
        lotSizeLabel: 'Lots',
        pipValue: 10,
        contractSize: 100000
      };
    case ASSET_CLASSES.GOLD:
      return {
        leverageAllowed: true,
        maxLeverage: 200,
        dcaSpread: [0.005, 0.01, 0.018, 0.03],
        lotSizeLabel: 'Lots',
        pipValue: 10,
        contractSize: 100
      };
    default:
      return {
        leverageAllowed: true,
        maxLeverage: 50,
        dcaSpread: [0.02, 0.04, 0.07, 0.12],
        lotSizeLabel: 'Quantity',
        pipValue: null,
        contractSize: null
      };
  }
}

export { ASSET_CLASSES, detectAssetClass, getAssetConfig };
