import express from "express";
import cors from "cors";
import { EdgeTTS } from "@andresaya/edge-tts";
import { Worker } from "worker_threads";
import SubMaker from "./SubMaker.js";

const app = express();
const port = 3000;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const articleCache = new Map();

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin.endsWith(".vercel.app") ||
        origin === "https://listenin.js.org" ||
        origin === "https://listenin.phanendraguptha.com"
      ) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }),
);
// Middleware to parse JSON bodies
app.use(express.json({ limit: "5mb" }));

const getCachedArticle = (url) => {
  const cached = articleCache.get(url);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    articleCache.delete(url);
    return null;
  }

  return cached.article;
};

const setCachedArticle = (url, article) => {
  if (articleCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = articleCache.keys().next().value;
    if (oldestKey) {
      articleCache.delete(oldestKey);
    }
  }

  articleCache.set(url, { article, timestamp: Date.now() });
};

const sendSseEvent = (res, event, payload) => {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
};

// Edge TTS has an undocumented limit on text length per request (~10-20K chars).
// Split text at sentence boundaries into chunks under this limit.
const MAX_TTS_CHUNK_CHARS = 8000;

const splitTextIntoChunks = (text, maxChars = MAX_TTS_CHUNK_CHARS) => {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Try to split at sentence boundary (. ! ?) within maxChars
    let splitIdx = -1;
    const searchRegion = remaining.slice(0, maxChars);

    // Search backwards from maxChars for a sentence-ending punctuation followed by space
    for (let i = searchRegion.length - 1; i >= maxChars * 0.5; i--) {
      if (
        (searchRegion[i] === "." || searchRegion[i] === "!" || searchRegion[i] === "?") &&
        (i + 1 >= searchRegion.length ||
          searchRegion[i + 1] === " " ||
          searchRegion[i + 1] === "\n")
      ) {
        splitIdx = i + 1;
        break;
      }
    }

    // Fallback: split at last space within maxChars
    if (splitIdx === -1) {
      splitIdx = searchRegion.lastIndexOf(" ");
    }

    // Last resort: hard split at maxChars
    if (splitIdx <= 0) {
      splitIdx = maxChars;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter((c) => c.length > 0);
};

const parseArticleInWorker = (url) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./dom-worker.js", import.meta.url), {
      type: "module",
    });

    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
      }
      worker.terminate().catch(() => { });
    };

    worker.on("message", (message) => {
      if (settled) {
        return;
      }

      if (message?.error) {
        settled = true;
        cleanup();
        reject(new Error(message.error));
        return;
      }

      settled = true;
      cleanup();
      resolve(message.article);
    });

    worker.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });

    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        settled = true;
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    worker.postMessage({ url });
  });

app.post("/generate-dom", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const cachedArticle = getCachedArticle(url);
    if (cachedArticle) {
      return res.status(200).json(cachedArticle);
    }

    const article = await parseArticleInWorker(url);
    if (!article) {
      return res.status(422).json({ error: "Unable to parse article" });
    }

    setCachedArticle(url, article);
    return res.status(200).json(article);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred while processing the request" });
    }
  }
});

app.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const textChunks = splitTextIntoChunks(text);
    const audioBuffers = [];
    const allBoundaries = [];
    let cumulativeOffset = 0;

    for (const chunkText of textChunks) {
      const tts = new EdgeTTS();
      await tts.synthesize(chunkText, "en-CA-LiamNeural");
      audioBuffers.push(tts.toBuffer());

      const boundaries = tts.getWordBoundaries();
      for (const b of boundaries) {
        allBoundaries.push({
          ...b,
          offset: b.offset + cumulativeOffset,
        });
      }

      if (boundaries.length > 0) {
        const last = boundaries[boundaries.length - 1];
        cumulativeOffset = last.offset + last.duration + cumulativeOffset;
      }
    }

    const subMaker = new SubMaker();
    allBoundaries.forEach((msg) => subMaker.feed(msg));

    const srtContent = subMaker.getSrt();
    const audioBase64 = Buffer.concat(audioBuffers).toString("base64");

    res.json({
      audio: audioBase64,
      srt: srtContent,
      format: "mp3",
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred while processing the request" });
    }
  }
});

