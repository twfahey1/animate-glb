use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

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
  target_node_names: Vec<String>,
  rig_profile: RigProfile,
  rig_diagnostics: RigDiagnostics,
  animation_names: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigProfile {
  root: Option<String>,
  pelvis: Option<String>,
  spine: Option<String>,
  chest: Option<String>,
  neck: Option<String>,
  head: Option<String>,
  jaw: Option<String>,
  left_shoulder: Option<String>,
  left_upper_arm: Option<String>,
  left_forearm: Option<String>,
  left_hand: Option<String>,
  right_shoulder: Option<String>,
  right_upper_arm: Option<String>,
  right_forearm: Option<String>,
  right_hand: Option<String>,
  left_thigh: Option<String>,
  left_calf: Option<String>,
  left_foot: Option<String>,
  right_thigh: Option<String>,
  right_calf: Option<String>,
  right_foot: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigDiagnostics {
  mesh_count: usize,
  primitive_count: usize,
  material_count: usize,
  skin_count: usize,
  joint_count: usize,
  named_node_count: usize,
  targetable_node_count: usize,
  resolved_rig_slot_count: usize,
  total_rig_slot_count: usize,
  detected_humanoid_score: f32,
  rig_status: String,
  rigging_needed: bool,
  notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigProposal {
  source: String,
  rigging_needed: bool,
  confidence: f32,
  readiness: String,
  rationale: String,
  proposed_rig_profile: RigProfile,
  unresolved_slots: Vec<String>,
  recommended_actions: Vec<String>,
  warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRigProposalInput {
  summary: GlbSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnimationTrack {
  target_name: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedAnimationClip {
  id: String,
  model_file_path: String,
  model_file_name: String,
  prompt: String,
  saved_at_epoch_ms: u128,
  recipe: AnimationRecipe,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAnimationClipInput {
  prompt: String,
  summary: GlbSummary,
  recipe: AnimationRecipe,
}

fn saved_clips_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| format!("Unable to locate the app data directory: {error}"))?;

  fs::create_dir_all(&app_data_dir)
    .map_err(|error| format!("Unable to create the app data directory: {error}"))?;

  Ok(app_data_dir.join("saved-animation-clips.json"))
}

fn read_saved_animation_clips(app_handle: &tauri::AppHandle) -> Result<Vec<SavedAnimationClip>, String> {
  let file_path = saved_clips_file_path(app_handle)?;

  if !file_path.exists() {
    return Ok(Vec::new());
  }

  let content = fs::read_to_string(&file_path)
    .map_err(|error| format!("Unable to read saved clips from disk: {error}"))?;

  if content.trim().is_empty() {
    return Ok(Vec::new());
  }

  serde_json::from_str::<Vec<SavedAnimationClip>>(&content)
    .map_err(|error| format!("Saved clip data is invalid JSON: {error}"))
}

fn write_saved_animation_clips(
  app_handle: &tauri::AppHandle,
  clips: &[SavedAnimationClip],
) -> Result<(), String> {
  let file_path = saved_clips_file_path(app_handle)?;
  let content = serde_json::to_string_pretty(clips)
    .map_err(|error| format!("Unable to serialize saved clips: {error}"))?;

  fs::write(file_path, content).map_err(|error| format!("Unable to write saved clips: {error}"))
}

#[tauri::command]
fn write_binary_file(file_path: String, bytes: Vec<u8>) -> Result<(), String> {
  let target_path = PathBuf::from(file_path.clone());

  if bytes.is_empty() {
    return Err("No export bytes were provided.".to_string());
  }

  if let Some(parent) = target_path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Unable to create the destination directory: {error}"))?;
  }

  fs::write(&target_path, bytes)
    .map_err(|error| format!("Unable to write the exported file to {}: {error}", target_path.to_string_lossy()))
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

fn targeted_track(target_name: Option<String>, binding: &str, points: &[(f32, f32)]) -> AnimationTrack {
  let (times, values) = sampled_curve(points);

  AnimationTrack {
    target_name,
    binding: binding.to_string(),
    times,
    values,
    interpolation: "smooth".to_string(),
  }
}

fn normalize_lookup_key(value: &str) -> String {
  value
    .chars()
    .filter(|character| character.is_ascii_alphanumeric())
    .flat_map(|character| character.to_lowercase())
    .collect()
}

fn rig_slot_labels() -> [&'static str; 21] {
  [
    "root",
    "pelvis",
    "spine",
    "chest",
    "neck",
    "head",
    "jaw",
    "leftShoulder",
    "leftUpperArm",
    "leftForearm",
    "leftHand",
    "rightShoulder",
    "rightUpperArm",
    "rightForearm",
    "rightHand",
    "leftThigh",
    "leftCalf",
    "leftFoot",
    "rightThigh",
    "rightCalf",
    "rightFoot",
  ]
}

fn resolved_rig_slot_count(rig_profile: &RigProfile) -> usize {
  [
    rig_profile.root.as_ref(),
    rig_profile.pelvis.as_ref(),
    rig_profile.spine.as_ref(),
    rig_profile.chest.as_ref(),
    rig_profile.neck.as_ref(),
    rig_profile.head.as_ref(),
    rig_profile.jaw.as_ref(),
    rig_profile.left_shoulder.as_ref(),
    rig_profile.left_upper_arm.as_ref(),
    rig_profile.left_forearm.as_ref(),
    rig_profile.left_hand.as_ref(),
    rig_profile.right_shoulder.as_ref(),
    rig_profile.right_upper_arm.as_ref(),
    rig_profile.right_forearm.as_ref(),
    rig_profile.right_hand.as_ref(),
    rig_profile.left_thigh.as_ref(),
    rig_profile.left_calf.as_ref(),
    rig_profile.left_foot.as_ref(),
    rig_profile.right_thigh.as_ref(),
    rig_profile.right_calf.as_ref(),
    rig_profile.right_foot.as_ref(),
  ]
  .into_iter()
  .filter(|slot| slot.is_some())
  .count()
}

fn unresolved_rig_slots(rig_profile: &RigProfile) -> Vec<String> {
  let slots = [
    ("root", rig_profile.root.as_ref()),
    ("pelvis", rig_profile.pelvis.as_ref()),
    ("spine", rig_profile.spine.as_ref()),
    ("chest", rig_profile.chest.as_ref()),
    ("neck", rig_profile.neck.as_ref()),
    ("head", rig_profile.head.as_ref()),
    ("jaw", rig_profile.jaw.as_ref()),
    ("leftShoulder", rig_profile.left_shoulder.as_ref()),
    ("leftUpperArm", rig_profile.left_upper_arm.as_ref()),
    ("leftForearm", rig_profile.left_forearm.as_ref()),
    ("leftHand", rig_profile.left_hand.as_ref()),
    ("rightShoulder", rig_profile.right_shoulder.as_ref()),
    ("rightUpperArm", rig_profile.right_upper_arm.as_ref()),
    ("rightForearm", rig_profile.right_forearm.as_ref()),
    ("rightHand", rig_profile.right_hand.as_ref()),
    ("leftThigh", rig_profile.left_thigh.as_ref()),
    ("leftCalf", rig_profile.left_calf.as_ref()),
    ("leftFoot", rig_profile.left_foot.as_ref()),
    ("rightThigh", rig_profile.right_thigh.as_ref()),
    ("rightCalf", rig_profile.right_calf.as_ref()),
    ("rightFoot", rig_profile.right_foot.as_ref()),
  ];

  slots
    .into_iter()
    .filter(|(_, value)| value.is_none())
    .map(|(label, _)| label.to_string())
    .collect()
}

fn find_profile_node(candidates: &[String], keywords: &[&str]) -> Option<String> {
  let normalized_candidates = candidates
    .iter()
    .map(|candidate| (normalize_lookup_key(candidate), candidate.clone()))
    .collect::<Vec<_>>();

  for keyword in keywords {
    let normalized_keyword = normalize_lookup_key(keyword);

    if let Some((_, candidate)) = normalized_candidates
      .iter()
      .find(|(candidate_key, _)| candidate_key == &normalized_keyword)
    {
      return Some(candidate.clone());
    }
  }

  for keyword in keywords {
    let normalized_keyword = normalize_lookup_key(keyword);

    if let Some((_, candidate)) = normalized_candidates
      .iter()
      .find(|(candidate_key, _)| candidate_key.contains(&normalized_keyword))
    {
      return Some(candidate.clone());
    }
  }

  None
}

fn build_rig_profile(node_names: &[String]) -> RigProfile {
  RigProfile {
    root: find_profile_node(node_names, &["root", "armature", "origin"]),
    pelvis: find_profile_node(node_names, &["hips", "pelvis", "hip"]),
    spine: find_profile_node(node_names, &["spine", "spine1", "spine01"]),
    chest: find_profile_node(node_names, &["chest", "spine2", "spine02", "upperchest"]),
    neck: find_profile_node(node_names, &["neck", "neck1"]),
    head: find_profile_node(node_names, &["head", "headtop"]),
    jaw: find_profile_node(node_names, &["jaw", "chin", "mouth"]),
    left_shoulder: find_profile_node(node_names, &["leftshoulder", "shoulderl", "lshoulder", "claviclel"]),
    left_upper_arm: find_profile_node(node_names, &["leftarm", "leftupperarm", "upperarml", "arml", "larm"]),
    left_forearm: find_profile_node(node_names, &["leftforearm", "leftlowerarm", "forearml", "lowerarml", "lforearm"]),
    left_hand: find_profile_node(node_names, &["lefthand", "handl", "lhand"]),
    right_shoulder: find_profile_node(node_names, &["rightshoulder", "shoulderr", "rshoulder", "clavicler"]),
    right_upper_arm: find_profile_node(node_names, &["rightarm", "rightupperarm", "upperarmr", "armr", "rarm"]),
    right_forearm: find_profile_node(node_names, &["rightforearm", "rightlowerarm", "forearmr", "lowerarmr", "rforearm"]),
    right_hand: find_profile_node(node_names, &["righthand", "handr", "rhand"]),
    left_thigh: find_profile_node(node_names, &["leftupleg", "leftthigh", "uplegl", "thighl", "lthigh"]),
    left_calf: find_profile_node(node_names, &["leftleg", "leftcalf", "legl", "calfl", "lcalf"]),
    left_foot: find_profile_node(node_names, &["leftfoot", "footl", "lfoot"]),
    right_thigh: find_profile_node(node_names, &["rightupleg", "rightthigh", "uplegr", "thighr", "rthigh"]),
    right_calf: find_profile_node(node_names, &["rightleg", "rightcalf", "legr", "calfr", "rcalf"]),
    right_foot: find_profile_node(node_names, &["rightfoot", "footr", "rfoot"]),
  }
}

fn build_rig_diagnostics(document: &gltf::Gltf, rig_profile: &RigProfile, target_node_names: &[String]) -> RigDiagnostics {
  let mesh_count = document.meshes().count();
  let primitive_count = document.meshes().map(|mesh| mesh.primitives().count()).sum();
  let material_count = document.materials().count();
  let skin_count = document.skins().count();
  let joint_count: usize = document.skins().map(|skin| skin.joints().count()).sum();
  let named_node_count = document.nodes().filter(|node| node.name().is_some()).count();
  let resolved_rig_slot_count = resolved_rig_slot_count(rig_profile);
  let total_rig_slot_count = rig_slot_labels().len();
  let detected_humanoid_score = ((resolved_rig_slot_count as f32 / total_rig_slot_count as f32) * 0.65
    + ((joint_count.min(24) as f32 / 24.0) * 0.25)
    + ((target_node_names.len().min(24) as f32 / 24.0) * 0.10))
    .clamp(0.0, 1.0);

  let rig_status = if skin_count > 0 && joint_count >= 12 && resolved_rig_slot_count >= 8 {
    "rigged"
  } else if skin_count > 0 || joint_count >= 4 || resolved_rig_slot_count >= 4 {
    "partial"
  } else if mesh_count > 0 {
    "unrigged"
  } else {
    "unknown"
  }
  .to_string();

  let rigging_needed = rig_status != "rigged";
  let mut notes = Vec::new();

  if mesh_count == 0 {
    notes.push("No mesh objects were found in the source asset.".to_string());
  }

  if skin_count == 0 {
    notes.push("No glTF skin data was detected, so the asset is not currently skinned for skeletal animation export.".to_string());
  }

  if joint_count == 0 {
    notes.push("No skin joints were detected in the source file.".to_string());
  }

  if resolved_rig_slot_count < 6 {
    notes.push("Only a small subset of canonical humanoid joints could be inferred from current node names.".to_string());
  }

  if !target_node_names.iter().any(|node| normalize_lookup_key(node).contains("hand")) {
    notes.push("No obvious hand targets were detected, which limits expressive prompt-driven arm motion.".to_string());
  }

  RigDiagnostics {
    mesh_count,
    primitive_count,
    material_count,
    skin_count,
    joint_count,
    named_node_count,
    targetable_node_count: target_node_names.len(),
    resolved_rig_slot_count,
    total_rig_slot_count,
    detected_humanoid_score,
    rig_status,
    rigging_needed,
    notes,
  }
}

fn fallback_rig_proposal(summary: &GlbSummary) -> RigProposal {
  let unresolved_slots = unresolved_rig_slots(&summary.rig_profile);
  let diagnostics = &summary.rig_diagnostics;
  let confidence = diagnostics.detected_humanoid_score.clamp(0.0, 1.0);
  let mut recommended_actions = Vec::new();
  let mut warnings = Vec::new();
  let readiness;
  let rationale;

  if diagnostics.rig_status == "rigged" {
    readiness = "ready".to_string();
    rationale = "The asset already looks rigged enough to support canonical targeting. Focus on refining joint naming and retargeting quality instead of generating a fresh skeleton.".to_string();
    recommended_actions.push("Use the inferred canonical joint profile as the targeting map for prompt generation.".to_string());
    recommended_actions.push("Review ambiguous or missing slots before exporting production animations.".to_string());
  } else if diagnostics.rig_status == "partial" {
    readiness = "needs-remap".to_string();
    rationale = "The asset has some rig structure, but it is incomplete or inconsistent. A rig proposal should preserve existing joints where possible and fill the missing canonical slots.".to_string();
    recommended_actions.push("Preserve existing skins and joints, then remap them onto the canonical humanoid profile.".to_string());
    recommended_actions.push("Generate proposals for unresolved slots before attempting motion export.".to_string());
    warnings.push("Partial rigs are prone to side-label mistakes and missing limb chains.".to_string());
  } else {
    readiness = "needs-rigging".to_string();
    rationale = "The asset does not appear to have a complete animation-ready rig. Generate a canonical humanoid skeleton proposal and require review before applying any binding changes.".to_string();
    recommended_actions.push("Infer a humanoid skeleton layout from mesh bounds, hierarchy, and naming hints.".to_string());
    recommended_actions.push("Create a non-destructive rig proposal before any skin binding is written back to disk.".to_string());
    warnings.push("This asset may need manual cleanup after any automated rigging pass.".to_string());
  }

  if diagnostics.skin_count == 0 {
    warnings.push("No existing skin was found, so downstream export will require new skinning data rather than simple retargeting.".to_string());
  }

  RigProposal {
    source: "fallback".to_string(),
    rigging_needed: diagnostics.rigging_needed,
    confidence,
    readiness,
    rationale,
    proposed_rig_profile: summary.rig_profile.clone(),
    unresolved_slots,
    recommended_actions,
    warnings,
  }
}

fn sanitize_rig_proposal(mut proposal: RigProposal, summary: &GlbSummary) -> RigProposal {
  proposal.confidence = proposal.confidence.clamp(0.0, 1.0);

  if proposal.source.trim().is_empty() {
    proposal.source = "fallback".to_string();
  }

  if proposal.readiness.trim().is_empty() {
    proposal.readiness = if summary.rig_diagnostics.rigging_needed {
      "needs-rigging".to_string()
    } else {
      "ready".to_string()
    };
  }

  if proposal.rationale.trim().is_empty() {
    proposal.rationale = "Generated a rigging readiness proposal from the current model summary.".to_string();
  }

  if proposal.recommended_actions.is_empty() {
    proposal.recommended_actions = fallback_rig_proposal(summary).recommended_actions;
  }

  if proposal.proposed_rig_profile == RigProfile::default() {
    proposal.proposed_rig_profile = summary.rig_profile.clone();
  }

  proposal.unresolved_slots = unresolved_rig_slots(&proposal.proposed_rig_profile);

  if proposal.warnings.is_empty() {
    proposal.warnings = fallback_rig_proposal(summary).warnings;
  }

  proposal.rigging_needed = proposal.rigging_needed || summary.rig_diagnostics.rigging_needed;
  proposal
}

fn find_matching_target_name(requested_name: &str, summary: &GlbSummary) -> Option<String> {
  if requested_name.trim().is_empty() {
    return None;
  }

  let candidates = if summary.target_node_names.is_empty() {
    &summary.node_names
  } else {
    &summary.target_node_names
  };

  let exact = candidates
    .iter()
    .find(|candidate| candidate.eq_ignore_ascii_case(requested_name))
    .cloned();

  if exact.is_some() {
    return exact;
  }

  let requested_key = normalize_lookup_key(requested_name);

  if requested_key.is_empty() {
    return None;
  }

  if let Some(candidate) = candidates
    .iter()
    .find(|candidate| normalize_lookup_key(candidate) == requested_key)
    .cloned()
  {
    return Some(candidate);
  }

  candidates
    .iter()
    .filter_map(|candidate| {
      let candidate_key = normalize_lookup_key(candidate);
      if candidate_key.contains(&requested_key) || requested_key.contains(&candidate_key) {
        return Some((candidate_key.len(), candidate.clone()));
      }
      None
    })
    .min_by_key(|(length, _)| *length)
    .map(|(_, candidate)| candidate)
}

fn pick_target(summary: &GlbSummary, keywords: &[&str]) -> Option<String> {
  let candidates = if summary.target_node_names.is_empty() {
    &summary.node_names
  } else {
    &summary.target_node_names
  };

  for keyword in keywords {
    let keyword_key = normalize_lookup_key(keyword);

    if let Some(candidate) = candidates
      .iter()
      .find(|candidate| normalize_lookup_key(candidate).contains(&keyword_key))
      .cloned()
    {
      return Some(candidate);
    }
  }

  None
}

fn primary_body_target(summary: &GlbSummary) -> Option<String> {
  summary
    .rig_profile
    .pelvis
    .clone()
    .or_else(|| summary.rig_profile.root.clone())
    .or_else(|| summary.rig_profile.spine.clone())
    .or_else(|| summary.rig_profile.chest.clone())
    .or_else(|| pick_target(summary, &["hips", "pelvis", "root", "spine", "chest"]))
}

fn head_target(summary: &GlbSummary) -> Option<String> {
  summary
    .rig_profile
    .head
    .clone()
    .or_else(|| summary.rig_profile.neck.clone())
    .or_else(|| summary.rig_profile.jaw.clone())
    .or_else(|| pick_target(summary, &["head", "neck", "jaw"]))
}

fn chest_target(summary: &GlbSummary) -> Option<String> {
  summary
    .rig_profile
    .chest
    .clone()
    .or_else(|| summary.rig_profile.spine.clone())
    .or_else(|| pick_target(summary, &["chest", "spine2", "spine1", "spine", "upperchest"]))
}

fn right_arm_target(summary: &GlbSummary) -> Option<String> {
  summary
    .rig_profile
    .right_hand
    .clone()
    .or_else(|| summary.rig_profile.right_forearm.clone())
    .or_else(|| summary.rig_profile.right_upper_arm.clone())
    .or_else(|| summary.rig_profile.right_shoulder.clone())
    .or_else(|| pick_target(summary, &["righthand", "rightforearm", "rightlowerarm", "rightarm", "hand_r", "arm_r"]))
}

fn left_arm_target(summary: &GlbSummary) -> Option<String> {
  summary
    .rig_profile
    .left_hand
    .clone()
    .or_else(|| summary.rig_profile.left_forearm.clone())
    .or_else(|| summary.rig_profile.left_upper_arm.clone())
    .or_else(|| summary.rig_profile.left_shoulder.clone())
    .or_else(|| pick_target(summary, &["lefthand", "leftforearm", "leftlowerarm", "leftarm", "hand_l", "arm_l"]))
}

fn normalize_binding(binding: &str) -> Option<String> {
  let lower = binding.trim().to_ascii_lowercase();

  if lower.is_empty() {
    return None;
  }

  let variants = [
    ("position", "x", ".position[x]"),
    ("position", "y", ".position[y]"),
    ("position", "z", ".position[z]"),
    ("rotation", "x", ".rotation[x]"),
    ("rotation", "y", ".rotation[y]"),
    ("rotation", "z", ".rotation[z]"),
    ("scale", "x", ".scale[x]"),
    ("scale", "y", ".scale[y]"),
    ("scale", "z", ".scale[z]"),
  ];

  for (property, axis, canonical) in variants {
    let compact_patterns = [
      format!(".{property}[{axis}]"),
      format!(".{property}.{axis}"),
      format!("{property}[{axis}]"),
      format!("{property}.{axis}"),
      format!("{property}{axis}"),
      format!("{property}_{axis}"),
      format!("{property}-{axis}"),
    ];

    if compact_patterns.iter().any(|pattern| lower == *pattern || lower.ends_with(pattern)) {
      return Some(canonical.to_string());
    }

    let path_patterns = [
      format!(".{property}[{axis}]"),
      format!(".{property}.{axis}"),
      format!("/{property}/{axis}"),
      format!("::{property}::{axis}"),
    ];

    if path_patterns.iter().any(|pattern| lower.contains(pattern)) {
      return Some(canonical.to_string());
    }
  }

  None
}

fn fallback_recipe(prompt: &str, summary: &GlbSummary) -> AnimationRecipe {
  let normalized = prompt.to_lowercase();
  let duration_seconds = if normalized.contains("slow") {
    6.0
  } else if normalized.contains("fast") || normalized.contains("snappy") {
    2.4
  } else {
    4.0
  };
  let torso_target = chest_target(summary).or_else(|| primary_body_target(summary));
  let head_target = head_target(summary);
  let right_arm_target = right_arm_target(summary);
  let left_arm_target = left_arm_target(summary);

  let mut tracks = vec![
    targeted_track(
      None,
      ".position[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.02),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, 0.02),
        (duration_seconds, 0.0),
      ],
    ),
    targeted_track(
      torso_target.clone(),
      ".rotation[x]",
      &[(0.0, 0.0), (duration_seconds * 0.5, 0.05), (duration_seconds, 0.0)],
    ),
    targeted_track(
      torso_target.clone(),
      ".rotation[z]",
      &[(0.0, 0.0), (duration_seconds * 0.25, 0.02), (duration_seconds * 0.75, -0.02), (duration_seconds, 0.0)],
    ),
  ];

  let mut rationale = "Generated a calm idle loop with subtle breathing and lift.".to_string();

  if normalized.contains("turn") || normalized.contains("spin") || normalized.contains("rotate") {
    tracks.push(targeted_track(
      head_target.clone().or_else(|| torso_target.clone()),
      ".rotation[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.5, std::f32::consts::PI * 0.18),
        (duration_seconds, std::f32::consts::PI * 0.3),
      ],
    ));
    rationale = "Added a head- or upper-body turn layered on top of an idle breathing motion.".to_string();
  }

  if normalized.contains("bounce") || normalized.contains("hop") || normalized.contains("jump") {
    tracks.push(targeted_track(
      primary_body_target(summary),
      ".position[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.18, 0.0),
        (duration_seconds * 0.34, 0.12),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Built a punchier vertical bounce and preserved a stable landing pose.".to_string();
  }

  if normalized.contains("sway") || normalized.contains("dance") || normalized.contains("groove") {
    tracks.push(targeted_track(
      torso_target.clone(),
      ".rotation[z]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.16),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, -0.16),
        (duration_seconds, 0.0),
      ],
    ));
    tracks.push(targeted_track(
      None,
      ".position[x]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.25, 0.04),
        (duration_seconds * 0.5, 0.0),
        (duration_seconds * 0.75, -0.04),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Added side-to-side sway and weight shift to match the prompt.".to_string();
  }

  if normalized.contains("nod") || normalized.contains("look down") || normalized.contains("bow") {
    tracks.push(targeted_track(
      head_target.clone().or_else(|| torso_target.clone()),
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

  if normalized.contains("look left") || normalized.contains("glance left") {
    tracks.push(targeted_track(
      head_target.clone().or_else(|| torso_target.clone()),
      ".rotation[y]",
      &[(0.0, 0.0), (duration_seconds * 0.45, 0.18), (duration_seconds, 0.0)],
    ));
  }

  if normalized.contains("look right") || normalized.contains("glance right") {
    tracks.push(targeted_track(
      head_target.clone().or_else(|| torso_target.clone()),
      ".rotation[y]",
      &[(0.0, 0.0), (duration_seconds * 0.45, -0.18), (duration_seconds, 0.0)],
    ));
  }

  if normalized.contains("laugh") || normalized.contains("chuckle") {
    tracks.push(targeted_track(
      head_target.clone().or_else(|| torso_target.clone()),
      ".rotation[z]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.18, 0.08),
        (duration_seconds * 0.36, -0.05),
        (duration_seconds * 0.54, 0.06),
        (duration_seconds, 0.0),
      ],
    ));
    tracks.push(targeted_track(
      None,
      ".position[y]",
      &[
        (0.0, 0.0),
        (duration_seconds * 0.22, 0.015),
        (duration_seconds * 0.44, 0.0),
        (duration_seconds * 0.66, 0.012),
        (duration_seconds, 0.0),
      ],
    ));
    rationale = "Added a small laugh bob through the upper torso and head to support the prompt.".to_string();
  }

  if normalized.contains("point") {
    let pointing_arm = if normalized.contains("left") {
      left_arm_target.clone().or_else(|| right_arm_target.clone())
    } else {
      right_arm_target.clone().or_else(|| left_arm_target.clone())
    };

    tracks.push(targeted_track(
      pointing_arm,
      ".rotation[z]",
      &[(0.0, 0.0), (duration_seconds * 0.35, -0.65), (duration_seconds, -0.55)],
    ));
    rationale = "Raised an arm target and combined it with upper-body motion to approximate a pointing pose.".to_string();
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

fn sanitize_recipe(mut recipe: AnimationRecipe, summary: &GlbSummary) -> AnimationRecipe {
  recipe.duration_seconds = recipe.duration_seconds.clamp(0.5, 12.0);
  recipe.tracks = recipe
    .tracks
    .into_iter()
    .filter_map(|mut track| {
      track.binding = normalize_binding(&track.binding)?;
      track.target_name = track
        .target_name
        .as_deref()
        .and_then(|requested_name| find_matching_target_name(requested_name, summary));

      if track.target_name.is_some() && !track.binding.starts_with(".rotation[") {
        return None;
      }

      if track.times.is_empty() || track.times.len() != track.values.len() {
        return None;
      }

      if track.binding.starts_with(".position[") {
        track.values = track
          .values
          .into_iter()
          .map(|value| value.clamp(-0.08, 0.08))
          .collect();
      }

      if track.binding.starts_with(".rotation[") {
        track.values = track
          .values
          .into_iter()
          .map(|value| value.clamp(-0.75, 0.75))
          .collect();
      }

      if track.binding.starts_with(".scale[") {
        track.values = track
          .values
          .into_iter()
          .map(|value| value.clamp(0.92, 1.08))
          .collect();
      }

      if track.interpolation.trim().is_empty() {
        track.interpolation = "smooth".to_string();
      }

      Some(track)
    })
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
        "content": "You generate concise loop-friendly animation recipes for 3D models. Return JSON only. Use only these bindings: .position[x], .position[y], .position[z], .rotation[x], .rotation[y], .rotation[z], .scale[x], .scale[y], .scale[z]. Each track may include an optional targetName using an exact node or bone name from the provided candidate list. Omit targetName to animate the root. Times and values arrays must be equal length. Prefer head, neck, chest, spine, shoulder, arm, forearm, hand, hips, pelvis, or jaw targets when the prompt implies local body motion."
      },
      {
        "role": "user",
        "content": format!(
          "Prompt: {prompt}\n\nModel summary: {}\n\nCandidate target node names: {}\n\nReturn an object with keys name, source, rationale, durationSeconds, looping, tracks. Each track must include binding, times, values, interpolation, and may include targetName. Keep duration under 12 seconds and use the exact targetName strings provided above when choosing local body motion.",
          serde_json::to_string(summary).map_err(|error| error.to_string())?
          , serde_json::to_string(&summary.target_node_names).map_err(|error| error.to_string())?
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

  let sanitized = sanitize_recipe(recipe, summary);

  if sanitized.tracks.is_empty() {
    let mut fallback = fallback_recipe(prompt, summary);
    fallback.source = "openai-fallback".to_string();
    fallback.rationale = "OpenAI returned a recipe, but its track bindings could not be mapped into the current viewer. Applied a local playable fallback instead.".to_string();
    return Ok(Some(fallback));
  }

  Ok(Some(sanitized))
}

async fn openai_rig_proposal(summary: &GlbSummary) -> Result<Option<RigProposal>, String> {
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
        "content": "You analyze 3D character assets for rigging readiness. Return JSON only. You never claim that rigging has been applied. Instead, return a cautious proposal with these keys: source, riggingNeeded, confidence, readiness, rationale, proposedRigProfile, unresolvedSlots, recommendedActions, warnings. proposedRigProfile must use the canonical keys root, pelvis, spine, chest, neck, head, jaw, leftShoulder, leftUpperArm, leftForearm, leftHand, rightShoulder, rightUpperArm, rightForearm, rightHand, leftThigh, leftCalf, leftFoot, rightThigh, rightCalf, rightFoot."
      },
      {
        "role": "user",
        "content": format!(
          "Model summary for rigging analysis: {}\n\nCurrent rig diagnostics: {}\n\nReturn a cautious rigging proposal. If the asset is already rigged enough for animation targeting, keep riggingNeeded false and explain why. If the asset needs rigging or remapping, keep the recommendation non-destructive and mention review steps.",
          serde_json::to_string(summary).map_err(|error| error.to_string())?,
          serde_json::to_string(&summary.rig_diagnostics).map_err(|error| error.to_string())?
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
    return Err(format!("OpenAI rig proposal request failed with status {}", response.status()));
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
    .ok_or_else(|| "OpenAI response did not contain JSON content for rig proposal.".to_string())?;

  let mut proposal = serde_json::from_str::<RigProposal>(content)
    .map_err(|error| format!("OpenAI returned invalid JSON for a rig proposal: {error}"))?;
  proposal.source = "openai".to_string();
  Ok(Some(sanitize_rig_proposal(proposal, summary)))
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
        .or_else(|| (index < 24).then(|| format!("Node {}", index + 1)))
    })
    .take(64)
    .collect::<Vec<_>>();
  let target_node_names = document
    .nodes()
    .filter_map(|node| node.name().map(str::to_string))
    .filter(|name| {
      let key = normalize_lookup_key(name);
      [
        "head", "neck", "jaw", "spine", "chest", "hip", "pelvis", "root", "shoulder", "arm",
        "forearm", "hand", "finger", "leg", "foot", "toe"
      ]
      .iter()
      .any(|keyword| key.contains(keyword))
    })
    .take(96)
    .collect::<Vec<_>>();
  let rig_profile = build_rig_profile(&node_names);
  let rig_diagnostics = build_rig_diagnostics(&document, &rig_profile, &target_node_names);
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
    target_node_names,
    rig_profile,
    rig_diagnostics,
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
    Ok(None) => Ok(fallback_recipe(&input.prompt, &input.summary)),
    Err(error) => {
      log::warn!("OpenAI animation generation failed, using fallback recipe: {error}");
      Ok(fallback_recipe(&input.prompt, &input.summary))
    }
  }
}

#[tauri::command]
async fn generate_rig_proposal(input: GenerateRigProposalInput) -> Result<RigProposal, String> {
  match openai_rig_proposal(&input.summary).await {
    Ok(Some(proposal)) => Ok(proposal),
    Ok(None) => Ok(fallback_rig_proposal(&input.summary)),
    Err(error) => {
      log::warn!("OpenAI rig proposal generation failed, using fallback proposal: {error}");
      Ok(fallback_rig_proposal(&input.summary))
    }
  }
}

#[tauri::command]
fn list_saved_animation_clips(app_handle: tauri::AppHandle) -> Result<Vec<SavedAnimationClip>, String> {
  read_saved_animation_clips(&app_handle)
}

#[tauri::command]
fn save_animation_clip(
  app_handle: tauri::AppHandle,
  input: SaveAnimationClipInput,
) -> Result<SavedAnimationClip, String> {
  let mut clips = read_saved_animation_clips(&app_handle)?;
  let saved_at_epoch_ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("System clock error while saving clip: {error}"))?
    .as_millis();

  let mut recipe = sanitize_recipe(input.recipe, &input.summary);

  if recipe.tracks.is_empty() {
    recipe = fallback_recipe(&input.prompt, &input.summary);
  }

  let saved_clip = SavedAnimationClip {
    id: format!("clip-{saved_at_epoch_ms}"),
    model_file_path: input.summary.file_path.clone(),
    model_file_name: input.summary.file_name.clone(),
    prompt: input.prompt,
    saved_at_epoch_ms,
    recipe,
  };

  clips.retain(|clip| clip.id != saved_clip.id);
  clips.insert(0, saved_clip.clone());
  write_saved_animation_clips(&app_handle, &clips)?;

  Ok(saved_clip)
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
    .invoke_handler(tauri::generate_handler![
      inspect_glb,
      read_glb_binary,
      generate_animation_recipe,
      generate_rig_proposal,
      list_saved_animation_clips,
      save_animation_clip,
      write_binary_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
