# MeetLocal

MeetLocal is a portable meeting app for Windows, Mac, and Linux. One person hosts the call on their computer. Everyone else joins with a link. Voice, camera, and screen sharing go directly between the people in the meeting.

## What you can do

- Create a meeting with an optional password, or generate a complex password.
- Share a **VPN or local address** for this computer, or a **temporary link** that stops working when the meeting ends.
- Join from the MeetLocal app or from a browser on the same VPN or network.
- Talk with the microphone, turn the camera on and off, and share an entire screen or one window.
- Use gallery or speaker view, pin someone, raise a hand, send reactions, and chat.
- Admit people from a waiting room, lock the meeting, mute or remove a guest, and end the call for everyone.
- Record the meeting to a WebM file on this computer.
- Switch microphone, camera, and speaker, and lower video quality if the connection is tight.

People have to be able to reach the address you share. A VPN link works for people on that VPN. A local-network link works for people on the same LAN. MeetLocal does not relay the call through a cloud service. If direct connection needs help, the app can use a public STUN server to discover addresses. Media still travels peer to peer.

The first time someone opens a link in a browser, the browser asks them to trust this computer’s certificate. Compare the fingerprint shown in MeetLocal if you want to be sure.

## Run it while developing

```bash
npm install
npm run dev
```

## Build the portable apps

Windows, from this computer:

```bash
npm run dist:win
```

The app is written to `release/MeetLocal-1.0.0-windows-x64.exe`.

Mac and Linux builds are produced on GitHub when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The Release workflow builds:

- Windows portable `.exe`
- macOS `.zip` for Intel and Apple silicon
- Linux `.AppImage`

Those files are attached to the GitHub release for that tag. The builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn the first time someone opens them.

## Updates

The desktop app checks [GitHub releases](https://github.com/YHOneBox/Meet-Local/releases) when it opens. If a newer version is published, MeetLocal shows the release notes and downloads the build for this computer. The file keeps the version in its name, for example `MeetLocal-1.2.0-windows-x64.exe`, and sits next to the current app (or in Downloads). Opening it starts that version. The copy you are using stays in place. The same notes stay available from **What’s new** after you update.

## Checks

```bash
npm test
npm run build
npx playwright install chromium
npm run e2e
```
