MB.reveal(tl, "#s02-caption", at("s02-caption"));
MB.reveal(tl, "#s02-round-trip", at("s02-round-trip"), "pop");
MB.countUp(tl, "#s02-round-trip", 200, at("s02-round-trip"), { suffix: " ms", duration: 1 });
MB.reveal(tl, "#s02-header", at("s02-round-trip") + 0.9, "wipe");
MB.reveal(tl, "#s02-hit", at("s02-round-trip") + 1.2);
MB.emphasize(tl, "#s02-hit", at("s02-round-trip") + 1.8);
