/**
 * Standalone daily job for BRAG Dashboard.
 * Can be run by Windows Task Scheduler, GitHub Actions, or manually.
 */
require('dotenv').config();
const { fetchRedditTrends } = require('./src/scraper');
const { getXIntelligence } = require('./src/x_trends');
const { fetchStockData } = require('./src/finance');
const { fetchAllNews } = require('./src/news_scraper');
const { summarizePost, categorizePost, summarizeComments } = require('./src/ai');
const { initDB, getTrend, saveTrend, saveXIntelligence, getLatestXIntelligence } = require('./src/db');
const path = require('path');
const fs = require('fs');

function generateHTMLReport(trends, xIntel) {
    const reportData = {
        trends: trends,
        xIntelligence: xIntel ? xIntel.data || xIntel : null,
        generatedAt: new Date().toISOString()
    };

    const dataJsContent = `window.dashboardData = ${JSON.stringify(reportData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'public/data.js'), dataJsContent);
    console.log('Report data generated at public/data.js');
}

function generateIntelReport(financeData, trends, xIntelData, newsSections) {
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

    // Build opinions from Grok data
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

    // Calculate sentiment
    let sentimentScore = 5;
    let sentimentLabel = 'ניטרלי';
    if (xIntelData) {
        let pos = 0, neg = 0, total = 0;
        ['brag_stock', 'us_regulation', 'brazil_market', 'netherlands_ksa', 'igaming_industry'].forEach(key => {
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

    // Read existing watchpoints and opinions (keep them)
    let existingWatchpoints = [];
    let existingOpinions = [];
    const existingPath = path.join(__dirname, 'public/intel-data.js');
    if (fs.existsSync(existingPath)) {
        try {
            const content = fs.readFileSync(existingPath, 'utf8');
            const match = content.match(/window\.intelData\s*=\s*({[\s\S]*});?\s*$/);
            if (match) {
                const parsed = JSON.parse(match[1]);
                existingWatchpoints = parsed.watchpoints || [];
                existingOpinions = parsed.socialMedia?.opinions || [];
            }
        } catch (e) {
            console.warn('Could not parse existing intel-data.js:', e.message);
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

    const intelData = {
        stock: stock,
        chartData: chartData,
        socialMedia: {
            sentimentScore,
            sentimentLabel,
            opinions: opinions.length > 0 ? opinions : existingOpinions
        },
        watchpoints: existingWatchpoints,
        xIntelligence: xIntelData,
        sections: sections
    };

    const intelJsContent = `window.intelData = ${JSON.stringify(intelData, null, 2)};`;
    fs.writeFileSync(path.join(__dirname, 'public/intel-data.js'), intelJsContent);
    console.log('Intel report data generated at public/intel-data.js');
}

async function runDailyJob() {
    const jobStartTime = new Date();
    console.log(`\n${'='.repeat(70)}`);
    console.log(`BRAG DASHBOARD - DAILY JOB STARTED: ${jobStartTime.toLocaleString()}`);
    console.log(`${'='.repeat(70)}\n`);

    try {
        // Initialize Database
        console.log('Step 0: Initializing Supabase...');
        initDB();

        // Step 1: Fetch stock data from Yahoo Finance
        console.log('\nStep 1: Fetching stock data from Yahoo Finance...');
        const financeData = await fetchStockData();

        // Step 1b: Fetch news from industry sources
        console.log('\nStep 1b: Fetching news from industry sources...');
        const newsSections = await fetchAllNews(5);
        console.log(`  Fetched ${Object.keys(newsSections).length} news sections`);

        // Step 2: Fetch Reddit trends
        console.log('\nStep 2: Fetching trends from Reddit...');
        const rawTrends = await fetchRedditTrends();
        const processedTrends = [];

        console.log(`Fetched ${rawTrends.length} potential candidates.`);

        // Step 3: Fetch X/Twitter intelligence via Grok
        console.log('\nStep 3: Fetching X/Twitter intelligence via Grok...');
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
        console.log('\nStep 4: Processing trends with AI...');
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
            console.log(`    Saved to database`);
        }

        // Step 5: Generate both reports
        const xIntelData = xIntel ? (xIntel.data || xIntel) : null;
        console.log('\nStep 5: Generating reports...');
        generateHTMLReport(processedTrends, xIntel);
        generateIntelReport(financeData, processedTrends, xIntelData, newsSections);

        const duration = ((new Date() - jobStartTime) / 1000).toFixed(2);
        console.log(`\n${'='.repeat(70)}`);
        console.log(`DAILY JOB COMPLETED SUCCESSFULLY`);
        console.log(`  Duration: ${duration} seconds`);
        console.log(`  Trends processed: ${processedTrends.length}`);
        console.log(`  News sections: ${Object.keys(newsSections).length}`);
        console.log(`  X Intelligence: ${xIntel ? 'Yes' : 'No'}`);
        console.log(`  Stock data: NASDAQ $${financeData?.stock?.price || '-'} | TSX $${financeData?.stock?.priceTSX || '-'}`);
        console.log(`${'='.repeat(70)}\n`);

        process.exit(0);
    } catch (error) {
        console.error('\nERROR in daily job:', error);
        process.exit(1);
    }
}

runDailyJob();
