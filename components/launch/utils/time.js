function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `[${h}:${m}:${s}]`;
}

module.exports = {
  formatTimestamp
};
