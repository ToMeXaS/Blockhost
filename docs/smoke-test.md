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
- [ ] Restyle: Overview, Console, Players, Properties, Connect and Settings render for a Vanilla, a Paper and a Fabric server; Mods shows for Fabric, Plugins for Paper, neither for Vanilla
- [ ] Restyle: the sidebar switcher lists every server, switches to another server, and "+ New server" / "All servers" work; going back to a server reopens the section it was on
- [ ] Restyle: switching servers while on Settings or Properties shows the new server's values, and an open delete confirmation or Java-install prompt does not carry over
- [ ] Restyle: the Players badge in the sidebar shows the online count while someone is connected
- [ ] Restyle: Console filters (All / Warnings / Chat) work, ↑/↓ recall earlier commands, and "Jump to latest" appears after scrolling up
- [ ] Restyle: Overview uptime counts up after starting a server; the address copy button copies the playit address when shared and `localhost:<port>` otherwise
- [ ] Restyle: with the network disconnected, the Geist and JetBrains Mono fonts still render (no fallback fonts)
- [ ] Restyle: at the 860px minimum width the layout has no horizontal scroll and the sidebar is an icon rail; at 1000px and wider it shows labels
- [ ] Restyle: below 1000px, a ready update still shows "Restart to update"
- [ ] Restyle: Force kill appears in the "⋯" menu only after the server has been stopping for 30 seconds
- [ ] Performance: on a running Paper server, the Overview tiles show TPS (Healthy), memory as `x.x / <RAM> GB` with a %, and CPU % with the core count; values change every ~5 seconds
- [ ] Performance: the Console shows no `tps` commands or `TPS from last…` replies while stats are polled, and typing `tps` yourself (try several times) still shows the reply
- [ ] Performance: a vanilla 1.21 server shows TPS from `tick query` with a clean console; a vanilla 1.20.1 server shows TPS "Not available"
- [ ] Performance: a Purpur server shows TPS with a clean console (no `TPS from last…` lines every 15 seconds)
- [ ] Performance: the chart draws CPU, memory and dashed TPS lines after ~10 seconds, hovering shows a readout, and stopping the server resets the tiles to "—"/Offline and the chart to "Start the server to see performance"
- [ ] Performance: Task Manager shows one `powershell.exe` child of Blockhost while a server runs and none after all servers stop
- [ ] Uninstall via Windows Settings removes the app (server folders remain)

## Mods & plugins (multi-source)

- [ ] Paper: chips show Modrinth, Hangar, SpigotMC with counts; toggling a chip re-runs the search.
- [ ] Install one plugin from each source; each shows its source badge in Installed.
- [ ] A SpigotMC premium result and any non-jar resource (from any source) open the browser instead of installing.
- [ ] Category "Chat" + text query: SpigotMC chip says "no matching category".
- [ ] Open a project: description, links, versions; "Install this version" installs that version.
- [ ] Fabric: no chip row; install a mod with a dependency (e.g. Sodium → Fabric API) and see "Will also install".
- [ ] Stop the server: disable a mod (file becomes .jar.disabled), re-enable it.
- [ ] Update all with at least one update available; summary toast appears.
- [ ] Remove a mod whose dependency nothing else needs; accept the cleanup prompt; both files gone.
- [ ] Include beta versions on → update check can offer betas.
- [ ] Unplug the network: installed list still shows, with "Couldn't check … for updates".
- [ ] Restart the server: everything installed loads.
