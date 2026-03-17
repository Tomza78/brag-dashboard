const fetch = require('node-fetch');
require('dotenv').config();

/**
 * Uses xAI Grok API to get intelligence about BRAG stock and iGaming from X (Twitter).
 * Grok has native access to X data - one query covers stock sentiment + industry news.
 * Free tier: $25/month credits. One daily query costs ~$0.01.
 *
 * @returns {Promise<Object>} Object with stock sentiment and industry intel
 */
async function getXIntelligence() {
    if (!process.env.XAI_API_KEY) {
        console.warn('XAI_API_KEY not set. Skipping X/Twitter intelligence.');
        return null;
    }

    console.log('Fetching X/Twitter intelligence via Grok API...');

    try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.XAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'grok-3-mini',
                messages: [{
                    role: 'system',
                    content: 'You are a financial intelligence analyst specializing in iGaming stocks. Respond in Hebrew. Be concise and factual.'
                }, {
                    role: 'user',
                    content: `חפש ב-X (טוויטר) מידע עדכני מהיום על הנושאים הבאים. עבור כל נושא, תן סיכום קצר של מה שאנשים אומרים:

1. **מניית BRAG (Bragg Gaming Group)** - סנטימנט, חדשות, תחזיות מחיר
2. **רגולציית iGaming בארה"ב** - במיוחד ניו יורק, חקיקה חדשה, רישיונות
3. **שוק ההימורים בברזיל** - רגולציה, רישיונות חדשים, אכיפה
4. **רגולציה בהולנד (KSA)** - חידוש רישיונות, אכיפה, BetCity
5. **חדשות תעשיית iGaming** - עסקאות, שותפויות, מגמות כלליות

עבור כל נושא תן:
- סיכום של 2-3 משפטים
- סנטימנט כללי (חיובי/שלילי/ניטרלי)
- אם יש חדשות חשובות מהשעות האחרונות, ציין אותן

פורמט התשובה כ-JSON:
{
  "brag_stock": { "summary": "...", "sentiment": "...", "breaking": "..." },
  "us_regulation": { "summary": "...", "sentiment": "...", "breaking": "..." },
  "brazil_market": { "summary": "...", "sentiment": "...", "breaking": "..." },
  "netherlands_ksa": { "summary": "...", "sentiment": "...", "breaking": "..." },
  "igaming_industry": { "summary": "...", "sentiment": "...", "breaking": "..." },
  "overall_sentiment": "...",
  "top_alert": "..."
}`
                }],
                temperature: 0.3
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Grok API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // Try to parse as JSON, fallback to raw text
        let parsed;
        try {
            // Extract JSON from potential markdown code block
            const jsonMatch = content.match(/```json?\s*([\s\S]*?)```/) || [null, content];
            parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
            console.warn('Could not parse Grok response as JSON, using raw text');
            parsed = { raw_response: content };
        }

        console.log('X/Twitter intelligence fetched successfully.');
        return {
            source: 'x_grok',
            fetched_at: new Date().toISOString(),
            data: parsed
        };
    } catch (error) {
        console.error('Error fetching X intelligence:', error.message);
        return null;
    }
}

module.exports = { getXIntelligence };
