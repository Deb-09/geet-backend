import express from 'express';
import cors from 'cors';
// @ts-ignore
import yts from 'yt-search';

const app = express();
app.use(cors());
app.use(express.json());

const searchCache = new Map<string, any>();

// Fast cached search endpoint
app.get('/api/search', async (req, res) => {
    const query = (req.query.q as string || '').trim().toLowerCase();
    if (!query) return res.status(400).json({ error: 'Query required' });

    if (searchCache.has(query)) {
        console.log(`[Cache Hit] Search: ${query}`);
        return res.json(searchCache.get(query));
    }

    try {
        const results = await yts(query);
        const tracks = results.videos.slice(0, 15).map((v: any) => ({
            id: v.videoId,
            title: v.title,
            artist: v.author.name,
            album: 'YouTube Music',
            durationMs: v.seconds * 1000,
            coverUrl: v.thumbnail,
        }));

        searchCache.set(query, tracks);
        res.json(tracks);
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Geet backend running on port ${PORT}`);
});