// netlify/functions/upload-image.mjs
export default async (req) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        const apiKey = process.env.IMGBB_API_KEY;

        if (!apiKey) throw new Error("IMGBB_API_KEY is missing from Netlify environment variables.");

        // ImgBB accepts base64 image data via URLSearchParams
        const params = new URLSearchParams();
        params.append('image', body.image);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: params
        });

        const data = await response.json();
        
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        console.error("Upload Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
};

export const config = { path: "/api/upload-image" };