# ASHOK GPT v5

A ChatGPT-style chat app with the ASHOK GPT logo and black/gold theme, built for coding, Minecraft mods and server plugins. It is a client-side web app that also builds into an Android APK through GitHub Actions.

## What it does
- **Chat like ChatGPT:** streaming replies, Stop, Regenerate, Edit & resend, Copy, and Copy on every code block.
- **Chat history:** a sidebar with search, rename and delete. Chats are stored on the device.
- **Modes:** General chat, Coding Lab, Minecraft Mod (Fabric / Forge / NeoForge), Minecraft Plugin (Paper / Spigot / Bukkit / Velocity), Web & Android App, and Debug & Logs. Each mode gives the AI different instructions.
- **Attach files:** source files, configs and logs (up to 5 files, 300 KB each). The text is sent with your question.
- **Providers:** OpenRouter (recommended), Google Gemini, OpenAI, or any OpenAI-compatible endpoint. Bring your own API key.
- **Settings:** Minecraft version used in prompts, default mode, answer style, creativity, custom instructions, streaming on or off, Enter to send, export chats, and delete all chats.

## Limits (please read)
- The app does not run code. It cannot compile a mod or plugin, and it does not verify that generated code works. Always build and test in your own environment.
- Chats and the API key are stored in the browser or app storage. There is no login and no cloud sync.
- A key stored in a client app can be read by someone with access to the device. For a public app, call the provider from a private backend instead.
- API use can cost money. Check the provider's prices and limits. Free tiers change and are not guaranteed.
- Image and video generation are not included.
- The app refuses to write malware, credential stealers, or cheats and exploits for servers you do not own. Its instructions say so, but the model may still make mistakes, so review all output.

## Build the Android APK (GitHub Actions)
1. Put every file from this ZIP into the root of the repository. Keep the `assets/` folder and the `.github/workflows/build-apk.yml` file.
2. Commit to the `main` branch. The **Actions** tab starts **Build ASHOK GPT Android APK** automatically, or you can run it with **Run workflow**.
3. When the run finishes, download `ASHOK-GPT-debug-APK` from the **Artifacts** section.
4. Unzip it and install `app-debug.apk` on your phone. Android may ask you to allow installs from that app.

The debug APK is for testing only. A Play Store release needs a signed release build.

## Files
- `index.html`: layout (sidebar, chat, composer, settings, dialogs)
- `app.js`: chat logic, providers, streaming, markdown rendering, storage
- `style.css`: black and gold theme, phone and desktop layouts
- `assets/`: ASHOK GPT logo and app icons (192 px and 512 px)
- `manifest.json`: app name and icons (PWA)
- `capacitor.config.json`: Android app ID and name
- `.github/workflows/build-apk.yml`: builds the debug APK

## Changes in v5
- New ChatGPT-style interface with a sidebar, chat search, streaming, Stop and Regenerate.
- The logo and the new icons replace the earlier ones.
- Coding Lab, Minecraft Studio and Creative Studio became modes inside one chat. Creative Studio and the separate profile and file pages were removed.
- The workflow now copies the `assets/` folder into the APK, so the logo appears inside the app.
- Old chat history from v4 is imported automatically the first time you open v5.
