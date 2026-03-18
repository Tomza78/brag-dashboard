const fetch = require('node-fetch');

/**
 * News scraper for iGaming industry sources.
 * Focused on iGaming (online casino, sports betting platforms, B2B tech) — NOT general gambling.
 * Uses RSS feeds (XML) where available, HTML scraping as fallback.
 */

// iGaming-focused filter: online platforms, regulation, B2B tech — excludes lottery, horse racing, land-based casinos
const IGAMING_FILTER = /igaming|i-gaming|online casino|online gambling|sports ?betting|bragg|brag gaming|PAM platform|content aggregat|B2B gaming|slot provider|live casino|live dealer|mobile gaming|gaming platform|gaming supplier|gaming operator|gaming license|gaming regulat|gaming commission|gaming authority|compliance|responsible gaming|responsible gambling|KSA|kansspelautoriteit|dutch regul|netherlands.*gaming|holland.*gaming|brazil.*gaming|brazil.*bet|brasil.*gaming|new york.*gaming|US.*igaming|legali[sz]|fine.*million|penalty|illegal.*operat|enforcement|regulator.*impos|gambling act|betting.*regulat|casino.*regulat|GGR|revenue.*gaming|market.*entry|acquisition|merger.*gaming|partnership.*gaming|deal.*gaming|launch.*gaming|expand.*gaming|operator|supplier|provider|software.*gaming|RNG|random number|jackpot|turnover|wagering/i;

// Regional filters for category assignment
const REGION_FILTERS = {
    netherlands: /dutch|netherlands|holland|KSA|kansspelautoriteit|NLO|betcity|ksa\.nl|novatech|nl\b.*regulat/i,
    brazil: /brazil|brasil|brazilian|latam|latin america|loterj|apostas/i,
    us_regulation: /united states|(?:^|\b)US\s+(?:regulat|gaming|igaming)|new york|new jersey|michigan|pennsylvania|illinois|ohio|connecticut|virginia|nevada|nebraska|american gaming|AGA|tribal gaming|congress.*gambl|DraftKings|FanDuel|BetMGM|CFTC/i
};

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
        filter: IGAMING_FILTER
    },
    {
        key: 'sbc_news',
        title: 'חדשות SBC',
        icon: '📰',
        color: 'rgba(0,176,255,0.12)',
        url: 'https://sbcnews.co.uk/feed/',
        type: 'rss',
        filter: IGAMING_FILTER
    },
    {
        key: 'gambling_news',
        title: 'Gambling News',
        icon: '📱',
        color: 'rgba(233,30,99,0.12)',
        url: 'https://www.gamblingnews.com/feed/',
        type: 'rss',
        filter: IGAMING_FILTER
    },
    {
        key: 'yogonet',
        title: 'Yogonet International',
        icon: '🌐',
        color: 'rgba(156,39,176,0.12)',
        url: 'https://www.yogonet.com/international/',
        type: 'html_yogonet',
        filter: null  // Take all from Yogonet - it's already an iGaming site
    }
];

/**
 * Fetches news from all configured sources, then reorganizes by region/topic.
 * @param {number} maxPerSource - Max articles per source before reorganization (default 10)
 * @returns {Promise<Object>} Sections object keyed by topic
 */
async function fetchAllNews(maxPerSource = 10) {
    console.log('Fetching news from industry sources...');
    const allArticles = [];

    for (const source of NEWS_SOURCES) {
        try {
            console.log(`  Fetching ${source.title} (${source.type})...`);
            let articles = [];

            if (source.type === 'rss') {
                articles = await fetchRSS(source.url, source.filter);
            } else if (source.type === 'html_yogonet') {
                articles = await fetchYogonet(source.url, source.filter);
            } else if (source.type === 'html_igaming_today') {
                articles = await fetchIGamingToday(source.url, source.filter);
            }

            articles = articles.slice(0, maxPerSource);
            // Tag each article with its source key
            articles.forEach(a => { a.sourceKey = source.key; });
            allArticles.push(...articles);
            console.log(`    Found ${articles.length} articles`);

            // Rate limit between sources
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`  Error fetching ${source.title}:`, error.message);
        }
    }

    // Reorganize articles into topic-based sections
    const sections = {};

    // 1. BRAG Official — always first
    const bragArticles = allArticles.filter(a => a.sourceKey === 'brag_official');
    if (bragArticles.length > 0) {
        sections.brag_official = {
            title: 'BRAG רשמי',
            icon: '🏢',
            color: 'rgba(255,214,0,0.15)',
            articles: bragArticles.slice(0, 5)
        };
    }

    // 2. Netherlands/KSA regulation
    const nlArticles = allArticles.filter(a =>
        a.sourceKey !== 'brag_official' && REGION_FILTERS.netherlands.test(`${a.title} ${a.summary_he}`)
    );
    if (nlArticles.length > 0) {
        sections.netherlands = {
            title: 'רגולציה - הולנד',
            icon: '🇳🇱',
            color: 'rgba(255,152,0,0.12)',
            articles: nlArticles.slice(0, 5)
        };
    }

    // 3. Brazil market
    const brArticles = allArticles.filter(a =>
        a.sourceKey !== 'brag_official' && REGION_FILTERS.brazil.test(`${a.title} ${a.summary_he}`)
    );
    if (brArticles.length > 0) {
        sections.brazil = {
            title: 'שוק ברזיל',
            icon: '🇧🇷',
            color: 'rgba(76,175,80,0.12)',
            articles: brArticles.slice(0, 5)
        };
    }

    // 4. US regulation
    const usArticles = allArticles.filter(a =>
        a.sourceKey !== 'brag_official' && REGION_FILTERS.us_regulation.test(`${a.title} ${a.summary_he}`)
    );
    if (usArticles.length > 0) {
        sections.us_regulation = {
            title: 'רגולציה - ארה"ב',
            icon: '🇺🇸',
            color: 'rgba(33,150,243,0.12)',
            articles: usArticles.slice(0, 5)
        };
    }

    // 5. General iGaming market (everything else not already categorized)
    const categorized = new Set([
        ...bragArticles, ...nlArticles, ...brArticles, ...usArticles
    ]);
    const generalArticles = allArticles.filter(a => !categorized.has(a));
    if (generalArticles.length > 0) {
        sections.igaming_market = {
            title: 'שוק ה-iGaming',
            icon: '🎰',
            color: 'rgba(0,230,118,0.12)',
            articles: generalArticles.slice(0, 8)
        };
    }

    console.log(`  Total: ${allArticles.length} articles in ${Object.keys(sections).length} sections`);
    return sections;
}

