MB.connect("#s01-browser-server", "#s01-browser", "#s01-server");
MB.connect("#s01-server-database", "#s01-server", "#s01-database");
MB.reveal(tl, "#s01-browser", at("s01-browser"));
MB.reveal(tl, "#s01-server", at("s01-server"));
MB.draw(tl, "#s01-browser-server", at("s01-browser-server"));
MB.reveal(tl, "#s01-database", at("s01-database"), "blur");
MB.draw(tl, "#s01-server-database", at("s01-server-database"));
