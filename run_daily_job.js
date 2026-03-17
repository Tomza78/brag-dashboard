/**
 * Standalone daily job for BRAG Dashboard.
 * Can be run by Windows Task Scheduler, GitHub Actions, or manually.
 */
require('dotenv').config();
const { fetchRedditTrends } = require('./src/scraper');
const { getXIntelligence } = require('./src/x_trends');
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

async function runDailyJob() {
    const jobStartTime = new Date();
    console.log(`\n${'='.repeat(70)}`);
    console.log(`BRAG DASHBOARD - DAILY JOB STARTED: ${jobStartTime.toLocaleString()}`);
    console.log(`${'='.repeat(70)}\n`);

    try {
        // Initialize Database
        console.log('Step 0: Initializing Supabase...');
        initDB();

        // Step 1: Fetch Reddit trends
        console.log('\nStep 1: Fetching trends from Reddit...');
        const rawTrends = await fetchRedditTrends();
        const processedTrends = [];

        console.log(`Fetched ${rawTrends.length} potential candidates.`);

        // Step 2: Fetch X/Twitter intelligence via Grok
        console.log('\nStep 2: Fetching X/Twitter intelligence via Grok...');
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

        // Step 3: Process Reddit trends with AI
        console.log('\nStep 3: Processing trends with AI...');
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

        // Step 4: Generate report
        if (processedTrends.length > 0 || xIntel) {
            console.log('\nStep 4: Generating HTML report...');
            generateHTMLReport(processedTrends, xIntel);
        } else {
            console.log('\nNo relevant trends found in this run.');
        }

        const duration = ((new Date() - jobStartTime) / 1000).toFixed(2);
        console.log(`\n${'='.repeat(70)}`);
        console.log(`DAILY JOB COMPLETED SUCCESSFULLY`);
        console.log(`  Duration: ${duration} seconds`);
        console.log(`  Trends processed: ${processedTrends.length}`);
        console.log(`  X Intelligence: ${xIntel ? 'Yes' : 'No'}`);
        console.log(`${'='.repeat(70)}\n`);

        process.exit(0);
    } catch (error) {
        console.error('\nERROR in daily job:', error);
        process.exit(1);
    }
}

runDailyJob();
