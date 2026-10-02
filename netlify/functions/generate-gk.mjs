export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    try {
        const body = await req.json();
        const apiKey = process.env.GROQ_API_KEY;
        const url = `https://api.groq.com/openai/v1/chat/completions`;

        const prompt = `You are a Static GK expert for Indian SSC exams. 
Generate a comprehensive cheat sheet and 1 flashcard for the topic: "${body.prompt}".
Return ONLY a valid JSON object with this exact structure:
{
  "notesHtml": "<h3>Core Facts</h3><ul><li>Fact 1</li></ul>",
  "flashcardFront": "Question",
  "flashcardBack": "Answer",
  "flashcardContext": "Brief context"
}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ 
                model: "openai/gpt-oss-20b", 
                messages: [{ role: "user", content: prompt }],
                response_format: { type: "json_object" }
            })
        });

        const data = await response.json();
        return new Response(data.choices[0].message.content, {
            status: 200, headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
};
export const config = { path: "/api/generate-gk" };