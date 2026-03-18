const fetch = require('node-fetch');

/**
 * Fetches BRAG stock data from Yahoo Finance API (no auth required).
 * Gets both NASDAQ (BRAG) and TSX (BRAG.TO) data.
 */
async function fetchStockData() {
    console.log('Fetching stock data from Yahoo Finance...');

    const result = {
        price: '-',
        change: '-',
        changePercent: '-',
        priceTSX: '-',
        high52w: '-',
        low52w: '-',
        volume: '-',
        marketCap: '-',
        yoyChange: '-',
        updatedAt: new Date().toLocaleDateString('he-IL') + ' · ' + new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    };

    // Known shares outstanding for BRAG (from latest SEC/SEDAR filing)
    // Updated periodically from quarterly reports
    const SHARES_OUTSTANDING = 30_500_000; // ~30.5M diluted shares

    try {
        // Fetch NASDAQ: BRAG
        const nasdaqData = await fetchYahooQuote('BRAG');
        if (nasdaqData) {
            const price = nasdaqData.regularMarketPrice;
            result.price = price?.toFixed(2) || '-';
            const change = nasdaqData.regularMarketChange;
            const changePct = nasdaqData.regularMarketChangePercent;
            result.change = change >= 0 ? `+${change?.toFixed(2)}` : change?.toFixed(2);
            result.changePercent = changePct >= 0 ? `+${changePct?.toFixed(2)}%` : `${changePct?.toFixed(2)}%`;
            result.volume = formatNumber(nasdaqData.regularMarketVolume);
            // Calculate market cap from shares outstanding
            if (price) {
                result.marketCap = formatMarketCap(price * SHARES_OUTSTANDING);
            }
            result.high52w = nasdaqData.fiftyTwoWeekHigh ? `$${nasdaqData.fiftyTwoWeekHigh.toFixed(2)}` : '-';
            result.low52w = nasdaqData.fiftyTwoWeekLow ? `$${nasdaqData.fiftyTwoWeekLow.toFixed(2)}` : '-';
            result.dayHigh = nasdaqData.regularMarketDayHigh ? `$${nasdaqData.regularMarketDayHigh.toFixed(2)}` : '-';
            result.dayLow = nasdaqData.regularMarketDayLow ? `$${nasdaqData.regularMarketDayLow.toFixed(2)}` : '-';
            // YoY change (from 52-week high)
            if (nasdaqData.fiftyTwoWeekHigh && price) {
                const yoy = ((price - nasdaqData.fiftyTwoWeekHigh) / nasdaqData.fiftyTwoWeekHigh * 100).toFixed(0);
                result.yoyChange = `${yoy}%`;
            }
        }

        // Fetch TSX: BRAG.TO
        const tsxData = await fetchYahooQuote('BRAG.TO');
        if (tsxData) {
            result.priceTSX = tsxData.regularMarketPrice?.toFixed(2) || '-';
            result.changeTSX = tsxData.regularMarketChange >= 0
                ? `+${tsxData.regularMarketChange?.toFixed(2)}`
                : tsxData.regularMarketChange?.toFixed(2);
            result.changePercentTSX = tsxData.regularMarketChangePercent >= 0
                ? `+${tsxData.regularMarketChangePercent?.toFixed(2)}%`
                : `${tsxData.regularMarketChangePercent?.toFixed(2)}%`;
            result.volumeTSX = formatNumber(tsxData.regularMarketVolume);
        }

        // Fetch chart data (7 days)
        const chartResult = await fetchYahooChart('BRAG.TO');

        console.log('Stock data fetched successfully.');
        return { stock: result, chartData: chartResult };
    } catch (error) {
        console.error('Error fetching stock data:', error.message);
        return { stock: result, chartData: null };
    }
}

/**
 * Fetches a single quote from Yahoo Finance using chart endpoint (more reliable).
 */
async function fetchYahooQuote(symbol) {
    try {
        // Use chart endpoint with 1d range to get current quote data
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        if (!response.ok) {
            console.warn(`Yahoo Finance chart API error for ${symbol}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const meta = data?.chart?.result?.[0]?.meta;
        const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
        if (!meta) return null;

        // Get the last valid close price
        const closes = quotes?.close || [];
        const volumes = quotes?.volume || [];
        const lastClose = closes.filter(v => v !== null).pop();
        const prevClose = closes.filter(v => v !== null).slice(-2)[0];
        const lastVolume = volumes.filter(v => v !== null).pop();

        return {
            regularMarketPrice: meta.regularMarketPrice || lastClose,
            regularMarketChange: meta.regularMarketPrice && prevClose ? meta.regularMarketPrice - prevClose : 0,
            regularMarketChangePercent: meta.regularMarketPrice && prevClose ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100 : 0,
            regularMarketVolume: lastVolume,
            regularMarketDayHigh: meta.regularMarketDayHigh,
            regularMarketDayLow: meta.regularMarketDayLow,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
            currency: meta.currency,
            exchangeName: meta.exchangeName
        };
    } catch (error) {
        console.error(`Error fetching Yahoo quote for ${symbol}:`, error.message);
        return null;
    }
}

/**
 * Fetches 7-day price chart data from Yahoo Finance.
 */
async function fetchYahooChart(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=7d&interval=1d`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        if (!response.ok) {
            console.warn(`Yahoo Chart API error for ${symbol}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const result = data?.chart?.result?.[0];
        if (!result || !result.timestamp) return null;

        const timestamps = result.timestamp;
        const closes = result.indicators?.quote?.[0]?.close || [];
        const volumes = result.indicators?.quote?.[0]?.volume || [];

        const priceLabels = timestamps.map(ts => {
            const d = new Date(ts * 1000);
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        });

        const priceValues = closes.map(v => v ? parseFloat(v.toFixed(2)) : null);
        const volumeValues = volumes.map(v => v ? Math.round(v / 1000) : 0);

        return {
            priceLabels,
            priceValues,
            volumeLabels: priceLabels,
            volumeValues
        };
    } catch (error) {
        console.error(`Error fetching Yahoo chart for ${symbol}:`, error.message);
        return null;
    }
}

function formatNumber(num) {
    if (!num) return '-';
    return num.toLocaleString('en-US');
}

function formatMarketCap(cap) {
    if (!cap) return '-';
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
    return `$${cap.toLocaleString()}`;
}

module.exports = { fetchStockData };
