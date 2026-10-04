MB.reveal(tl, "#s06-without", at("s06-without"), "left");
MB.reveal(tl, "#s06-waits", at("s06-waits"), "fade");
MB.reveal(tl, "#s06-with", at("s06-with"), "right");
MB.reveal(tl, "#s06-caching", at("s06-caching"), "pop");
MB.reveal(tl, "#s06-memory", at("s06-memory"), "fade");
// The verdict then slides under the Cache side: its place at the end of the Scene isn't its layout box.
tl.to("#s06-caching", { x: 360, y: -40, duration: 0.6, ease: "power2.inOut" }, at("s06-caching") + 0.8);
