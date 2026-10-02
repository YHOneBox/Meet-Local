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
- Choose a font size, a meeting style, and the defaults for microphone, camera, layout, and the waiting room.

The MeetLocal window hosts the call. When you open the meeting, it starts in your browser. Keep the MeetLocal window open until the call is over. The browser link that opens the host controls is a one-time address on this computer, and it is not the link you share.

People have to be able to reach the address you share. A VPN link works for people on that VPN. A local-network link works for people on the same LAN. MeetLocal does not relay the call through a cloud service.

Voice, video, and screen sharing are encrypted between the people in the call. The connection to this computer is also encrypted. The person hosting the meeting runs the call on their computer, so they can see the chat. A device address stays on your VPN or local network. A temporary link is a Cloudflare address that does not include this computer’s IP. Cloudflare can see the meeting page and chat on that link. Voice and video still travel encrypted between the people in the call, and they are not sent through MeetLocal’s servers. Before joining a device address, compare the certificate fingerprint in your window with the one the host sees. A password is optional and is stored only as a hash on the host. Address discovery through STUN is off unless the host turns it on, or a public temporary link needs it, and even then it does not carry the call.

The first time the host opens the meeting in a browser, the browser asks them to continue past this computer’s certificate. Guests see the same question for a device address. In the MeetLocal app, a guest confirms that same fingerprint before the app trusts the host.

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

The app is written to `release/MeetLocal-1.0.2-windows-x64.exe`.

Mac and Linux builds are produced on GitHub when you push a version tag. The workflow sets the app version from that tag before it builds, so the file name matches the tag. `v1.0.2` produces `MeetLocal-1.0.2-...`.

```bash
git tag v1.0.2
git push origin v1.0.2
```

The Release workflow builds:

- Windows portable `.exe`
- macOS `.zip` for Intel and Apple silicon
- Linux `.AppImage`

Those files are attached to the GitHub release for that tag. The builds are unsigned, so Windows SmartScreen and macOS Gatekeeper will warn the first time someone opens them.

## Updates

The desktop app checks [GitHub releases](https://github.com/YHOneBox/Meet-Local/releases) every time it opens. If a newer version is published, MeetLocal asks whether to update and shows the release notes. Choosing **Not now** hides that question until the next time you open the app. The download keeps the version in its name, for example `MeetLocal-1.2.0-windows-x64.exe`, and sits next to the current app. Opening it starts that version. The copy you are using stays in place. The same notes stay available from **What’s new** after you update.

## Data on this computer

MeetLocal does not keep the meeting. Chat, video, and the password exist only while the call is open. What it does keep is stored with the app, in a folder named `MeetLocal-data`:

- On Windows and Linux, that folder is next to the app file.
- On Mac, it is inside the app.

That folder holds your display name, font size, meeting style, microphone and camera choices, cached release notes, and recordings you save. Copy the app together with `MeetLocal-data` and those settings come with it. A Windows or Linux app is a single file, so the data folder has to sit beside it.

## Checks

```bash
npm test
npm run build
npx playwright install chromium
npm run e2e
```
