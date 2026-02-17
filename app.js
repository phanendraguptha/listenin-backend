const express = require("express");
const { EdgeTTS } = require("@andresaya/edge-tts");
const fs = require("fs");
const path = require("path");
const SubMaker = require("./SubMaker");

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

app.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;
    const tts = new EdgeTTS();

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // File path to save the audio
    const baseName = `audio_output_${Date.now()}`;
    const outputPath = path.join(__dirname, baseName);
    const finalPath = outputPath + ".mp3";
    const srtPath = outputPath + ".srt";

    // Synthesize speech
    await tts.synthesize(text, "en-CA-LiamNeural");
    await tts.toFile(outputPath);

    // Generate SRT using SubMaker
    const subMaker = new SubMaker();
    const boundaries = tts.getWordBoundaries();
    boundaries.forEach((msg) => subMaker.feed(msg));

    const srtContent = subMaker.getSrt();
    await fs.promises.writeFile(srtPath, srtContent);

    // Read the audio file to send as base64
    const audioBuffer = await fs.promises.readFile(finalPath);

    // Return both audio and SRT to the frontend
    res.json({
      audio: audioBuffer.toString("base64"),
      srt: srtContent,
      format: "mp3",
    });

    // Clean up files after sending response
    [finalPath, srtPath].forEach((file) => {
      fs.unlink(file, (err) => {
        if (err) console.error(`Error deleting ${file}:`, err);
        else console.log(`Deleted ${file}`);
      });
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred while processing the request" });
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
