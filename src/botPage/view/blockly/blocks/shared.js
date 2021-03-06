import { oppositesToDropdown } from '../utils';
import { symbolApi } from '../../shared';
import config from '../../../common/const';
import { generateLiveApiInstance } from '../../../../common/appId';
import { translate } from '../../../../common/i18n';
import {
    get as getStorage,
    set as setStorage,
    getTokenList,
    removeAllTokens,
} from '../../../../common/utils/storageManager';

let purchaseChoices = [[translate('Click to select'), '']];

export const getPurchaseChoices = () => purchaseChoices;

const filterPurchaseChoices = (contractType, oppositesName) => {
    const { [oppositesName]: tradeTypes } = config.opposites;

    let tmpPurchaseChoices = tradeTypes.filter(k =>
        contractType === 'both' ? true : contractType === Object.keys(k)[0]
    );

    if (!tmpPurchaseChoices.length) {
        tmpPurchaseChoices = tradeTypes;
    }
    return oppositesToDropdown(tmpPurchaseChoices);
};

export const updatePurchaseChoices = (contractType, oppositesName) => {
    purchaseChoices = filterPurchaseChoices(contractType, oppositesName);
    const purchases = Blockly.mainWorkspace
        .getAllBlocks()
        .filter(r => ['purchase', 'payout', 'ask_price'].indexOf(r.type) >= 0);
    Blockly.Events.recordUndo = false;
    purchases.forEach(purchase => {
        const value = purchase.getField('PURCHASE_LIST').getValue();
        Blockly.WidgetDiv.hideIfOwner(purchase.getField('PURCHASE_LIST'));
        if (value === purchaseChoices[0][1]) {
            purchase.getField('PURCHASE_LIST').setText(purchaseChoices[0][0]);
        } else if (purchaseChoices.length === 2 && value === purchaseChoices[1][1]) {
            purchase.getField('PURCHASE_LIST').setText(purchaseChoices[1][0]);
        } else {
            purchase.getField('PURCHASE_LIST').setValue(purchaseChoices[0][1]);
            purchase.getField('PURCHASE_LIST').setText(purchaseChoices[0][0]);
        }
    });
    Blockly.Events.recordUndo = true;
};

export const expectValue = (block, field) => {
    const value = Blockly.JavaScript.valueToCode(block, field, Blockly.JavaScript.ORDER_ATOMIC);
    if (!value) {
        throw Error(translate(`${field} cannot be empty`));
    }
    return value;
};

export const fieldGeneratorMapping = {};

const getActiveSymbols = symbols =>
    Object.keys(symbols).reduce(
        (acc, symbol) =>
            symbolApi.getAllowedCategories(symbol).length ? { ...acc, [symbol]: symbols[symbol] } : { ...acc },
        {}
    );

const getActiveSubMarket = submarkets =>
    Object.keys(submarkets).reduce(
        (acc, submarket) =>
            Object.keys(getActiveSymbols(submarkets[submarket].symbols)).length
                ? { ...acc, [submarket]: submarkets[submarket] }
                : { ...acc },
        {}
    );

const getActiveMarket = markets =>
    Object.keys(markets).reduce(
        (acc, market) =>
            Object.keys(getActiveSubMarket(markets[market].submarkets)).length
                ? { ...acc, [market]: markets[market] }
                : { ...acc },
        {}
    );

fieldGeneratorMapping.MARKET_LIST = () => {
    const markets = getActiveMarket(symbolApi.activeSymbols.getMarkets());
    return Object.keys(markets).map(e => [markets[e].name, e]);
};

fieldGeneratorMapping.SUBMARKET_LIST = block => () => {
    const markets = getActiveMarket(symbolApi.activeSymbols.getMarkets());
    const marketName = block.getFieldValue('MARKET_LIST');
    if (!marketName || marketName === 'Invalid') {
        return [['', 'Invalid']];
    }
    const submarkets = getActiveSubMarket(markets[marketName].submarkets);
    return Object.keys(submarkets).map(e => [submarkets[e].name, e]);
};

fieldGeneratorMapping.SYMBOL_LIST = block => () => {
    const markets = getActiveMarket(symbolApi.activeSymbols.getMarkets());
    const submarketName = block.getFieldValue('SUBMARKET_LIST');
    if (!submarketName || submarketName === 'Invalid') {
        return [['', '']];
    }
    const marketName = block.getFieldValue('MARKET_LIST');
    const submarkets = getActiveSubMarket(markets[marketName].submarkets);
    const symbols = getActiveSymbols(submarkets[submarketName].symbols);
    return Object.keys(symbols).map(e => [symbols[e].display, symbols[e].symbol]);
};

fieldGeneratorMapping.TRADETYPECAT_LIST = block => () => {
    const symbol = block.getFieldValue('SYMBOL_LIST');
    if (!symbol) {
        return [['', '']];
    }
    const allowedCategories = symbolApi.getAllowedCategories(symbol.toLowerCase());
    return Object.keys(config.conditionsCategoryName)
        .filter(e => allowedCategories.indexOf(e) >= 0)
        .map(e => [config.conditionsCategoryName[e], e]);
};

fieldGeneratorMapping.TRADETYPE_LIST = block => () => {
    const tradeTypeCat = block.getFieldValue('TRADETYPECAT_LIST');
    if (!tradeTypeCat) {
        return [['', '']];
    }
    return config.conditionsCategory[tradeTypeCat].map(e => [
        config.opposites[e.toUpperCase()].map(c => c[Object.keys(c)[0]]).join('/'),
        e,
    ]);
};

