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
- [ ] A second server on the same port shows "Port … is already in use" when started while the first runs
- [ ] Closing the app with a running server shows the stop-and-quit dialog, and no java.exe remains
- [ ] Disconnecting from the network still shows cached version lists with the offline banner
- [ ] Uninstall via Windows Settings removes the app (server folders remain)
