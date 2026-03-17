const express = require('express');
const { fetchRedditTrends } = require('./scraper');
const { getXIntelligence } = require('./x_trends');
const { summarizePost, categorizePost, summarizeComments } = require('./ai');
const { initDB, saveTrend, getTrend, saveXIntelligence, getLatestXIntelligence, getTrendsByDate } = require('./db');
const { fetchStockData } = require('./finance');
const { fetchAllNews } = require('./news_scraper');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static('public'));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/template.html'));
});

let latestTrends = [];

/**
 * Main daily job: fetch Reddit + X data, process with AI, save to Supabase, generate report.
 */
async function runDailyJob() {
    const jobStartTime = new Date();
    console.log(`[${jobStartTime.toLocaleString()}] Starting daily job...`);

    try {
        // Step 1: Fetch stock data from Yahoo Finance
        console.log('Step 1: Fetching stock data from Yahoo Finance...');
        const financeData = await fetchStockData();

        // Step 1b: Fetch news from industry sources
        console.log('Step 1b: Fetching news from industry sources...');
        const newsSections = await fetchAllNews(5);

        // Step 2: Fetch Reddit trends
        console.log('Step 2: Fetching trends from Reddit...');
        const rawTrends = await fetchRedditTrends();
        const processedTrends = [];

        console.log(`Fetched ${rawTrends.length} potential candidates.`);

        // Step 3: Fetch X/Twitter intelligence via Grok
        console.log('Step 3: Fetching X/Twitter intelligence via Grok...');
        let xIntel = await getLatestXIntelligence();
        if (!xIntel) {
            const freshXData = await getXIntelligence();
            if (freshXData) {
                await saveXIntelligence(freshXData);
                xIntel = freshXData;
            }
        } else {
            console.log('  Using cached X intelligence from today.');
        }

        // Step 4: Process Reddit trends with AI
        console.log('Step 4: Processing trends with AI...');
        for (const trend of rawTrends) {
            let existingTrend = null;
            try {
                existingTrend = await getTrend(trend.id);
            } catch (err) {
                console.error(`Error checking DB for ${trend.id}:`, err.message);
            }

            if (existingTrend) {
                console.log(`  [CACHED] ${trend.title.substring(0, 60)}...`);
                processedTrends.push(existingTrend);
                continue;
            }

            console.log(`  [NEW] Processing: ${trend.title.substring(0, 60)}...`);

            const category = await categorizePost(trend.title);
            if (!category) {
                console.log(`    Skipped (not relevant)`);
                continue;
            }

            console.log(`    Category: ${category}`);
            const summary = await summarizePost(trend.title, trend.selftext);
            const commentsSummary = await summarizeComments(trend.top_comments);

            const processedPost = {
                ...trend,
                summary_he: summary,
                category_he: category,
                comments_summary_he: commentsSummary
            };

            await saveTrend(processedPost);
            processedTrends.push(processedPost);
        }

        latestTrends = processedTrends;

        // Step 5: Generate both reports
        const xIntelData = xIntel ? (xIntel.data || xIntel) : null;
        generateHTMLReport(latestTrends, xIntelData);
        generateIntelReport(financeData, latestTrends, xIntelData, newsSections);
        console.log(`Updated reports with ${latestTrends.length} trends.`);

        const duration = ((new Date() - jobStartTime) / 1000).toFixed(2);
        console.log(`Daily job completed in ${duration} seconds. Processed: ${processedTrends.length} trends.`);
    } catch (error) {
        console.error('ERROR in daily job:', error);
    }
}

/**
 * Generates public/data.js with trends and X intelligence.
 */
