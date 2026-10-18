# Manual smoke test (packaged build)

Run on a clean Windows 10/11 machine (no Java installed) using `dist/Blockhost-<version>-setup.exe`.

- [ ] Installer runs per-user, creates a desktop shortcut, and the app opens
- [ ] For each type (Vanilla, Paper, Purpur, Fabric, Forge, NeoForge), on its newest stable version:
  - [ ] the wizard creates the server and the install completes
  - [ ] Start reaches Running; `list` returns a reply in the console
  - [ ] the client joins via `localhost:<port>`
  - [ ] Stop reaches Stopped with exit code 0
- [ ] One legacy version (Paper 1.16.5) installs Java 8 and starts
- [ ] Changing `max-players` in Properties is applied after a restart
- [ ] Players tab, server stopped: adding an operator writes `ops.json`; toggling the whitelist updates `white-list` in Properties
- [ ] Players tab, server running: joining shows the player under "Online now"; Op, Kick (with reason) and Ban work and the lists refresh on their own
- [ ] Players tab on a Forge or NeoForge server: "Online now" fills after a player joins
- [ ] Players tab, server stopped: an invalid name such as "ab" shows the inline hint and sends nothing; Pardon removes a ban
- [ ] Players tab while Starting or Stopping: buttons are disabled and the paused note shows
- [ ] A second server on the same port shows "Port … is already in use" when started while the first runs
- [ ] Closing the app with a running server shows the stop-and-quit dialog, and no java.exe remains
- [ ] Disconnecting from the network still shows cached version lists with the offline banner
- [ ] Connect tab: "Link playit.gg account" opens playit.gg in the browser; accepting there shows the sharing switch in Blockhost
- [ ] Sharing a running Paper server downloads the agent once, shows "Connecting…" then an address; a client on a different network (e.g. phone hotspot) joins with that address
- [ ] Stopping the server greys the address; starting it again shows the same address
- [ ] A server that is not shared is not reachable from outside, even when it uses the same port as a stopped shared server
- [ ] Unlink removes the switch; no playitd.exe remains in Task Manager after the app quits
- [ ] Paper server: the Plugins tab finds and installs a plugin (e.g. LuckPerms); after a restart the console shows it loading
- [ ] Fabric server: installing Chunky (a server-side mod that requires Fabric API) also installs Fabric API; the note names both; after a restart the server starts with both
- [ ] A jar copied into mods/ by hand shows as "from Modrinth" once identified, or "added manually"
- [ ] Remove is disabled while the server runs; after stopping, removing Fabric API warns that Chunky needs it
- [ ] Uninstall via Windows Settings removes the app (server folders remain)