app.post("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let clientClosed = false;
  res.on("close", () => {
    clientClosed = true;
  });

  try {
    const { url } = req.body;
    if (!url) {
      sendSseEvent(res, "error", { error: "URL is required" });
      res.end();
      return;
    }

    const cachedArticle = getCachedArticle(url);
    const article = cachedArticle || (await parseArticleInWorker(url));
    if (!article) {
      sendSseEvent(res, "error", { error: "Unable to parse article" });
      res.end();
      return;
    }

    if (!cachedArticle) {
      setCachedArticle(url, article);
    }

    sendSseEvent(res, "article", {
      url,
      title: article.title,
      byline: article.byline,
      excerpt: article.excerpt,
      lang: article.lang,
      textContent: article.textContent,
      content: article.content,
    });

    const textContent = article.textContent?.trim();
    if (!textContent) {
      sendSseEvent(res, "error", { error: "Article has no readable text" });
      res.end();
      return;
    }

    const textChunks = splitTextIntoChunks(textContent);
    console.log(
      `[stream] Starting TTS: ${textContent.length} chars, ${textChunks.length} chunk(s)`,
    );

    const chunkResults = [];
    let cumulativeOffset = 0;

    // Phase 1: Synthesize all chunks and collect audio/boundaries
    for (let i = 0; i < textChunks.length; i++) {
      if (clientClosed) break;

      const chunkText = textChunks[i];
      console.log(
        `[stream] Synthesizing chunk ${i + 1}/${textChunks.length}: ${chunkText.length} chars`,
      );

      const tts = new EdgeTTS();
      try {
        await tts.synthesize(chunkText, "en-CA-LiamNeural");
        const audioBuffer = tts.toBuffer();
        const boundaries = tts.getWordBoundaries();

        const adjustedBoundaries = boundaries.map((b) => ({
          ...b,
          offset: b.offset + cumulativeOffset,
        }));

        chunkResults.push({
          audioBuffer,
          boundaries: adjustedBoundaries,
        });

        if (boundaries.length > 0) {
          const last = boundaries[boundaries.length - 1];
          cumulativeOffset = last.offset + last.duration + cumulativeOffset;
        }
      } catch (ttsError) {
        console.error(`[stream] TTS error on chunk ${i + 1}:`, ttsError.message);
        sendSseEvent(res, "error", {
          error: `TTS failed on chunk ${i + 1}: ${ttsError.message}`,
        });
        res.end();
        return;
      }
    }

    if (clientClosed) {
      res.end();
      return;
    }

    // Phase 2: Send SRT
    const subMaker = new SubMaker();
    for (const result of chunkResults) {
      result.boundaries.forEach((msg) => subMaker.feed(msg));
    }
    const srtContent = subMaker.getSrt();
    sendSseEvent(res, "srt", { srt: srtContent });

    // Phase 3: Stream Audio
    for (let i = 0; i < chunkResults.length; i++) {
      if (clientClosed) break;

      const { audioBuffer } = chunkResults[i];
      console.log(`[stream] Streaming audio for chunk ${i + 1}/${chunkResults.length}`);

      const SEGMENT_SIZE = 16 * 1024;
      for (let offset = 0; offset < audioBuffer.length; offset += SEGMENT_SIZE) {
        if (clientClosed) break;
        const segment = audioBuffer.subarray(
          offset,
          Math.min(offset + SEGMENT_SIZE, audioBuffer.length),
        );
        sendSseEvent(res, "audio", segment.toString("base64"));
      }
    }

    if (!clientClosed) {
      sendSseEvent(res, "done", {});
    }
    res.end();
  } catch (error) {
    console.error(error);
    if (!clientClosed) {
      sendSseEvent(res, "error", {
        error: "An error occurred while processing the request",
      });
      res.end();
    }
  }
});

// Start the server
app.listen(port, () => console.log(`Server running on http://0.0.0.0:${port}`));
