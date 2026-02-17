class SubMaker {
  constructor() {
    this.cues = [];
  }

  /**
   * Feed a WordBoundary message to the SubMaker.
   * @param {Object} msg - The WordBoundary message (offset, duration, text).
   */
  feed(msg) {
    this.cues.push({
      index: this.cues.length + 1,
      start: msg.offset,
      end: msg.offset + msg.duration,
      text: msg.text,
    });
  }

  /**
   * Formats time in ticks (100ns units) to SRT format (HH:MM:SS,mmm).
   * @param {number} ticks
   * @returns {string}
   */
  _formatTimestamp(ticks) {
    const totalMs = Math.floor(ticks / 10000);
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    const pad = (num, size) => String(num).padStart(size, "0");
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
  }

  /**
   * Generates SRT formatted string.
   * @returns {string}
   */
  getSrt() {
    let srt = "";
    for (const cue of this.cues) {
      const start = this._formatTimestamp(cue.start);
      const end = this._formatTimestamp(cue.end);
      srt += `${cue.index}\n${start} --> ${end}\n${cue.text}\n\n`;
    }
    return srt;
  }
}

module.exports = SubMaker;
