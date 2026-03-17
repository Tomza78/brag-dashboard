const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

/**
 * Categorizes a post for BRAG/iGaming relevance.
 * Returns Hebrew category name or null if not relevant.
 */
async function categorizePost(title) {
    const prompt = `
    Analyze this post title and determine if it belongs to one of these categories relevant to Bragg Gaming (BRAG) stock and iGaming industry:
    1. מניית BRAG (direct mentions of Bragg Gaming, BRAG stock)
    2. רגולציית iGaming (iGaming regulation, licensing, legislation)
    3. שוק ההימורים (gambling market, betting, online casino)
    4. טכנולוגיית גיימינג (gaming technology, PAM platforms, content aggregation)
    5. שווקים פיננסיים (financial markets, stock analysis, penny stocks)
    6. שותפויות ועסקאות (partnerships, M&A, deals in iGaming)

    If it belongs to one of these, return ONLY the Hebrew Category Name.
    If it is NOT related to iGaming/gambling/BRAG/finance, return "SKIP".

    Title: ${title}

    Response (Category Name or SKIP):
    `;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text.includes('SKIP') || text.includes('לא רלוונטי')) return null;
        return text;
    } catch (error) {
        console.error(`Categorize Error (${error.message})`);
        return 'כללי';
    }
}

/**
 * Summarizes a Reddit post in Hebrew (2-3 sentences).
 */
async function summarizePost(title, content) {
    const prompt = `
    Analyze the following post about iGaming/gambling/finance and provide a concise summary in Hebrew (2-3 sentences).
    Focus on relevance to Bragg Gaming (BRAG), iGaming regulation, or gambling industry trends.

    Title: ${title}
    Content: ${content || 'No content provided (Link/Image post)'}

    Summary in Hebrew:
    `;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error(`Summarize Error (${error.message})`);
        return 'תקציר לא זמין (שגיאת AI)';
    }
}

/**
 * Summarizes top comments - extracts 6 distinct opinions in Hebrew.
 */
async function summarizeComments(comments) {
    if (!comments || comments.length === 0) return 'אין תגובות משמעותיות.';

    const bestComments = comments.slice(0, 10);
    const commentsText = bestComments.map((c, i) => `Comment ${i + 1}: ${c.body}`).join('\n');

    const prompt = `
    Analyze the following top comments from a Reddit thread about iGaming/gambling/finance.
    Provide a comprehensive summary in Hebrew that captures up to 6 distinct opinions or points.
    Use bullet points in Hebrew.

    Comments:
    ${commentsText}

    Discussion Summary in Hebrew (with bullet points):
    `;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error(`Summarize Comments Error (${error.message})`);
        return 'סיכום תגובות לא זמין כרגע.';
    }
}

module.exports = { categorizePost, summarizePost, summarizeComments };
