# Health Connect Local Testing

This guide shows how to unblock the Health Connect permission flow on a
development device so you can test `com.anonymous.stepple` without waiting for
Play Console approval.

> **Summary:** Install Google’s Health Connect Toolbox, grant the app developer
> privileges for your package + signing key, optionally generate mock data, then
> launch Stepple and request permissions.

---

## 1. Install Health Connect Toolbox

Either grab it from the Play Store (if available in your region) **or** install
the latest APK with `adb`:

```bash
# Replace {VERSION} with the newest folder name on Google's Maven repo.
curl -L -o health-connect-toolbox.apk \
  https://dl.google.com/android/maven2/com/google/android/health/connect/toolbox/health-connect-toolbox/{VERSION}/health-connect-toolbox-{VERSION}.apk

adb install -r health-connect-toolbox.apk
```

Launch the toolbox once so it can finish setup.

---

## 2. Capture your signing certificate fingerprint

Health Connect trusts apps by signing certificate. Use the fingerprint that
matches the build you plan to install.

- **Debug build (default for `npx expo run:android`):**

  ```bash
  keytool -list -v \
    -alias androiddebugkey \
    -keystore ~/.android/debug.keystore \
    -storepass android -keypass android
  ```

- **Release build (`android/app/stepple-release.keystore`):**

  ```bash
  keytool -list -v \
    -alias steppleRelease \
    -keystore android/app/stepple-release.keystore \
    -storepass MIER5coles -keypass MIER5coles
  ```

Copy the `SHA256:` value from the output; you’ll paste it into the toolbox.

---

## 3. Grant developer privileges to Stepple

1. Open **Health Connect Toolbox**.
2. Grant any permissions the app requests (needed so it can talk to Health Connect).
3. Unlock the developer screen:
   - Toolbox ≥ 2.4: tap the **⋮** menu or the **Developer** tab that appears
     after you tap **About → Version** seven times (watch for the toast
     “Developer features enabled”).
   - Toolbox 2.3.x (no menu): open the **☰** drawer → **About** → tap the
     **Version** row seven times, then swipe to the new **Developer** tab.
4. Inside **Developer → App developer privileges**, tap **+**.
5. Enter your package name `com.anonymous.stepple` and paste the `SHA-256`
   fingerprint captured above.

> **Tip:** On Android 15 you can alternatively use the shell command once the
> Health Connect system app is up to date:
> ```bash
> adb shell cmd healthconnect developer add-privileged-app \
>   --package com.anonymous.stepple \
>   --cert-digest SHA256:AA:BB:...
> ```
> If you see “No shell command implementation,” install the latest Health
> Connect update from the Play Store (or sideload the newest APK) and reboot.

---

## 4. Optionally generate mock data

To test without moving around:

1. In the toolbox, open **Data**.
2. Choose **Steps** (or any data type your feature needs).
3. Tap **Generate** and fill in a time range + desired totals.

Those records immediately appear in Health Connect and are readable by the app.

---

## 5. Install and run Stepple

- **Debug build:** `npx expo run:android --variant debug`
- **Release build:** `./gradlew assembleRelease` then

  ```bash
  adb install -r android/app/build/outputs/apk/release/app-release.apk
  ```

Launch the app and trigger your Health Connect permission flow. Because the
package + certificate are now trusted, the consent sheet appears and your reads
should succeed.

If the sheet still doesn’t show:

1. Force-close **Health Connect** and **Health Connect Toolbox**.
2. Reopen the toolbox and confirm `com.anonymous.stepple` is listed under
   **Developer privileges**.
3. Retry the permission request.

Once you’re done, you can remove the override from the toolbox so the device
behaves like production again.
