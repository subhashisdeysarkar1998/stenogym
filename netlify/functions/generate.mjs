export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        // Pointing to your new Netlify Environment Variable
        const apiKey = process.env.GROQ_API_KEY; 
        
        // Groq uses a different URL structure than Gemini
        const url = `https://api.groq.com/openai/v1/chat/completions`;

        const prompt = `Write a shorthand dictation passage. 
Topic: ${body.theme}. 
Country Context: ${body.country}. Use appropriate legal, political, and currency terminology for this country.
Difficulty: ${body.difficulty}. 
The passage MUST be exactly ${body.wordCount} words long. Output ONLY the raw English paragraph.`;

        const response = await fetch(url, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                // Groq requires the Bearer token authorization format
                "Authorization": `Bearer ${apiKey}` 
            },
            body: JSON.stringify({ 
                // Using the 8B model for 14,400 free daily requests
                model: "openai/gpt-oss-20b", 
                messages: [{ role: "user", content: prompt }]
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Failed to generate dictation");

        // Groq returns the text in a slightly different JSON structure than Gemini
        return new Response(JSON.stringify({ text: data.choices[0].message.content }), {
            status: 200, headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

export const config = { path: "/api/generate-dictation" };