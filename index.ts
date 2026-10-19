import express from 'express';
import cors from 'cors';
import path from 'path';
import { execFile } from 'child_process';
// @ts-ignore
import yts from 'yt-search';

const app = express();
app.use(cors());
app.use(express.json());

// In-Memory Caches
const searchCache = new Map<string, any>();
const streamCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 3; // 3 hours

// Cross-platform yt-dlp path (Windows .exe locally, Linux binary on Render)
const ytDlpPath = process.platform === 'win32'
    ? path.join(__dirname, 'yt-dlp.exe')
    : path.join(__dirname, 'yt-dlp');

// 1. YouTube Search API (Fast & Cached)
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

// 2. Audio Stream API (Resolves directly to playable CDN audio)
app.get('/api/stream/:videoId', async (req, res) => {
    const { videoId } = req.params;

    // Check cache first
    const cached = streamCache.get(videoId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`[Cache Hit] Stream: ${videoId}`);
        return res.redirect(cached.url);
    }

    // Method A: Invidious API (Bypasses datacenter bot blocks)
    const instances = [
        'https://invidious.nerdvpn.de',
        'https://inv.nadeko.net',
        'https://invidious.jing.rocks'
    ];

    for (const instance of instances) {
        try {
            const apiRes = await fetch(`${instance}/api/v1/videos/${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(3500)
            });

            if (!apiRes.ok) continue;

            const data: any = await apiRes.json();
            const audioStreams = data.adaptiveFormats?.filter((f: any) =>
                f.type?.startsWith('audio/')
            ) || [];

            // Sort by highest bitrate
            audioStreams.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

            if (audioStreams.length > 0 && audioStreams[0].url) {
                const streamUrl = audioStreams[0].url;
                streamCache.set(videoId, { url: streamUrl, timestamp: Date.now() });
                console.log(`[Resolved via Invidious] ${videoId}`);
                return res.redirect(streamUrl);
            }
        } catch (e: any) {
            // Continue to next instance
        }
    }

    // Method B: Local / Container yt-dlp fallback
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
        youtubeUrl,
        '-g',
        '-f', 'ba/b',
        '--no-playlist',
        '--no-check-certificates',
        '--no-warnings'
    ];

    execFile(ytDlpPath, args, (error, stdout) => {
        if (!error && stdout) {
            const directUrl = stdout.trim().split('\n')[0];
            if (directUrl && directUrl.startsWith('http')) {
                streamCache.set(videoId, { url: directUrl, timestamp: Date.now() });
                console.log(`[Resolved via yt-dlp] ${videoId}`);
                return res.redirect(directUrl);
            }
        }

        console.error(`All streaming methods failed for ${videoId}`);
        res.status(500).json({ error: 'Audio stream unavailable' });
    });
});

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Geet backend running on port ${PORT}`);
});