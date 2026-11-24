# RBMS Battery Reporter

Electron desktop app for generating battery reports and uploading them to RBMS.

## Use

1. Sign in with your RBMS email and password.
2. Insert the battery and press Enter (or choose **Generate report**).
3. Check the displayed battery health. The report is kept locally and is not uploaded yet.
4. Remove the battery, scan or enter its serial number, and choose **Upload to RBMS**.
5. After a successful upload, choose the default or backup printer and print the battery label, or skip printing. If printing fails, you can retry or choose the other printer without uploading again.
6. The app returns to the report-generation step.

The authentication token is held in memory only. Closing the app ends the session.
Printing sends ZPL over HTTP to the selected printer (`192.168.50.140` by default, or `192.168.51.111` for the backup). The app must be able to reach the printer on the network. A successful response means the printer accepted the request; it does not verify that a label physically printed.

Use **Settings > Printer test** to send a sample label to either printer without logging in or uploading a report. It uses the same label template and printer request as a battery label. If the request fails or times out, check the printer before retrying: the label may still have printed. The selected printer is shared with the upload workflow for the current app session.

## Battery data by platform

- **Windows:** generates the report with `powercfg /batteryreport`.
- **Ubuntu/Linux:** reads capacity data from `/sys/class/power_supply` and creates a small HTML report with the capacity fields expected by the RBMS upload endpoint. If usable data is unavailable, the app shows an error and does not upload.

Battery health is rounded from full-charge capacity divided by design capacity, matching the calculation performed by RBMS.

The first step refreshes the operating system's detected battery count approximately every three seconds. On Windows this uses `Win32_Battery`; on Linux it reads the `type` and `present` values under `/sys/class/power_supply`. Detection may include internal batteries and does not identify the battery being tested or guarantee which battery the report describes. If detection is unavailable, the app shows the error but still allows report generation.

## Development

Requires Node.js and pnpm.

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

## Portable builds

Build on the target operating system:

```sh
pnpm build:win
pnpm build:linux
```

The Windows command creates a portable `.exe`; the Linux command creates an AppImage. Outputs are written to `release/`.

## Releases and updates

Every push to `main` or `master` runs the Windows release workflow. It tests and builds the pushed commit, assigns version `1.0.<workflow run number>` (numbers can have gaps), and publishes a GitHub release containing `RBMS-Battery-Reporter.exe`. The version is embedded in the build; the workflow does not commit a version bump. The repository must allow GitHub Actions to write contents and releases. A failed publishing run may leave a draft release that must be inspected before retrying.

In the Windows portable app, use **Settings > App updates > Check for updates**. If a newer release is available, **Update now** downloads and verifies the release executable, then closes and restarts the app to replace the original file. The current RBMS session ends; complete any in-progress report first. The executable's directory must be writable and other copies using the same file must be closed. If replacement fails, an error identifies the original, backup, and downloaded files for recovery. Automatic installation is not supported in development, unpacked builds, or Linux AppImages. Releases are unsigned, so Windows may display security warnings.
