const express = require("express");
const { EdgeTTS } = require("@andresaya/edge-tts");
const fs = require("fs");
const path = require("path");

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Initialize EdgeTTS
const tts = new EdgeTTS();

// TTS route
app.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // File path to save the audio
    const baseName = `audio_output_${Date.now()}`;
    const outputPath = path.join(__dirname, baseName);
    const finalPath = outputPath + ".mp3";
    console.log("Audio output path: ", finalPath);

    // Synthesize speech and save it to a file
    await tts.synthesize(text, "en-CA-LiamNeural");
    await tts.toFile(outputPath);

    // Return the audio file to the frontend
    res.sendFile(finalPath, (err) => {
      // Cleanup the file regardless of success or failure
      fs.unlink(finalPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Error deleting file:", unlinkErr);
        } else {
          console.log("Audio file deleted successfully!");
        }
      });

      if (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to send the audio file" });
        }
        console.error("Error sending file:", err);
      } else {
        console.log("Audio file sent successfully!");
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred while processing the request" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
