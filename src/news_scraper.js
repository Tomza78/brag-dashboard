const fetch = require('node-fetch');

/**
 * News scraper for iGaming industry sources.
 * Uses RSS feeds (XML) where available, HTML scraping as fallback.
 * All sources are public, no authentication required.
 */

const NEWS_SOURCES = [
    {
        key: 'brag_official',
        title: 'BRAG רשמי',
        icon: '🏢',
        color: 'rgba(255,214,0,0.15)',
        url: 'https://bragg.group/feed/',
        type: 'rss',
        filter: null // Take all - it's the company's own feed
    },
    {
        key: 'igaming_market',
        title: 'שוק ה-iGaming',
        icon: '🎰',
        color: 'rgba(0,230,118,0.12)',
        url: 'https://igamingbusiness.com/feed/',
        type: 'rss',
        filter: /igaming|casino|gambling|betting|slot|gaming|bragg|brag/i
    },
    {
        key: 'sbc_news',
        title: 'חדשות SBC',
        icon: '📰',
        color: 'rgba(0,176,255,0.12)',
        url: 'https://sbcnews.co.uk/feed/',
        type: 'rss',
        filter: /igaming|casino|gambling|betting|regulation|license|bragg|brag|online gaming/i
    },
    {
        key: 'yogonet',
        title: 'Yogonet International',
        icon: '🌐',
        color: 'rgba(156,39,176,0.12)',
        url: 'https://www.yogonet.com/international/',
        type: 'html',
        filter: /igaming|casino|gambling|betting|regulation|license|bragg|brag|brazil|netherlands|latam/i
    }
];

/**
 * Fetches news from all configured sources.
 * @param {number} maxPerSource - Max articles per source (default 5)
 * @returns {Promise<Object>} Sections object keyed by source key
 */
async function fetchAllNews(maxPerSource = 5) {
    console.log('Fetching news from industry sources...');
    const sections = {};

    for (const source of NEWS_SOURCES) {
        try {
            console.log(`  Fetching ${source.title} (${source.type})...`);
            let articles = [];

            if (source.type === 'rss') {
                articles = await fetchRSS(source.url, source.filter);
            } else if (source.type === 'html') {
                articles = await fetchYogonet(source.url, source.filter);
            }

            articles = articles.slice(0, maxPerSource);

            if (articles.length > 0) {
                sections[source.key] = {
                    title: source.title,
                    icon: source.icon,
                    color: source.color,
                    articles: articles
                };
                console.log(`    Found ${articles.length} articles`);
            } else {
                console.log(`    No matching articles found`);
            }

            // Rate limit between sources
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`  Error fetching ${source.title}:`, error.message);
        }
    }

    return sections;
}

/**
 * Parses RSS/XML feed and extracts articles.
 * Uses regex-based XML parsing to avoid extra dependencies.
 */
async function fetchRSS(url, filter) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 20000
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const articles = [];

    // Extract <item> blocks from RSS
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
        const item = match[1];

        const title = extractTag(item, 'title');
        const link = extractTag(item, 'link');
        const pubDate = extractTag(item, 'pubDate');
        const description = extractTag(item, 'description');
        const category = extractTag(item, 'category');

        if (!title) continue;

        // Apply filter if provided
        if (filter) {
            const searchText = `${title} ${description || ''} ${category || ''}`;
            if (!filter.test(searchText)) continue;
        }

        // Parse date
        let dateStr = '';
        if (pubDate) {
            try {
                const d = new Date(pubDate);
                dateStr = d.toISOString().split('T')[0];
            } catch (e) {
                dateStr = pubDate;
            }
        }

        // Clean HTML from description
        const cleanDesc = (description || '')
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 300);

        articles.push({
            date: dateStr,
            title: title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(),
            summary_he: cleanDesc, // Will be translated by AI later if needed
            source: new URL(url).hostname.replace('www.', ''),
            url: link || ''
        });
    }

    // Only return articles from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return articles.filter(a => {
        if (!a.date) return true;
        return new Date(a.date) >= sevenDaysAgo;
    });
}

/**
 * Scrapes Yogonet International homepage for news articles.
 */
async function fetchYogonet(url, filter) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 20000
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const articles = [];

    // Find article links with pattern /international/news/YYYY/MM/DD/
    const linkRegex = /<a[^>]*href="(\/international\/news\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const seen = new Set();

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const innerHtml = match[2];

        // Skip duplicates
        if (seen.has(href)) continue;
        seen.add(href);

        // Extract title text (inside <strong> or plain text)
        let title = innerHtml
            .replace(/<img[^>]*>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!title || title.length < 10) continue;

        // Apply filter
        if (filter && !filter.test(title)) continue;

        // Extract date from URL pattern /YYYY/MM/DD/
        const dateMatch = href.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        const dateStr = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';

        articles.push({
            date: dateStr,
            title: title.substring(0, 200),
            summary_he: '', // No summary available from homepage
            source: 'yogonet.com',
            url: `https://www.yogonet.com${href}`
        });
    }

    // Only return articles from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return articles.filter(a => {
        if (!a.date) return true;
        return new Date(a.date) >= sevenDaysAgo;
    });
}

/**
 * Extracts content from an XML tag. Handles CDATA.
 */
function extractTag(xml, tag) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (!match) return '';
    return match[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .trim();
}

module.exports = { fetchAllNews, NEWS_SOURCES };
