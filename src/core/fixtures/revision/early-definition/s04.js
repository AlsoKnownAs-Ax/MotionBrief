MB.reveal(tl, "#s04-term", at("s04-term"), "rise");
// Reveals by 1.5 s at the latest, whatever its anchor says: anchoring it later breaks the contract.
MB.reveal(tl, "#s04-definition", Math.min(at("s04-definition"), 1.5), "fade");
