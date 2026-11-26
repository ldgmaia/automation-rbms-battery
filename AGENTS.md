# Release requirements

- Every app update must have a new version and a new Windows portable `.exe` built with that version embedded. Do not reuse a released version for changed app code.
- Use the Windows release workflow for published updates. It assigns `1.0.<workflow run number>`, builds `RBMS-Battery-Reporter.exe`, and publishes the versioned GitHub release used by the app's updater.
- For a local rebuild of an existing release, use that release's version and verify the executable embeds it. Keep the existing release artifacts intact.
