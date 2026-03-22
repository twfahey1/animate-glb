# Animate GLB

Desktop MVP for loading a GLB or GLTF file, previewing it in Three.js, and generating a prompt-driven transform animation recipe through the Tauri backend.

## Current features

- Native file picker through Tauri's dialog plugin
- Rust command to inspect a model and extract scene, node, and animation metadata
- Three.js viewport with camera framing, orbit controls, and embedded-animation preview
- Prompt form that asks the backend for a generated animation recipe
- Optional OpenAI-backed recipe generation when `OPENAI_API_KEY` is present
- Deterministic local fallback recipe generator when no AI credentials are configured

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri:dev
```

Build the production bundle:

```bash
npm run tauri:build
```

## OpenAI integration

If you want the backend to call OpenAI instead of the local heuristic fallback, export these variables before starting the app:

```bash
export OPENAI_API_KEY="your_api_key"
export OPENAI_MODEL="gpt-5.4"
```

If the OpenAI request fails or those variables are absent, the backend automatically returns a local transform recipe so the app remains usable offline.

## Next implementation targets

- Map generated motion onto specific nodes or skeleton bones instead of just root transforms
- Add prompt history and recipe persistence
- Import and export generated clips in a reusable format
- Add tests around prompt parsing and GLB metadata extraction
