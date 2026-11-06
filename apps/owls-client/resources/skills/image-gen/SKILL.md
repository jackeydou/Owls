---
name: "Image Gen"
description: "Generate or edit raster images when the task calls for AI-created visual assets such as photos, illustrations, textures, sprites, mockups, posters, cutouts, or image transformations. Use when Owls should create a new image, modify an existing image, or produce visual variants from references. Do not use when the work is better done by editing SVG/vector/code-native assets, extending an existing icon or logo system, or building the visual directly in HTML/CSS/canvas."
---

# Image Gen

Use the `image_generate` tool for image creation and image edits.

## When To Use

- Create a new raster image from a description.
- Edit an attached or local image.
- Create visual variants from provided image files.
- Make visual assets such as illustrations, mockups, portraits, memes, diagrams, textures, sprites, or product-style images.

## When Not To Use

- The user wants deterministic code-native output.
- The asset should be an SVG, icon component, HTML/CSS layout, or canvas drawing.
- The task is better handled by editing an existing source file in the repo.

## Tool Contract

- Omit `imagePaths` for text-only image generation.
- Provide `imagePaths` for every image-file edit. Any request with `imagePaths` is an image edit.
- Use absolute local paths from the attachment list when editing attached files.
- Do not overwrite source images. The tool returns new media attachments.

## Workflow

1. Decide whether the request needs a raster image.
2. If image files are attached or named for modification, pass their absolute paths as `imagePaths`.
3. If no image file is part of the request, generate from the text prompt only.
4. Make the prompt specific enough to preserve the user's intent, but do not invent unrelated objects, brands, text, or layout requirements.
5. Call the tool directly when the request is clear enough.
6. After a successful image result, do not add download instructions, image summaries, or follow-up questions.
