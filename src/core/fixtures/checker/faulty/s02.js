// A second element takes the caption's id, and the number flashes a color of its own.
MB.reveal(tl, "#s02-caption", at("s02-caption"));
MB.reveal(tl, "#s02-round-trip", at("s02-round-trip"), "pop");
tl.to("#s02-round-trip", { color: "rgba(255, 64, 64, 0.9)", duration: 0.3 }, at("s02-round-trip") + 0.6);
