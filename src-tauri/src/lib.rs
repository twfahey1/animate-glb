use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlbSummary {
  file_path: String,
  file_name: String,
  size_bytes: u64,
  scene_count: usize,
  node_count: usize,
  animation_count: usize,
  scene_names: Vec<String>,
  node_names: Vec<String>,
  animation_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationTrack {
  binding: String,
  times: Vec<f32>,
  values: Vec<f32>,
  interpolation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationRecipe {
  name: String,
  source: String,
  rationale: String,
  duration_seconds: f32,
  looping: bool,
  tracks: Vec<AnimationTrack>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateAnimationInput {
  prompt: String,
  summary: GlbSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlbBinaryPayload {
  file_name: String,
  bytes: Vec<u8>,
}

fn sampled_curve(points: &[(f32, f32)]) -> (Vec<f32>, Vec<f32>) {
  let mut times = Vec::with_capacity(points.len());
  let mut values = Vec::with_capacity(points.len());

  for (time, value) in points {
    times.push(*time);
    values.push(*value);
  }

  (times, values)
}

fn track(binding: &str, points: &[(f32, f32)]) -> AnimationTrack {
  let (times, values) = sampled_curve(points);

  AnimationTrack {
    binding: binding.to_string(),
    times,
    values,
    interpolation: "smooth".to_string(),
  }
}

fn fallback_recipe(prompt: &str) -> AnimationRecipe {
  let normalized = prompt.to_lowercase();
  let duration_seconds = if normalized.contains("slow") {
    6.0
  } else if normalized.contains("fast") || normalized.contains("snappy") {
    2.4
  } else {
    4.0
  };

  let mut tracks = vec![
    track(
      ".position[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.06),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, 0.07),
        (duration_seconds, 0.0),
      ],
    ),
    track(
      ".scale[x]",
      &[(0.0, 1.0), (duration_seconds * 0.5, 1.02), (duration_seconds, 1.0)],
    ),
    track(
      ".scale[y]",
      &[(0.0, 1.0), (duration_seconds * 0.5, 1.03), (duration_seconds, 1.0)],
    ),
    track(
      ".scale[z]",
      &[(0.0, 1.0), (duration_seconds * 0.5, 1.02), (duration_seconds, 1.0)],
    ),
  ];

  let mut rationale = "Generated a calm idle loop with subtle breathing and lift.".to_string();

  if normalized.contains("turn") || normalized.contains("spin") || normalized.contains("rotate") {
    tracks.push(track(
      ".rotation[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.5, std::f32::consts::PI * 0.5),
        (duration_seconds, std::f32::consts::PI),
      ],
    ));
    rationale = "Added a loopable turn layered on top of an idle breathing motion.".to_string();
  }

  if normalized.contains("bounce") || normalized.contains("hop") || normalized.contains("jump") {
    tracks.push(track(
      ".position[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.18, 0.0),
        (duration_seconds * 0.34, 0.42),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Built a punchier vertical bounce and preserved a stable landing pose.".to_string();
  }

  if normalized.contains("sway") || normalized.contains("dance") || normalized.contains("groove") {
    tracks.push(track(
      ".rotation[z]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.16),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, -0.16),
        (duration_seconds, 0.0),
      ],
    ));
    tracks.push(track(
      ".position[x]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.12),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, -0.12),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Added side-to-side sway and weight shift to match the prompt.".to_string();
  }

  if normalized.contains("nod") || normalized.contains("look down") || normalized.contains("bow") {
    tracks.push(track(
      ".rotation[x]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.3, -0.12),
        (duration_seconds * 0.6, 0.04),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Added a head-and-torso nod profile with a soft return to neutral.".to_string();
  }

  AnimationRecipe {
    name: "Prompt Motion".to_string(),
    source: "fallback".to_string(),
    rationale,
    duration_seconds,
    looping: true,
    tracks,
  }
}

fn sanitize_recipe(mut recipe: AnimationRecipe) -> AnimationRecipe {
  const ALLOWED_BINDINGS: [&str; 9] = [
    ".position[x]",
    ".position[y]",
    ".position[z]",
    ".rotation[x]",
    ".rotation[y]",
    ".rotation[z]",
    ".scale[x]",
    ".scale[y]",
    ".scale[z]",
  ];

  recipe.duration_seconds = recipe.duration_seconds.clamp(0.5, 12.0);
  recipe.tracks = recipe
    .tracks
    .into_iter()
    .filter(|track| ALLOWED_BINDINGS.contains(&track.binding.as_str()))
    .filter(|track| !track.times.is_empty() && track.times.len() == track.values.len())
    .take(12)
    .collect();

  if recipe.source.trim().is_empty() {
    recipe.source = "fallback".to_string();
  }

  if recipe.name.trim().is_empty() {
    recipe.name = "Prompt Motion".to_string();
  }

  if recipe.rationale.trim().is_empty() {
    recipe.rationale = "Applied the requested motion as transform tracks on the loaded model.".to_string();
  }

  recipe
}

async fn openai_recipe(prompt: &str, summary: &GlbSummary) -> Result<Option<AnimationRecipe>, String> {
  let api_key = match env::var("OPENAI_API_KEY") {
    Ok(value) if !value.trim().is_empty() => value,
    _ => return Ok(None),
  };

  let model = env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4".to_string());
  let client = reqwest::Client::new();
  let request_body = json!({
    "model": model,
    "response_format": { "type": "json_object" },
    "messages": [
      {
        "role": "system",
        "content": "You generate concise loop-friendly animation recipes for 3D models. Return JSON only. Use only these bindings: .position[x], .position[y], .position[z], .rotation[x], .rotation[y], .rotation[z], .scale[x], .scale[y], .scale[z]. Times and values arrays must be equal length."
      },
      {
        "role": "user",
        "content": format!(
          "Prompt: {prompt}\n\nModel summary: {}\n\nReturn an object with keys name, source, rationale, durationSeconds, looping, tracks. Each track must include binding, times, values, interpolation. Keep duration under 12 seconds.",
          serde_json::to_string(summary).map_err(|error| error.to_string())?
        )
      }
    ]
  });

  let response = client
    .post("https://api.openai.com/v1/chat/completions")
    .bearer_auth(api_key)
    .json(&request_body)
    .send()
    .await
    .map_err(|error| error.to_string())?;

  if !response.status().is_success() {
    return Err(format!("OpenAI request failed with status {}", response.status()));
  }

  let payload = response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| error.to_string())?;
  let content = payload
    .get("choices")
    .and_then(|choices| choices.get(0))
    .and_then(|choice| choice.get("message"))
    .and_then(|message| message.get("content"))
    .and_then(|content| content.as_str())
    .ok_or_else(|| "OpenAI response did not contain JSON content.".to_string())?;

  let mut recipe = serde_json::from_str::<AnimationRecipe>(content)
    .map_err(|error| format!("OpenAI returned invalid JSON for an animation recipe: {error}"))?;
  recipe.source = "openai".to_string();

  Ok(Some(sanitize_recipe(recipe)))
}

#[tauri::command]
async fn inspect_glb(file_path: String) -> Result<GlbSummary, String> {
  let canonical_path = fs::canonicalize(PathBuf::from(file_path.clone()))
    .map_err(|error| format!("Could not resolve the selected file: {error}"))?;
  let extension = canonical_path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .unwrap_or_default();

  if extension != "glb" && extension != "gltf" {
    return Err("Only .glb and .gltf files are supported right now.".to_string());
  }

  let metadata = fs::metadata(&canonical_path)
    .map_err(|error| format!("Unable to read file metadata: {error}"))?;
  let document = gltf::Gltf::open(&canonical_path)
    .map_err(|error| format!("Unable to parse that model file: {error}"))?;

  let scene_names = document
    .scenes()
    .enumerate()
    .map(|(index, scene)| scene.name().map(str::to_string).unwrap_or_else(|| format!("Scene {}", index + 1)))
    .collect::<Vec<_>>();
  let node_count = document.nodes().count();
  let node_names = document
    .nodes()
    .enumerate()
    .filter_map(|(index, node)| {
      node.name()
        .map(str::to_string)
        .or_else(|| (index < 12).then(|| format!("Node {}", index + 1)))
    })
    .take(16)
    .collect::<Vec<_>>();
  let animation_names = document
    .animations()
    .enumerate()
    .map(|(index, animation)| {
      animation
        .name()
        .map(str::to_string)
        .unwrap_or_else(|| format!("Animation {}", index + 1))
    })
    .collect::<Vec<_>>();

  Ok(GlbSummary {
    file_path: canonical_path.to_string_lossy().to_string(),
    file_name: canonical_path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or("Unnamed model")
      .to_string(),
    size_bytes: metadata.len(),
    scene_count: scene_names.len(),
    node_count,
    animation_count: animation_names.len(),
    scene_names,
    node_names,
    animation_names,
  })
}

#[tauri::command]
async fn read_glb_binary(file_path: String) -> Result<GlbBinaryPayload, String> {
  let canonical_path = fs::canonicalize(PathBuf::from(file_path.clone()))
    .map_err(|error| format!("Could not resolve the selected file: {error}"))?;
  let extension = canonical_path
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .unwrap_or_default();

  if extension != "glb" {
    return Err("Desktop preview currently supports .glb files only.".to_string());
  }

  let bytes = fs::read(&canonical_path)
    .map_err(|error| format!("Unable to read the GLB file bytes: {error}"))?;

  Ok(GlbBinaryPayload {
    file_name: canonical_path
      .file_name()
      .and_then(|value| value.to_str())
      .unwrap_or("Unnamed model")
      .to_string(),
    bytes,
  })
}

#[tauri::command]
async fn generate_animation_recipe(input: GenerateAnimationInput) -> Result<AnimationRecipe, String> {
  if input.prompt.trim().is_empty() {
    return Err("Please enter a prompt before generating an animation.".to_string());
  }

  match openai_recipe(&input.prompt, &input.summary).await {
    Ok(Some(recipe)) => Ok(recipe),
    Ok(None) => Ok(fallback_recipe(&input.prompt)),
    Err(error) => {
      log::warn!("OpenAI animation generation failed, using fallback recipe: {error}");
      Ok(fallback_recipe(&input.prompt))
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![inspect_glb, read_glb_binary, generate_animation_recipe])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
