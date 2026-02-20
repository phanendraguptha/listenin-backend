import { parentPort } from "worker_threads";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const parseArticle = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  const dom = new JSDOM(data);
  const document = dom.window.document;
  const reader = new Readability(document);
  const article = reader.parse();
  dom.window.close();
  return article;
};

if (parentPort) {
  parentPort.on("message", async (message) => {
    try {
      const { url } = message || {};
      if (!url) {
        parentPort.postMessage({ error: "URL is required" });
        return;
      }

      const article = await parseArticle(url);
      parentPort.postMessage({ article });
    } catch (error) {
      parentPort.postMessage({ error: error?.message || "Failed to parse article" });
    }
  });
}