function generateHTMLReport(trends, xIntel) {
    const reportData = {
        trends: trends,
        xIntelligence: xIntel ? xIntel.data || xIntel : null,
        generatedAt: new Date().toISOString()
    };

    const dataJsContent = `window.dashboardData = ${JSON.stringify(reportData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, '../public/data.js'), dataJsContent);
    console.log('Report data generated at public/data.js');
}

/**
 * Generates public/intel-data.js with the full intelligence report data.
 * Used by intel.html (the professional dashboard).
 */
function generateIntelReport(financeData, trends, xIntelData, newsSections) {
    const now = new Date();
    const stock = financeData?.stock || {};
    const chartData = financeData?.chartData || null;

    // Build social media articles from Reddit trends
    const socialArticles = trends
        .filter(t => t.source === 'reddit')
        .slice(0, 5)
        .map(t => ({
            date: new Date(t.created_utc * 1000).toISOString().split('T')[0],
            title: `Reddit: ${t.title}`,
            summary_he: t.summary_he || 'תקציר לא זמין',
            source: `Reddit r/${t.subreddit}`,
            url: t.url
        }));

    // Build X intelligence social opinions from Grok data
    const opinions = [];
    if (xIntelData) {
        const topics = ['brag_stock', 'us_regulation', 'brazil_market', 'netherlands_ksa', 'igaming_industry'];
        topics.forEach(key => {
            const info = xIntelData[key];
            if (info && info.summary) {
                opinions.push({
                    text: info.summary,
                    platform: `X/Grok · ${key.replace(/_/g, ' ')}`
                });
            }
        });
    }

    // Calculate sentiment score from X intel
    let sentimentScore = 5;
    let sentimentLabel = 'ניטרלי';
    if (xIntelData) {
        let pos = 0, neg = 0, total = 0;
        const topics = ['brag_stock', 'us_regulation', 'brazil_market', 'netherlands_ksa', 'igaming_industry'];
        topics.forEach(key => {
            const info = xIntelData[key];
            if (info && info.sentiment) {
                total++;
                if (info.sentiment.includes('חיובי')) pos++;
                if (info.sentiment.includes('שלילי')) neg++;
            }
        });
        if (total > 0) {
            sentimentScore = Math.round(((pos * 8 + (total - pos - neg) * 5 + neg * 2) / total) * 10) / 10;
            if (sentimentScore >= 7) sentimentLabel = 'חיובי';
            else if (sentimentScore >= 5) sentimentLabel = 'מעורב-חיובי';
            else if (sentimentScore >= 3) sentimentLabel = 'מעורב-שלילי';
            else sentimentLabel = 'שלילי';
        }
    }

    // Build sections from scraped news + Reddit social media
    const sections = { ...(newsSections || {}) };
    if (socialArticles.length > 0) {
        sections.social_media = {
            title: 'BRAG ברשתות החברתיות',
            icon: '💬',
            color: 'rgba(255,214,0,0.15)',
            articles: socialArticles
        };
    }

    // Read existing watchpoints (keep them as-is, they're manually curated)
    let existingWatchpoints = [];
    if (fs.existsSync(existingPath)) {
        try {
            const content = fs.readFileSync(existingPath, 'utf8');
            const match = content.match(/window\.intelData\s*=\s*({[\s\S]*});?\s*$/);
            if (match) {
                existingWatchpoints = JSON.parse(match[1]).watchpoints || [];
            }
        } catch (e) { /* ignore */ }
    }

    const intelData = {
        stock: stock,
        chartData: chartData,
        socialMedia: {
            sentimentScore,
            sentimentLabel,
            opinions: opinions.length > 0 ? opinions : undefined
        },
        watchpoints: existingWatchpoints,
        xIntelligence: xIntelData,
        sections: sections
    };

    const intelJsContent = `window.intelData = ${JSON.stringify(intelData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, '../public/intel-data.js'), intelJsContent);
    console.log('Intel report data generated at public/intel-data.js');
}

// API endpoints
app.get('/api/history', async (req, res) => {
    try {
        const trends = await getTrendsByDate();
        res.json(trends);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.get('/api/x-intel', async (req, res) => {
    try {
        const intel = await getLatestXIntelligence();
        res.json(intel || { message: 'No X intelligence available for today' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch X intelligence' });
    }
});

// Start Server
app.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);

    console.log('Checking Environment:');
    console.log(`- GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? 'OK' : 'MISSING'}`);
    console.log(`- SUPABASE_URL: ${process.env.SUPABASE_URL ? 'OK' : 'MISSING'}`);
    console.log(`- SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? 'OK' : 'MISSING'}`);
    console.log(`- XAI_API_KEY: ${process.env.XAI_API_KEY ? 'OK' : 'MISSING'}`);

    initDB();

    if (!fs.existsSync(path.join(__dirname, '../public/data.js'))) {
        console.log('No data found. Running initial job...');
        await runDailyJob();
    }

    // Schedule daily at 8:00 AM Israel time
    cron.schedule('0 8 * * *', () => {
        console.log(`\nCRON JOB TRIGGERED at ${new Date().toLocaleString()}\n`);
        runDailyJob();
    }, {
        scheduled: true,
        timezone: 'Asia/Jerusalem'
    });

    console.log('Cron job scheduled for 8:00 AM daily (Asia/Jerusalem)');

    app.post('/api/run-job', async (req, res) => {
        console.log('\n[MANUAL TRIGGER] Daily job started via API');
        try {
            await runDailyJob();
            res.json({ success: true, message: 'Daily job completed' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
});

module.exports = { runDailyJob, generateHTMLReport, generateIntelReport };
