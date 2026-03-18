const fetch = require('node-fetch');
require('dotenv').config();

const ARCTIC_SHIFT_BASE = 'https://arctic-shift.photon-reddit.com/api';

// Subreddits relevant to BRAG (Bragg Gaming) and iGaming
const SUBREDDITS = [
    'igaming',
    'onlinegambling',
    'CanadianInvestor'
];

// Search terms for finding BRAG-related posts (searched across ALL of Reddit)
const SEARCH_TERMS = [
    'bragg gaming',
    'BRAG stock',
    'igaming regulation',
    'online casino regulation',
    'igaming netherlands',
    'igaming brazil',
    'sports betting regulation'
];

// Filter: post must match at least one of these to be included
const RELEVANCE_FILTER = /bragg|brag\b|igaming|i-gaming|online casino|online gambling|sports ?betting|gaming regulat|gaming license|gaming commission|betting regulat|KSA|kansspelautoriteit|netherlands.*gaming|dutch.*gaming|brazil.*gaming|brazil.*bet|us.*igaming|igaming.*us|gambling regulat|gambling legislat|online.*operator|gaming.*operator|PAM platform|B2B gaming|live casino|slot provider|gaming supplier/i;

/**
 * Fetches posts from Reddit via Arctic Shift API (no auth required).
 * Searches subreddits for BRAG/iGaming related content.
 * @returns {Promise<Array>} Array of post objects
 */
async function fetchRedditTrends() {
    try {
        let allItems = [];
        const now = Math.floor(Date.now() / 1000);
        const afterEpoch = now - (48 * 60 * 60); // 48 hours ago

        console.log('Fetching BRAG/iGaming trends from Arctic Shift API...');

        // 1. Fetch from relevant subreddits
        for (const sub of SUBREDDITS) {
            try {
                if (allItems.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }

                const response = await fetch(`${ARCTIC_SHIFT_BASE}/posts/search?` + new URLSearchParams({
                    subreddit: sub,
                    sort: 'desc',
                    sort_type: 'created_utc',
                    limit: 100,
                    after: afterEpoch
                }), {
                    headers: { 'User-Agent': 'brag-dashboard/1.0' },
                    timeout: 30000
                });

                if (!response.ok) {
                    console.warn(`  r/${sub}: HTTP ${response.status}`);
                    continue;
                }

                const data = await response.json();
                if (data && data.data) {
                    console.log(`  r/${sub}: ${data.data.length} posts found`);
                    allItems = allItems.concat(data.data);
                }
            } catch (err) {
                console.error(`Error fetching r/${sub}:`, err.message);
            }
        }

        // 2. Also search across all of Reddit for BRAG-specific terms
        for (const term of SEARCH_TERMS.slice(0, 3)) { // Limit to top 3 search terms
            try {
                await new Promise(resolve => setTimeout(resolve, 1500));

                const response = await fetch(`${ARCTIC_SHIFT_BASE}/posts/search?` + new URLSearchParams({
                    q: term,
                    sort: 'desc',
                    sort_type: 'created_utc',
                    limit: 50,
                    after: afterEpoch
                }), {
                    headers: { 'User-Agent': 'brag-dashboard/1.0' },
                    timeout: 30000
                });

                if (!response.ok) continue;

                const data = await response.json();
                if (data && data.data) {
                    console.log(`  Search "${term}": ${data.data.length} posts found`);
                    // Deduplicate by post ID
                    const existingIds = new Set(allItems.map(p => p.id));
                    const newPosts = data.data.filter(p => !existingIds.has(p.id));
                    allItems = allItems.concat(newPosts);
                }
            } catch (err) {
                console.error(`Error searching "${term}":`, err.message);
            }
        }

        console.log(`Total posts fetched: ${allItems.length}`);

        // 3. Filter by relevance (must be about BRAG/iGaming) and sort by score
        const candidates = allItems
            .filter(item => {
                const content = item.selftext || item.body || '';
                const title = item.title || '';
                if (!title) return false;
                if (!content || content.trim().length < 20) return false;
                // Must match iGaming/BRAG relevance filter
                const searchText = `${title} ${content.substring(0, 500)}`;
                return RELEVANCE_FILTER.test(searchText);
            })
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 15);

        console.log(`Found ${candidates.length} valid candidates. Fetching comments...`);

        // 4. Fetch comments for each candidate
        const trends = [];
        for (const item of candidates) {
            let topComments = [];
            try {
                await new Promise(resolve => setTimeout(resolve, 1500));

                const commResponse = await fetch(`${ARCTIC_SHIFT_BASE}/comments/search?` + new URLSearchParams({
                    link_id: `t3_${item.id}`,
                    sort: 'desc',
                    sort_type: 'created_utc',
                    limit: 50
                }), {
                    headers: { 'User-Agent': 'brag-dashboard/1.0' },
                    timeout: 30000
                });

                if (commResponse.ok) {
                    const commData = await commResponse.json();
                    if (commData && commData.data) {
                        topComments = commData.data
                            .filter(c => {
                                const body = c.body || '';
                                return body.length > 30 && !/^[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]+$/u.test(body);
                            })
                            .sort((a, b) => (b.score || 0) - (a.score || 0))
                            .slice(0, 3)
                            .map(c => ({
                                body: c.body,
                                score: c.score,
                                author: c.author
                            }));
                    }
                }
                console.log(`  Comments for "${item.title.substring(0, 40)}...": ${topComments.length} found`);
            } catch (err) {
                console.warn(`Could not fetch comments for ${item.id}:`, err.message);
            }

            const permalink = item.permalink || `/r/${item.subreddit}/comments/${item.id}/`;

            trends.push({
                id: item.id,
                source: 'reddit',
                title: item.title,
                url: `https://www.reddit.com${permalink}`,
                author: item.author,
                score: item.score,
                selftext: item.selftext || '',
                subreddit: item.subreddit,
                created_utc: item.created_utc,
                top_comments: topComments
            });
        }

        return trends;
    } catch (error) {
        console.error('Error in fetchRedditTrends:', error.message);
        throw error;
    }
}

module.exports = { fetchRedditTrends };
