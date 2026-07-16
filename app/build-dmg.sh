#!/bin/bash
# Build Manycode.app (release, ad-hoc signed) and a drag-to-Applications DMG.
#   ./build-dmg.sh   ->   .build/Manycode.dmg
#
# The DMG is unsigned/un-notarized, so a downloaded copy is Gatekeeper-
# quarantined: first launch is right-click → Open (or `xattr -dr
# com.apple.quarantine /Applications/manycode.app`). Real fix later: a
# Developer ID + notarization.
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

echo "▸ ad-hoc sign"
codesign --force --deep --sign - "$APP"

echo "▸ dmg"
STAGE="$BUILD/dmg"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$BUILD/Manycode.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$BUILD/Manycode.dmg" >/dev/null
rm -rf "$STAGE"

echo "✓ $BUILD/Manycode.dmg"
