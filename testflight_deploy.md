# Deploying Sus Rooms to TestFlight

**App ID:** `site.aviadtest.susrooms`  
**Prerequisites:** Mac with Xcode installed, Apple Developer account with access to the app.

---

## Step 1: Prerequisites (Boss's Mac)

1. Install **Xcode** from the Mac App Store (version 15+)
2. Install **Node.js** (v18+) from nodejs.org
3. Install **CocoaPods**:
   ```bash
   brew install rbenv ruby-build
   rbenv install 3.2.2
   rbenv global 3.2.2
   gem install ffi
   gem install cocoapods
   ```
4. Install **Xcode Command Line Tools**: `xcode-select --install`

---

## Step 2: Get the Code

```bash
git clone <repo-url>
cd thesusrooms/react-three-capacitor
```

---

## Step 3: Build the App

Run this exact command from `react-three-capacitor/`:

```bash
npm install && cd ios/App && pod install && cd ../.. && npm run build && npx cap sync ios
```

---

## Step 4: Register the App in Apple Developer Portal

*(Only needed the first time)*

1. Go to [developer.apple.com](https://developer.apple.com) → **Certificates, Identifiers & Profiles**
2. **Identifiers** → click **+** → App ID → App
3. Set Bundle ID to: `site.aviadtest.susrooms`
4. Enable any capabilities needed → **Register**
5. Go to **App Store Connect** ([appstoreconnect.apple.com](https://appstoreconnect.apple.com))
6. **My Apps** → **+** → **New App**
   - Platform: iOS
   - Name: Sus Rooms
   - Bundle ID: `site.aviadtest.susrooms`
   - SKU: anything (e.g. `susrooms`)

---

## Step 5: Open in Xcode

```bash
npx cap open ios
```

Or open `react-three-capacitor/ios/App/App.xcworkspace` directly in Xcode. **Always open the `.xcworkspace`, not `.xcodeproj`.**

---

## Step 6: Configure Signing in Xcode

1. In Xcode, click the **App** project in the left sidebar
2. Select the **App** target → **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. Set **Team** to your Apple Developer team
5. Confirm Bundle Identifier shows `site.aviadtest.susrooms`

---

## Step 7: Set Version & Build Number

In Xcode → **App** target → **General** tab:
- **Version**: e.g. `1.0.0` (user-facing)
- **Build**: e.g. `1` (must increment with each TestFlight upload)

Or via command line:
```bash
cd ios/App
agvtool new-marketing-version 1.0.0
agvtool next-version -all
```

---

## Step 8: Archive for Distribution

1. In Xcode, set the **run destination** (top bar) to **Any iOS Device (arm64)** — not a simulator, and not a specific plugged-in phone
2. Menu: **Product → Archive**
3. Wait for the archive to complete (5–15 min first time)
4. The **Organizer** window opens automatically

---

## Step 9: Upload to TestFlight

In the Organizer window:
1. Select the archive you just created
2. Click **Distribute App**
3. Choose **TestFlight & App Store** → **Next**
4. Leave defaults → **Next** through signing
5. Click **Upload**

After upload (5–30 min): Apple processes the build. You'll get an email when it's ready.

---

## Step 10: Add Testers in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → Sus Rooms → **TestFlight**
2. Under **Internal Testing**: add testers by Apple ID email
3. Testers install **TestFlight** app on their iPhone, then accept the invite email

---

## Every Subsequent Build

For future updates, just repeat Steps 3, 7 (increment build number), and 8–9:

```bash
# From react-three-capacitor/
npm run build && npx cap sync ios
# Then in Xcode: bump build number → Product → Archive → Distribute
```

---

**Key notes:**
- The `.xcworkspace` must be used (not `.xcodeproj`) because CocoaPods adds dependencies
- Build number must be unique per upload — Apple rejects duplicates
- Internal testers get builds immediately; external testers require Apple review (1–2 days)
