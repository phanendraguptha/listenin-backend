import { parentPort } from "worker_threads";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const parseArticle = async (url) => {
  const { data } = await axios.get(url);
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
