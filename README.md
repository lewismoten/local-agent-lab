# Local Agent Lab

![Local Agent Lab: Local Models. Portable Workspaces.](./docs/social-preview-640.png)

A browser-based AI workspace for coding, research, and scheduled agents. Run small models locally, connect optional Ollama or API profiles, and keep projects on a folder or removable drive. The site is built with React, TypeScript, and Vite; model weights and optional engines are downloaded only when you choose them.

The portable workspace is designed for people who share computers or use public library computers. Carry a USB drive to keep your projects, chats, and downloaded models available across compatible browsers without buying a computer or subscribing to an AI service. Visit [the GitHub Pages demo](https://lewismoten.github.io/local-agent-lab/) once while online on each new computer, connect the drive, then eject it in the app before unplugging. Browser support and local computer policies can limit folder access or model loading; [privacy and hosting](docs/privacy-and-hosting.md) explains what stays on that computer.

## Run locally

```bash
npm install
npm start
```

Open the Vite URL in desktop Chrome or Edge to connect a portable folder. Browser storage also works without a folder. In **Models**, use **Start offline** to choose a folder, download an engine and model, and load it for chat. Nothing downloads automatically on page load.

Use **Eject workspace** before removing a USB drive. It stops new work, waits for active file operations, and unloads browser models.

## Guides

- [Getting started, builds, and validation](docs/getting-started.md)
- [Workspace features and file layout](docs/workspace.md)
- [Large conversation checks](docs/history-performance.md)
- [Privacy, offline use, and GitHub Pages](docs/privacy-and-hosting.md)
- [Model license handling](docs/model-licenses.md)
- [Image generation](docs/image-generation.md), [graphics and pose](docs/graphics-and-pose.md), and [video and motion](docs/video-motion.md)
- [Legacy Story Studio documentation](docs/legacy-story-studio.md)
- [Implementation checklist](notes/checklist.md)

## Acknowledgment

Development of Local Agent Lab includes coding assistance from GPT-6 Sol.
