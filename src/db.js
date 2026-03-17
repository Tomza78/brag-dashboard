const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let supabase = null;

function initDB() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        console.error('CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_KEY missing!');
        return;
    }

    supabase = createClient(url, key);
    console.log('Supabase initialized successfully.');
}

/**
 * Gets a trend by its ID. Returns null if not found.
 */
async function getTrend(id) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('trends')
            .select('*')
            .eq('id', id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error(`Error fetching trend ${id}:`, error.message);
        }
        return data || null;
    } catch (error) {
        console.error(`Error fetching trend ${id}:`, error.message);
        return null;
    }
}

/**
 * Saves a single trend to Supabase.
 */
async function saveTrend(trend) {
    if (!supabase) {
        console.log('Database not initialized. Skipping save.');
        return;
    }

    try {
        const { error } = await supabase
            .from('trends')
            .upsert({
                id: trend.id,
                source: trend.source || 'reddit',
                title: trend.title,
                url: trend.url,
                author: trend.author,
                score: trend.score,
                selftext: trend.selftext,
                subreddit: trend.subreddit,
                created_utc: trend.created_utc,
                top_comments: trend.top_comments,
                summary_he: trend.summary_he,
                category_he: trend.category_he,
                comments_summary_he: trend.comments_summary_he,
                date_string: new Date().toISOString().split('T')[0],
                saved_at: new Date().toISOString()
            }, { onConflict: 'id' });

        if (error) throw error;
        console.log(`Trend ${trend.id} saved to Supabase.`);
    } catch (error) {
        console.error('Error saving trend:', error.message);
    }
}

/**
 * Saves X/Twitter intelligence data.
 */
async function saveXIntelligence(xData) {
    if (!supabase || !xData) return;

    try {
        const { error } = await supabase
            .from('x_intelligence')
            .insert({
                fetched_at: xData.fetched_at,
                data: xData.data,
                date_string: new Date().toISOString().split('T')[0]
            });

        if (error) throw error;
        console.log('X intelligence saved to Supabase.');
    } catch (error) {
        console.error('Error saving X intelligence:', error.message);
    }
}

/**
 * Gets the latest X intelligence for today.
 */
async function getLatestXIntelligence() {
    if (!supabase) return null;
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
            .from('x_intelligence')
            .select('*')
            .eq('date_string', today)
            .order('fetched_at', { ascending: false })
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching X intelligence:', error.message);
        }
        return data || null;
    } catch (error) {
        console.error('Error fetching X intelligence:', error.message);
        return null;
    }
}

/**
 * Gets recent trends, sorted by date (newest first).
 */
async function getTrendsByDate(limit = 100) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('trends')
            .select('*')
            .order('saved_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching trends:', error.message);
        return [];
    }
}

module.exports = { initDB, getTrend, saveTrend, saveXIntelligence, getLatestXIntelligence, getTrendsByDate };
