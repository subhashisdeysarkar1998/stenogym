export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        const apiKey = process.env.GEMINI_API_KEY;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

        // 🌐 The prompt now injects the Country to alter legal & political vocabulary
        const prompt = `Write a shorthand dictation passage. 
Topic: ${body.theme}. 
Country Context: ${body.country}. Use appropriate legal, political, and currency terminology for this country.
Difficulty: ${body.difficulty}. 
The passage MUST be exactly ${body.wordCount} words long. Output ONLY the raw English paragraph.`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Failed to generate dictation");

        return new Response(JSON.stringify({ text: data.candidates[0].content.parts[0].text }), {
            status: 200, headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};

export const config = { path: "/api/generate-dictation" };