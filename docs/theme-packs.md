# Workspace themes

Open **Appearance** in the top bar to choose Signal, Plain dark, or Manuscript. **New theme** creates a custom theme. Custom themes are saved with the current workspace in `harness/settings.json`; a USB workspace carries its theme choices to another browser. Built-in themes cannot be edited or deleted.

## Current theme pack format

**Export** downloads a `.theme.json` file. **Import pack** opens it in the theme editor before saving a new copy. A version 1 pack contains one theme; an optional background PNG is embedded in the JSON:

```json
{
  "format": "local-agent-lab-theme",
  "version": 1,
  "theme": {
    "version": 1,
    "id": "f604750d-e867-472e-a904-31e4a925c8b0",
    "name": "Ink garden",
    "description": "Quiet green ink on charcoal",
    "prompt": "A calm reading room with botanical details",
    "tags": ["quiet", "botanical"],
    "colors": {
      "background": "#10141b",
      "panel": "#1a2029",
      "raised": "#25303c",
      "text": "#eef3f8",
      "muted": "#b7c5d1",
      "accent": "#83ddcf",
      "border": "#536879"
    },
    "font": "serif",
    "radius": 8,
    "motion": "subtle",
    "readingScale": 100
  }
}
```

The importer accepts seven six-digit hexadecimal colors, a font of `sans`, `serif`, or `mono`, a radius from 0 to 24 pixels, motion of `none`, `subtle`, or `full`, and a reading size from 90% to 130%. Older version 1 packs without `readingScale` use 100%. Reading size affects chat, the composer, file editing, and common page text; browser zoom remains available for the entire interface. Names, descriptions, prompts, and tags have length limits. An optional `wallpaper` field holds a PNG data URL; the image must decode, be at most 100 KB, have width and height at most 1600 pixels, and contain at most 1.6 million pixels. It appears softly behind page content. Theme packs are capped at 250 KB, and a workspace stores at most 24 custom themes. Invalid packs are rejected. The browser applies only validated values; packs cannot inject CSS, scripts, or remote image URLs.

Text and panel colors should have at least a 4.5:1 contrast ratio for normal reading. The editor shows their measured ratio. Check the final design on Chat, Models, file editing, long forms, and dialogs at desktop and narrow mobile widths. The `none` motion setting turns off interface animation for that custom theme.

## Staged theme creation

With a confirmed chat model, the editor can generate a theme in three independent steps: name and style, palette, then font, corners, motion, and reading size. Enter a design direction and run each step you want. The proposed values appear in the editor for review. **Preview workspace** temporarily applies the draft across pages; **Edit**, **Save theme**, and **Discard** remain available while you navigate. Previewing does not change saved workspace settings, and a reload restores the saved theme. Without a confirmed model, **Set up a model** opens Models. Palette proposals are checked for dark surfaces and readable text on the background, panel, and raised surface. The app asks the model to correct failures, then adjusts contrast if necessary and tells you when it did so. All output passes the same value validation as imported packs.

The broader theme workflow is still planned:

1. Review the rendered theme across navigation, cards, tables, forms, and dialogs at desktop and mobile sizes. Revise colors or spacing if controls overlap, text clips, or status colors are unclear.
2. Let a vision model assess screenshots, while keeping the screenshots and measured contrast visible for human review.
3. Export a pack, import it into a separate workspace, and verify the same appearance after reload and offline opening.

Additional theme images, textures, layout recipes, broader spacing and control-size options, and default prompts for achievements, avatars, model icons, voices, and journals are **not yet part of version 1**. A future pack version will need to handle larger media and migration from existing packs. A vision model could review screenshots, but its judgment should be shown alongside the actual screenshots and contrast measurements rather than silently accepting a design.
