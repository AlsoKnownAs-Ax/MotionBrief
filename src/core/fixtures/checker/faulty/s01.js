// The browser arrives a second after its word, in a font of its own; the server is never hidden;
// the first connector is drawn by hand.
MB.connect("#s01-server-database", "#s01-server", "#s01-db");
tl.set("#s01-browser", { fontFamily: "Comic Sans MS" }, 0);
MB.reveal(tl, "#s01-browser", at("s01-browser") + 1);
MB.draw(tl, "#s01-browser-server", at("s01-browser-server"));
MB.reveal(tl, "#s01-db", at("s01-database"));
MB.draw(tl, "#s01-server-database", at("s01-server-database"));
