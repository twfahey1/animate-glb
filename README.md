# Animate GLB

Desktop MVP for loading a GLB or GLTF file, previewing it in Three.js, and generating a prompt-driven transform animation recipe through the Tauri backend.

## Current features

- Native file picker through Tauri's dialog plugin
- Rust command to inspect a model and extract scene, node, and animation metadata
- Three.js viewport with camera framing, orbit controls, and embedded-animation preview
- Prompt form that asks the backend for a generated animation recipe
- Node- and bone-targeted playback for prompts that imply local body motion like head turns, laughs, and pointing
- Local clip library for saving generated recipes per source model
- Export action that writes a new GLB with the generated clip embedded as a native animation
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

## Exporting generated animations

There are now two distinct save paths in the app:

- `Save`: stores the current generated recipe in the local app library so it can be replayed later for the same source model.
- `Save GLB with animations`: writes a new `.glb` file that contains the source model plus the generated clip as a native glTF animation.

The exported GLB is intended for use in external tools such as Blender, game engines, and other viewers that understand glTF animations.

Current export behavior:

- Uses the original loaded scene, not the preview-normalized version shown in the viewport
- Preserves existing embedded animations and appends the generated one
- Exports from the Three.js scene graph via `GLTFExporter`

Current limitation:

- The exported animation is still based on this app's transform-track recipe system. It is useful for reuse, but it is not yet a full retargeting or authored skeletal animation pipeline.

## Planned feature: Rigging via AI

The next major feature after animation export is an AI-assisted rigging workflow for raw, poorly structured, or unrigged GLB files.

Goal:

- Take a source GLB that lacks a clean humanoid rig
- Analyze the mesh, hierarchy, and proportions
- Infer a canonical skeleton layout
- Bind the mesh to that skeleton
- Produce a rig profile that can drive prompt-generated animation and export cleanly to downstream tools

Proposed implementation phases:

1. Asset diagnosis
	- Detect whether the model is already rigged, partially rigged, or unrigged
	- Count meshes, skins, joints, and suspicious hierarchy patterns
	- Surface rig-health metadata in the UI before attempting rigging

2. Canonical body inference
	- Use node names, scene hierarchy, and mesh bounds to estimate head, chest, pelvis, hands, legs, and feet
	- Build confidence scores for each inferred body region
	- Store the result as an explicit rig analysis object

3. AI rig proposal
	- Feed the asset summary and inferred body layout into an AI prompt
	- Ask for a proposed humanoid skeleton map, side labeling, and joint placement strategy
	- Keep the proposal inspectable instead of applying it blindly

4. Skeleton generation and binding
	- Generate a canonical joint hierarchy for the model
	- Attach skinning data or remap to an existing skin where possible
	- Preserve the original model as a non-destructive source version

5. Animation retargeting integration
	- Use the rig analysis and final rig to drive prompt generation against canonical joints instead of fuzzy names
	- Export the rigged result plus generated animations as portable GLB assets

Initial constraints to respect:

- Keep rigging non-destructive and reversible
- Show confidence and unresolved joints in the UI
- Support a human review step before writing a modified asset
- Separate "analysis", "proposal", and "apply rig" into distinct actions

## Next implementation targets

- Improve targeting quality with per-model retargeting profiles and better side detection for limbs
- Add rig-health metadata so the app can distinguish rigged, partially rigged, and unrigged assets
- Design the AI rig proposal data contract and review flow
- Add tests around prompt parsing, target matching, export generation, and GLB metadata extraction
