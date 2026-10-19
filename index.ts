import express from 'express';
import cors from 'cors';
import path from 'path';
import { execFile } from 'child_process';
// @ts-ignore
import yts from 'yt-search';

const app = express();
app.use(cors());
app.use(express.json());

const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');

// In-Memory Caches for near-zero latency on repeated requests
const searchCache = new Map<string, any>();
const streamCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 3; // 3 hours (YouTube CDN links remain valid ~6 hours)

// 1. YouTube Search with Cache
app.get('/api/search', async (req, res) => {
    const query = (req.query.q as string || '').trim().toLowerCase();
    if (!query) return res.status(400).json({ error: 'Query required' });

    // Return cached search results if available
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

// 2. Direct Audio Stream with URL Cache
app.get('/api/stream/:videoId', (req, res) => {
    const { videoId } = req.params;

    // Return cached direct audio link if valid
    const cached = streamCache.get(videoId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`[Cache Hit] Stream: ${videoId}`);
        return res.redirect(cached.url);
    }

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
        youtubeUrl,
        '-g',
        '-f', 'ba/b',
        '--no-playlist',
        '--no-check-certificates',
        '--no-warnings'
    ];

    execFile(ytDlpPath, args, (error, stdout, stderr) => {
        if (error) {
            console.error(`yt-dlp error for ${videoId}:`, stderr || error.message);
            return res.status(500).json({ error: 'Stream extraction failed' });
        }

        const directUrl = stdout.trim().split('\n')[0];
        if (directUrl && directUrl.startsWith('http')) {
            streamCache.set(videoId, { url: directUrl, timestamp: Date.now() });
            console.log(`[Resolved & Cached] Stream for: ${videoId}`);
            return res.redirect(directUrl);
        }

        res.status(404).json({ error: 'No audio link resolved' });
    });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Geet backend running on http://0.0.0.0:${PORT}`);
});