export const dependentFieldMapping = {
    MARKET_LIST      : 'SUBMARKET_LIST',
    SUBMARKET_LIST   : 'SYMBOL_LIST',
    SYMBOL_LIST      : 'TRADETYPECAT_LIST',
    TRADETYPECAT_LIST: 'TRADETYPE_LIST',
};

export const getAvailableDurations = (symbol, selectedContractType) => {
    const contractsForStore = JSON.parse(getStorage('contractsForStore') || '[]');
    let tokenList = getTokenList();
    const defaultDurations = [
        [translate('Ticks'), 't'],
        [translate('Seconds'), 's'],
        [translate('Minutes'), 'm'],
        [translate('Hours'), 'h'],
        [translate('Days'), 'd'],
    ];

    const getContractsForSymbolFromApi = async underlyingSymbol => {
        // Refactor this when reducing WS connections
        const api = generateLiveApiInstance();

        // Try to authorize for accurate contracts response
        if (tokenList.length) {
            try {
                await api.authorize(tokenList[0].token);
            } catch (e) {
                removeAllTokens();
                tokenList = [];
            }
        }

        const response = await api.getContractsForSymbol(underlyingSymbol);
        const contractsForSymbol = {};
        if (response.contracts_for) {
            Object.assign(contractsForSymbol, {
                symbol   : underlyingSymbol,
                available: response.contracts_for.available,
                timestamp: Date.now(),
            });
            if (tokenList.length) {
                Object.assign(contractsForSymbol, {
                    accountName: tokenList[0].accountName,
                });
            }
            // Avoid duplicate symbols in contractsForStore
            contractsForStore
                .filter(c => c.symbol === underlyingSymbol)
                .forEach(() =>
                    contractsForStore.splice(contractsForStore.findIndex(c => c.symbol === underlyingSymbol), 1)
                );
            contractsForStore.push(contractsForSymbol);
            setStorage('contractsForStore', JSON.stringify(contractsForStore));
        }
        api.disconnect();
        return contractsForSymbol;
    };
    const getDurationsForContract = contractsForSymbol => {
        if (!contractsForSymbol) return defaultDurations;

        // Resolve contract_category (e.g. risefall = callput)
        const contractCategory = Object.keys(config.conditionsCategory).find(
            c => c === selectedContractType || config.conditionsCategory[c].includes(selectedContractType)
        );

        // Get contracts based on `contract_category` and `barrier_category`
        const contractsForContractCategory = contractsForSymbol.filter(c => {
            const meetsBarrierConditions = () => {
                const conditions = [];
                Object.keys(config.barrierCategories).some(barrierCategory => {
                    if (config.barrierCategories[barrierCategory].includes(selectedContractType)) {
                        conditions.push(c.barrier_category === barrierCategory);
                    }
                    return conditions.length;
                });
                // If `barrierCategory` for `selectedContractType` not found fallback to all contracts for durations
                return !conditions.includes(false);
            };
            // We don't offer forward-starting contracts in Binary Bot, remove these
            if (c.start_type === 'forward') {
                return false;
            }
            return c.contract_category === contractCategory && meetsBarrierConditions();
        });

        const getDurationIndex = input => defaultDurations.findIndex(d => d[1] === input.replace(/\d+/g, ''));

        // Generate list of available durations from filtered contracts
        const offeredDurations = [];
        contractsForContractCategory.forEach(c => {
            const startIndex = getDurationIndex(c.min_contract_duration);
            const endIndex = getDurationIndex(c.max_contract_duration === '1d' ? '24h' : c.max_contract_duration);
            defaultDurations.slice(startIndex, endIndex + 1).forEach(duration => {
                if (!offeredDurations.includes(duration)) {
                    offeredDurations.push(duration);
                }
            });
        });
        // If only intraday contracts are available, remove day-durations
        if (contractsForContractCategory.every(c => c.expiry_type === 'intraday')) {
            const dayDurationIndex = offeredDurations.findIndex(d => d[1] === 'd');
            if (dayDurationIndex !== -1) {
                offeredDurations.splice(dayDurationIndex, 1);
            }
        }
        offeredDurations.sort((a, b) => getDurationIndex(a[1]) - getDurationIndex(b[1]));
        return offeredDurations;
    };

    const getFreshContractsFor = () =>
        new Promise(resolve => {
            getContractsForSymbolFromApi(symbol).then(contractsForSymbolFromApi => {
                resolve(getDurationsForContract(contractsForSymbolFromApi.available));
            });
        });

    // Check if we have local data to get durations from
    const contractsForSymbol = contractsForStore.find(c => c.symbol === symbol);
    if (contractsForSymbol) {
        const isDifferentAccount = () =>
            tokenList.length && contractsForSymbol.accountName !== tokenList[0].accountName;
        const isExpiredData = () => Math.floor((Date.now() - contractsForSymbol.timestamp) / 1000) > 600;
        if (isDifferentAccount()) {
            return getFreshContractsFor();
        } else if (isExpiredData()) {
            // Return cached data, update cached data in background
            getContractsForSymbolFromApi(symbol);
        }
        return Promise.resolve(getDurationsForContract(contractsForSymbol.available));
    }
    return getFreshContractsFor();
};
