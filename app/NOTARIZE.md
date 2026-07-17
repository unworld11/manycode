# Killing the Apple "unidentified developer" warning

macOS quarantines anything downloaded from a browser. An **unsigned** app (what
we ship today) then gets the scary "cannot be opened because the developer
cannot be verified" dialog; users have to right-click → Open the first time.

The only way to remove that warning is Apple's **notarization**, which requires
the **Apple Developer Program** ($99/year). There is no free workaround — signing
alone isn't enough, notarization is mandatory since macOS Catalina.

## One-time setup

1. **Enroll** at [developer.apple.com/programs](https://developer.apple.com/programs/) ($99/yr).
2. **Create a "Developer ID Application" certificate** — Xcode → Settings →
   Accounts → Manage Certificates → +, or on the developer portal. It installs
   into your login keychain. Find its exact name:
   ```sh
   security find-identity -v -p codesigning
   # → "Developer ID Application: Your Name (ABCDE12345)"
   ```
3. **App-specific password** for notarytool: [appleid.apple.com](https://appleid.apple.com)
   → Sign-In & Security → App-Specific Passwords → generate one.
4. Note your **Team ID** (the `ABCDE12345` in the cert name, or on the portal).

## Store notary credentials once (keeps the password out of the environment)

```sh
xcrun notarytool store-credentials manycode \
  --apple-id "you@example.com" --team-id "ABCDE12345" --password "abcd-efgh-ijkl-mnop"
```

This saves a keychain profile named `manycode`; the app-specific password lives
in your keychain, not in env vars or scripts.

## Build a notarized DMG

```sh
export MANYCODE_SIGN_ID="Developer ID Application: Your Name (ABCDE12345)"
export MANYCODE_NOTARY_PROFILE="manycode"
cd app && ./build-dmg.sh
```

(Or skip the profile and set `APPLE_ID` / `APPLE_TEAM_ID` / `APPLE_APP_PW`
directly — the script accepts either.)

The script signs with the hardened runtime, submits to Apple, waits for the
ticket, and staples it. Upload the result:

```sh
gh release upload v0.6.0 app/.build/Manycode.dmg --clobber
```

Downloaders now double-click and open with no warning (at most the normal
"downloaded from the internet — open?" prompt).

## Verify

```sh
spctl -a -vvv -t install /Volumes/manycode/manycode.app   # "accepted, source=Notarized Developer ID"
xcrun stapler validate app/.build/Manycode.dmg
```
