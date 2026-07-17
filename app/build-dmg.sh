#!/bin/bash
# Build manycode.app (release) and a drag-to-Applications DMG.
#   ./build-dmg.sh   ->   .build/Manycode.dmg
#
# Signing/notarization is automatic when credentials are in the environment;
# without them the app is ad-hoc signed (Gatekeeper-quarantined, first launch
# is right-click → Open). To kill the Apple warning for downloaders, enroll in
# the Apple Developer Program and set (see NOTARIZE.md):
#   MANYCODE_SIGN_ID  "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID          your Apple ID email
#   APPLE_TEAM_ID     your 10-char Team ID
#   APPLE_APP_PW      an app-specific password (appleid.apple.com)
set -e
cd "$(dirname "$0")"

APP_NAME="manycode"
BUILD=".build"
APP="$BUILD/$APP_NAME.app"

echo "▸ release build"
swift build -c release

echo "▸ icon"
swift make-icon.swift
iconutil -c icns Manycode.iconset -o "$BUILD/Manycode.icns"
rm -rf Manycode.iconset

echo "▸ assembling $APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD/release/Manycode" "$APP/Contents/MacOS/Manycode"
cp Info.plist "$APP/Contents/Info.plist"
cp "$BUILD/Manycode.icns" "$APP/Contents/Resources/Manycode.icns"

if [ -n "$MANYCODE_SIGN_ID" ]; then
  echo "▸ sign (Developer ID, hardened runtime)"
  codesign --force --deep --options runtime --timestamp --sign "$MANYCODE_SIGN_ID" "$APP"
else
  echo "▸ ad-hoc sign (no MANYCODE_SIGN_ID → unsigned download will warn)"
  codesign --force --deep --sign - "$APP"
fi

echo "▸ dmg"
STAGE="$BUILD/dmg"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$BUILD/Manycode.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$BUILD/Manycode.dmg" >/dev/null
rm -rf "$STAGE"

# Notarize + staple so downloaders don't see the "unidentified developer"
# warning. Preferred: a keychain profile (MANYCODE_NOTARY_PROFILE) created once
# with `xcrun notarytool store-credentials` so no password sits in the env.
# Fallback: explicit Apple ID / team / app-specific password.
NOTARIZED=""
if [ -n "$MANYCODE_SIGN_ID" ] && [ -n "$MANYCODE_NOTARY_PROFILE" ]; then
  echo "▸ notarize via keychain profile '$MANYCODE_NOTARY_PROFILE' (waits on Apple, ~1-5 min)"
  xcrun notarytool submit "$BUILD/Manycode.dmg" --keychain-profile "$MANYCODE_NOTARY_PROFILE" --wait
  NOTARIZED=1
elif [ -n "$MANYCODE_SIGN_ID" ] && [ -n "$APPLE_ID" ] && [ -n "$APPLE_TEAM_ID" ] && [ -n "$APPLE_APP_PW" ]; then
  echo "▸ notarize (waits on Apple, ~1-5 min)"
  xcrun notarytool submit "$BUILD/Manycode.dmg" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PW" --wait
  NOTARIZED=1
fi
if [ -n "$NOTARIZED" ]; then
  echo "▸ staple"
  xcrun stapler staple "$BUILD/Manycode.dmg"
  echo "✓ $BUILD/Manycode.dmg (signed + notarized - no Gatekeeper warning)"
else
  echo "✓ $BUILD/Manycode.dmg (unsigned - downloaders right-click → Open on first launch)"
fi
