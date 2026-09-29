# Security and privacy

This project is designed for a trusted local Windows environment. Do not expose the local Gateway to a LAN or the public internet.

Never commit `config.json`, `.env` files, `gateway/runtime-state`, `gateway/host-state`, browser profiles, cookies, SSO artifacts, network captures, or exported conversations. If credentials or session data are committed accidentally, revoke them first and then remove them from Git history before sharing the repository.

The browser login is intentionally owned by Chrome. The bridge should receive only rendered page content and explicit user-selected local attachments.

