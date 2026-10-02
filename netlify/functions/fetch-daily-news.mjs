// netlify/functions/fetch-daily-news.mjs

export default async (req) => {
    // 1. CORS Headers to allow admin.html to call this securely
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

        // 2. MULTI-FEED FETCH (National & Economy feeds for comprehensive exam coverage)
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

        if (combinedNews.length === 0) {
            throw new Error("Unable to retrieve news from RSS feeds. Please check network or feed URLs.");
        }

        // Deduplicate headlines and take the top 20 news items
        const uniqueItems = Array.from(new Map(combinedNews.map(item => [item.title, item])).values()).slice(0, 20);
        const rawNewsDump = uniqueItems.map((item, idx) => `[Item ${idx + 1}] Title: ${item.title}\nDescription: ${item.description || ''}`).join('\n\n');

        // 3. STRICT BILINGUAL AI PROMPT 
        const prompt = `
You are a senior Current Affairs curriculum designer and question setter for Indian competitive exams (SSC CGL, CHSL, IBPS PO, SBI, RRB NTPC).
Analyze the following raw news dump for target date (${targetDate}) and extract exactly 5 to 7 high-yield, exam-worthy developments.

Raw News Dump:
${rawNewsDump}

STRICT GENERATION RULES:
1. Filter out crime, partisan political mudslinging, and celebrity gossip. Prioritize high-yield exam topics:
   - Central & State Government Schemes, Portals, and Missions (योजनाएं एवं पोर्टल)
   - State Affairs & Regional Initiatives (e.g., major state policies, GI tags, state summits)
   - Appointments, Resignations & Committees
   - Regulatory Actions, RBI/SEBI circulars, and Banking metrics
   - Defence deals, Joint Military Exercises & Space tech
   - Bilateral MoUs, International Summits & Indices/Reports
   - National/International Awards and Major Sports titles

2. Every card MUST use one of the 6 core parent categories exactly as written:
   - "National & Global" (For: Central/State Govt Schemes, State Initiatives, MoUs, Summits, Indices)
   - "Banking & Economy" (For: Financial Schemes, RBI policies, GDP, Trade metrics)
   - "Science & Defence" (For: ISRO, DRDO, Exercises, Tech)
   - "Persons in News" (For: Appointments, Committees, Obits)
   - "Sports" (For: Tournaments, Medals, Records)
   - "Awards & Honours" (For: Civilian honors, Literary prizes, Global recognitions)

3. SubCategory Examples: "Govt Schemes", "State Initiatives", "Reports & Indices", "Appointments".
4. Produce a valid JSON array of objects. Do not include markdown wrappers, backticks, conversational preamble, or trailing commentary.
5. Every card MUST be fully bilingual with corresponding high-quality Hindi translations.
6. MCQ EXPLANATION REQUIREMENT: The "explanation" inside "mcq" and "mcq_hi" MUST NOT be short one-liners. Provide a rich, 2 to 3 sentence breakdown explaining why the answer is right, citing relevant acts, dates, or background context.

SCHEMA SPECIFICATION:
[
  {
    "date": "${targetDate}",
    "category": "String (Must match Rule 2 exactly)",
    "category_hi": "String (Exact Hindi equivalent)",
    "subCategory": "String",
    "subCategory_hi": "String",
    "emoji": "String (A single contextual emoji, e.g., 🏦, 🚀, ⚖️, 🏅, 🏆)",
    "impact": "String (Exam relevance, e.g., Crucial for IBPS PO Mains)",
    "impact_hi": "String (Hindi relevance)",
    "targetExams": ["SSC CGL", "IBPS PO"],
    "oneLiner": "String (Clear, factual headline)",
    "oneLiner_hi": "String (Hindi headline)",
    "contextBullets": ["String (Fact 1)", "String (Fact 2)"],
    "contextBullets_hi": ["String (Hindi Fact 1)", "String (Hindi Fact 2)"],
    "staticBox": { "facts": "String (Relevant static GK linkage)" },
    "staticBox_hi": { "facts": "String (Hindi static GK linkage)" },
    "mcq": {
      "question": "String (Multiple-choice question)",
      "options": ["String", "String", "String", "String"],
      "correctIndex": 0,
      "explanation": "String (Detailed, multi-sentence factual explanation)"
    },
    "mcq_hi": {
      "question": "String (Hindi question)",
      "options": ["String", "String", "String", "String"],
      "correctIndex": 0,
      "explanation": "String (Detailed Hindi explanation matching English)"
    }
  }
]
`;

        // 4. CALL GROQ AI (Using llama-3.3-70b-versatile for multilingual JSON output)
        const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
        const aiResponse = await fetch(groqUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an automated JSON-only API. Never output markdown, backticks, or prose outside the JSON array." 
                    },
                    { 
                        role: "user", 
                        content: prompt 
                    }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            })
        });

        const aiData = await aiResponse.json();

        if (!aiResponse.ok) {
            throw new Error(aiData.error?.message || "Failed to generate AI news via Groq");
        }

        const rawContent = aiData.choices[0].message.content;

        // 5. BULLETPROOF JSON EXTRACTOR
        // Uses regex to find the first '[' and the last ']' to ignore any accidental AI conversational text
        let cleanJsonString = rawContent;
        const arrayStart = rawContent.indexOf('[');
        const arrayEnd = rawContent.lastIndexOf(']');
        
        if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
            cleanJsonString = rawContent.substring(arrayStart, arrayEnd + 1);
        } else {
            // Fallback for object-wrapped arrays (e.g., {"news": [...]})
            const objStart = rawContent.indexOf('{');
            const objEnd = rawContent.lastIndexOf('}');
            if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
                cleanJsonString = rawContent.substring(objStart, objEnd + 1);
            }
        }

        let parsedOutput = JSON.parse(cleanJsonString);

        // Normalize output in case model returns { "news": [...] } instead of raw array
        let finalArray = Array.isArray(parsedOutput) 
            ? parsedOutput 
            : (parsedOutput.data || parsedOutput.news || parsedOutput.cards || Object.values(parsedOutput)[0]);

        if (!Array.isArray(finalArray)) {
            throw new Error("AI response did not form a valid array of cards.");
        }

        // 6. RETURN CLEAN DATA TO ADMIN REVIEW STAGING
        return new Response(JSON.stringify({ success: true, data: finalArray }), { headers, status: 200 });

    } catch (error) {
        console.error("AI Generation Error:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), { headers, status: 500 });
    }
};