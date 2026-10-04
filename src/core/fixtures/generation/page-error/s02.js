MB.reveal(tl, "#s02-server", at("s02-server"), "left");
MB.reveal(tl, "#s02-title", at("s02-title"), "rise");
MB.reveal(tl, "#s02-cache", at("s02-cache"), "left");
MB.reveal(tl, "#s02-fast", at("s02-fast"), "left");
// Throws after the page loads, so the error names no composition.
setTimeout(() => {
  throw new Error("The chart's data never arrived");
}, 0);
