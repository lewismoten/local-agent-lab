# Troubleshooting

Back to [Local Agent Lab](../README.md) · [Getting started](getting-started.md) · [Workspace guide](workspace.md)

## Workspace and files

| What you see | What to try |
| --- | --- |
| **Connect drive** is unavailable | Use browser storage for work on this computer. For a portable folder, open the site in a browser and computer policy that allow a writable folder picker. |
| The folder picker closes without connecting | Open **Connect drive** again and choose the folder. Canceling the picker leaves the current workspace in place. |
| A remembered drive is not open after reload | Insert the drive and choose **Reconnect drive**. Grant read and write access if prompted. A handle remembered on one computer does not grant permission on another. |
| A save reports a permission or storage error | Confirm the folder is connected and writable. Browser storage checks its approximate origin quota before blob saves; it cannot measure free space on an external drive. Keep a separate copy before removing files to make room. |
| A saved visual reports missing model or engine files | Open **Files & tools → Saved visuals** to see affected paths. Reconnect the folder that holds those packages, or download them again from **Catalog**. **Restore details** can add missing sidecars to older outputs when a matching pinned report exists; it does not recreate missing model files. |

## Models and offline use

| What you see | What to try |
| --- | --- |
| A model is queued, paused, or incomplete | Open **Models → Downloads** and resume it. Keep its license and engine files with the model folder when moving the workspace. |
| **Load** fails or an inspector cannot generate output | Open **Inspect features** for the saved error and confirm the model and required engine are present. Reduce the local context or output limit for memory pressure, or choose a smaller model. Catalog size describes disk download size, not runtime memory. |
| An image or mesh model cannot start | Check the model details for required WebGPU features. The catalog can detect browser APIs, but an available API does not guarantee enough GPU memory. Try a smaller model or resolution where the inspector offers one. |
| The site opens online but fails after going offline | Visit once online, let the app shell finish caching, then reload under service-worker control. Optional models and engines need their own downloads before disconnecting. A new browser profile or computer needs its own first online visit. |
| A model is missing after moving to another computer | Connect the same workspace folder and inspect **Local Models**. Browser-only files and permissions do not travel with a USB drive. |

## Public computers

Use **Eject workspace** before unplugging a drive. When finished with a shared computer, close other tabs of this app and use **Leave this computer** to clear this app's browser data. The app cannot clear the browser's history or downloads managed outside it; use that computer's browser controls for those records. See [privacy and hosting](privacy-and-hosting.md).
