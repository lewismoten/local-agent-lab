# Avatar packs

Open **Images → Generate pack** to name and generate a group of avatars. Each image is saved as it completes. You can stop a long run and keep the images already saved. A pack can contain 4, 8, 12, 16, or 24 images; generation stays sequential so only one image model runs at a time.

The **Avatar pack** filter shows one pack or the whole library. Select a pack to export it as a `.avatar-pack.json` file. **Import pack** brings its images and labels into the current workspace as a new pack. The file carries PNG image bytes, names, tags, source labels, and prompts. It does not carry model weights or engine files.

An imported file may contain 1–24 PNG images. Each image is limited to 512,000 bytes, the combined image bytes to 12,288,000 bytes, and the pack file to 17 MB. The importer checks the format and browser image decoding before saving each image. If an import stops partway through, completed images remain in the workspace and the page reports how many were saved.