/**
 * Translates article summaries to Hebrew using Gemini AI.
 * Call this after fetchAllNews to add Hebrew summaries.
 */
async function translateArticlesToHebrew(sections, aiModel) {
    if (!aiModel) return sections;

    console.log('  Translating article summaries to Hebrew...');

    for (const [key, section] of Object.entries(sections)) {
        for (const article of section.articles) {
            // Skip if already has Hebrew summary
            if (article.summary_he && /[\u0590-\u05FF]/.test(article.summary_he)) continue;

            const textToTranslate = article.summary_he || article.title;
            if (!textToTranslate) continue;

            try {
                const prompt = `Translate this iGaming industry news to a concise Hebrew summary (1-2 sentences). Focus on the business/regulatory impact. If it's about Bragg Gaming, mention the relevance.

Title: ${article.title}
Description: ${textToTranslate}

Hebrew summary:`;

                const result = await aiModel.generateContent(prompt);
                article.summary_he = result.response.text().trim();
            } catch (error) {
                // Keep English description as fallback
                console.warn(`    Translation failed for: ${article.title.substring(0, 50)}...`);
            }
        }
    }

    return sections;
}

/**
 * Parses RSS/XML feed and extracts articles.
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

        let dateStr = '';
        if (pubDate) {
            try {
                const d = new Date(pubDate);
                dateStr = d.toISOString().split('T')[0];
            } catch (e) {
                dateStr = pubDate;
            }
        }

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
            summary_he: cleanDesc, // English for now, translated to Hebrew by AI later
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
 * Articles use full URLs: https://www.yogonet.com/international/news/YYYY/MM/DD/ID-slug
 */
async function fetchYogonet(url, filter) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 20000
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const articles = [];

    // Yogonet uses full absolute URLs in href
    const linkRegex = /<a[^>]*href="(https?:\/\/www\.yogonet\.com\/international\/news\/\d{4}\/\d{2}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const seen = new Set();

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const innerHtml = match[2];

        // Skip category/region links
        if (href.endsWith('/news/') || href.includes('/regions/') || href.includes('/columns/')) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        let title = innerHtml
            .replace(/<img[^>]*>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&#34;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();

        if (!title || title.length < 15) continue;

        if (filter && !filter.test(title)) continue;

        const dateMatch = href.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        const dateStr = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';

        articles.push({
            date: dateStr,
            title: title.substring(0, 200),
            summary_he: '',
            source: 'yogonet.com',
            url: href
        });
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return articles.filter(a => {
        if (!a.date) return true;
        return new Date(a.date) >= sevenDaysAgo;
    });
}

/**
 * Scrapes iGaming Today news page (HTML) since RSS returns 403.
 */
async function fetchIGamingToday(url, filter) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.google.com/'
        },
        timeout: 20000
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const articles = [];
    const seen = new Set();

    // Match article links - iGaming Today uses various URL patterns
    const linkRegex = /<a[^>]*href="(https?:\/\/www\.igamingtoday\.com\/[^"]*\/)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        const innerHtml = match[2];

        // Skip non-article links (category pages, author pages, etc.)
        if (href.includes('/category/') || href.includes('/author/') || href.includes('/tag/') || href.includes('/page/')) continue;
        if (seen.has(href)) continue;
        seen.add(href);

        let title = innerHtml
            .replace(/<img[^>]*>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!title || title.length < 15) continue;

        if (filter && !filter.test(title)) continue;

        articles.push({
            date: new Date().toISOString().split('T')[0], // Current date (no date in HTML usually)
            title: title.substring(0, 200),
            summary_he: '',
            source: 'igamingtoday.com',
            url: href
        });
    }

    return articles.slice(0, 15);
}

function extractTag(xml, tag) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (!match) return '';
    return match[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .trim();
}

module.exports = { fetchAllNews, translateArticlesToHebrew, NEWS_SOURCES };
