// netlify/functions/fetch-daily-news.mjs

export default async (req) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    };

    if (req.method === "OPTIONS") return new Response("", { headers, status: 200 });
    if (req.method !== "POST") return new Response("Method Not Allowed", { headers, status: 405 });

    try {
        const body = await req.json();
        const targetDate = body.date || new Date().toISOString().split('T')[0];
        const apiKey = process.env.GROQ_API_KEY;

        if (!apiKey) throw new Error("Missing GROQ_API_KEY environment variable in Netlify.");

        const feeds = [
            'https://www.thehindu.com/news/national/feeder/default.rss',
            'https://www.thehindu.com/business/feeder/default.rss'
        ];

        let combinedNews = [];

        await Promise.allSettled(feeds.map(async (url) => {
            try {
                const encodedUrl = encodeURIComponent(url);
                const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodedUrl}`);
                const data = await res.json();
                if (data.status === 'ok' && Array.isArray(data.items)) {
                    combinedNews.push(...data.items);
                }
            } catch (err) {
                console.warn(`Failed fetching feed from ${url}:`, err);
            }
        }));

        if (combinedNews.length === 0) throw new Error("Unable to retrieve news from RSS feeds.");

        // Grab top 15 unique headlines to keep context small
        const uniqueItems = Array.from(new Map(combinedNews.map(item => [item.title, item])).values()).slice(0, 15);
        const rawNewsDump = uniqueItems.map((item, idx) => `[Item ${idx + 1}] Title: ${item.title}\nDescription: ${item.description || ''}`).join('\n\n');

        const prompt = `
You are a senior Current Affairs curriculum designer for Indian competitive exams (SSC, IBPS PO, RRB).
Analyze the raw news dump for target date (${targetDate}) and extract exactly 3 to 4 high-yield, exam-worthy developments.

Raw News Dump:
${rawNewsDump}

STRICT GENERATION RULES:
1. Filter out crime, partisan politics, and celebrity gossip.
2. Every card MUST use one of these 6 categories: "National & Global", "Banking & Economy", "Science & Defence", "Persons in News", "Sports", "Awards & Honours".
3. Write ONLY in English. Do NOT translate to Hindi.
4. "contextBullets" MUST contain exactly 4 bullets:
   - Bullet 1 (The Core Event): Who did what, and when?
   - Bullet 2 (The Background): Why is this happening?
   - Bullet 3 (Key Figures/Data): Exact numbers, names, or locations to memorize.
   - Bullet 4 (The Big Picture): National or global impact.
5. Produce a valid JSON object containing a "news" array.

SCHEMA SPECIFICATION:
{
  "news": [
    {
      "date": "${targetDate}",
      "category": "String (Must match Rule 2 exactly)",
      "subCategory": "String",
      "emoji": "String (A single contextual emoji, e.g., 🏦, 🚀)",
      "impact": "String (Exam relevance)",
      "targetExams": ["SSC CGL", "IBPS PO"],
      "oneLiner": "String (Clear, factual headline)",
      "contextBullets": [
        "String (Bullet 1: Core Event)",
        "String (Bullet 2: Background/Why)",
        "String (Bullet 3: Key Data/Figures)",
        "String (Bullet 4: Big Picture/Impact)"
      ],
      "staticBox": { "facts": "String (1 relevant static GK fact)" },
      "mcq": {
        "question": "String (Multiple-choice question)",
        "options": ["String", "String", "String", "String"],
        "correctIndex": 0,
        "explanation": "String (1 short sentence explanation)"
      }
    }
  ]
}
`;

        const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
        const aiResponse = await fetch(groqUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an automated JSON-only API. Return a valid JSON object. Never output markdown or prose." 
                    },
                    { 
                        role: "user", 
                        content: prompt 
                    }
                ],
                temperature: 0.1,
                max_tokens: 3000,
                response_format: { type: "json_object" }
            })
        });

        const aiData = await aiResponse.json();

        if (!aiResponse.ok) {
            throw new Error(aiData.error?.message || "Failed to generate AI news via Groq");
        }

        const rawContent = aiData.choices[0].message.content;
        let cleanJsonString = rawContent;
        const objStart = rawContent.indexOf('{');
        const objEnd = rawContent.lastIndexOf('}');
        
        if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
            cleanJsonString = rawContent.substring(objStart, objEnd + 1);
        }

        let parsedOutput = JSON.parse(cleanJsonString);

        let finalArray = Array.isArray(parsedOutput) 
            ? parsedOutput 
            : (parsedOutput.data || parsedOutput.news || parsedOutput.cards || Object.values(parsedOutput)[0]);

        if (!Array.isArray(finalArray)) {
            throw new Error("AI response did not form a valid array of cards.");
        }

        return new Response(JSON.stringify({ success: true, data: finalArray }), { headers, status: 200 });

    } catch (error) {
        console.error("AI Generation Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { headers, status: 500 });
    }
};