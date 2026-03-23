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
  detected_rig_family: String,
  family_confidence: f32,
  rig_status: String,
  rigging_needed: bool,
  notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigProposal {
  source: String,
  rig_family: String,
  canonical_slots: Vec<String>,
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
  geometry_analysis: Option<GeometryAnalysis>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigUpgradeChainPlan {
  name: String,
  slots: Vec<String>,
  existing_nodes: Vec<String>,
  action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigUpgradePlan {
  source: String,
  rig_family: String,
  canonical_slots: Vec<String>,
  readiness: String,
  confidence: f32,
  rationale: String,
  target_rig_type: String,
  apply_strategy: String,
  requires_weight_painting: bool,
  can_export_after_upgrade: bool,
  preserved_joint_slots: Vec<String>,
  new_joint_slots: Vec<String>,
  chain_plans: Vec<RigUpgradeChainPlan>,
  recommended_steps: Vec<String>,
  warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRigUpgradeInput {
  summary: GlbSummary,
  proposal: RigProposal,
  geometry_analysis: Option<GeometryAnalysis>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AxisPoint {
  x: f32,
  y: f32,
  z: f32,
  forward: Option<f32>,
  lateral: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionExtentSummary {
  back: Option<AxisPoint>,
  bottom: Option<AxisPoint>,
  centroid: Option<AxisPoint>,
  front: Option<AxisPoint>,
  left: Option<AxisPoint>,
  right: Option<AxisPoint>,
  top: Option<AxisPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeometryClues {
  candidate_rig_family: Option<String>,
  dominant_forward_axis: Option<String>,
  family_confidence: Option<f32>,
  family_scores: Option<std::collections::BTreeMap<String, f32>>,
  head_forward_bias: Option<f32>,
  horizontal_aspect_ratio: Option<f32>,
  lateral_symmetry: Option<f32>,
  low_mesh_ratio: Option<f32>,
  posture: Option<String>,
  width_to_height_ratio: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeometryAnalysis {
  geometry_clues: Option<GeometryClues>,
  mesh_count: Option<usize>,
  region_extents: Option<std::collections::BTreeMap<String, RegionExtentSummary>>,
  region_landmarks: Option<std::collections::BTreeMap<String, AxisPoint>>,
  skinned_mesh_count: Option<usize>,
  triangle_count: Option<u64>,
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

fn normalize_rig_family(value: &str) -> String {
  match value.trim().to_ascii_lowercase().as_str() {
    "humanoid" | "human" | "biped" => "humanoid".to_string(),
    "quadruped" | "canine" | "feline" | "equine" => "quadruped".to_string(),
    "arachnid" | "spider" | "insectoid" => "arachnid".to_string(),
    "prop" | "object" | "mechanical" => "prop".to_string(),
    "generic-creature" | "creature" | "beast" | "animal" => "generic-creature".to_string(),
    _ => "humanoid".to_string(),
  }
}

fn family_slot_specs(rig_family: &str) -> Vec<(&'static str, Vec<&'static str>)> {
  match normalize_rig_family(rig_family).as_str() {
    "quadruped" => vec![
      ("root", vec!["root", "armature", "origin"]),
      ("pelvis", vec!["pelvis", "hips", "hip", "hindquarters", "croup"]),
      ("spineLower", vec!["spine", "spinelower", "back", "lumbar"]),
      ("spineUpper", vec!["spineupper", "chest", "torso", "ribcage", "withers"]),
      ("neck", vec!["neck", "throat"]),
      ("head", vec!["head", "skull", "snout", "muzzle"]),
      ("jaw", vec!["jaw", "mouth", "chin"]),
      ("frontLeftShoulder", vec!["frontleftshoulder", "leftfrontshoulder", "lfshoulder", "leftscapula"]),
      ("frontLeftUpperLeg", vec!["frontleftleg", "leftfrontleg", "leftforeleg", "leftupperforeleg", "lfforeleg"]),
      ("frontLeftLowerLeg", vec!["frontleftlowerleg", "leftfrontlowerleg", "leftforearm", "leftlowerforeleg", "lfforearm"]),
      ("frontLeftFoot", vec!["frontleftfoot", "leftfrontfoot", "leftforepaw", "leftpaw", "lfpaw"]),
      ("frontRightShoulder", vec!["frontrightshoulder", "rightfrontshoulder", "rfshoulder", "rightscapula"]),
      ("frontRightUpperLeg", vec!["frontrightleg", "rightfrontleg", "rightforeleg", "rightupperforeleg", "rfforeleg"]),
      ("frontRightLowerLeg", vec!["frontrightlowerleg", "rightfrontlowerleg", "rightforearm", "rightlowerforeleg", "rfforearm"]),
      ("frontRightFoot", vec!["frontrightfoot", "rightfrontfoot", "rightforepaw", "rightpaw", "rfpaw"]),
      ("hindLeftHip", vec!["hindlefthip", "lefthip", "leftrearhip", "lefthaunch"]),
      ("hindLeftUpperLeg", vec!["hindleftleg", "lefthindleg", "leftrearleg", "leftthigh", "lrthigh"]),
      ("hindLeftLowerLeg", vec!["hindleftlowerleg", "lefthindlowerleg", "leftrearcalf", "leftcalf", "lrcalf"]),
      ("hindLeftFoot", vec!["hindleftfoot", "lefthindfoot", "leftrearfoot", "lefthindpaw", "lrpaw"]),
      ("hindRightHip", vec!["hindrighthip", "righthip", "rightrearhip", "righthaunch"]),
      ("hindRightUpperLeg", vec!["hindrightleg", "righthindleg", "rightrearleg", "rightthigh", "rrthigh"]),
      ("hindRightLowerLeg", vec!["hindrightlowerleg", "righthindlowerleg", "rightrearcalf", "rightcalf", "rrcalf"]),
      ("hindRightFoot", vec!["hindrightfoot", "righthindfoot", "rightrearfoot", "righthindpaw", "rrpaw"]),
      ("tailBase", vec!["tailbase", "tail", "tailroot"]),
      ("tailTip", vec!["tailtip", "tailend"]),
    ],
    "arachnid" => vec![
      ("root", vec!["root", "armature", "origin"]),
      ("abdomen", vec!["abdomen", "rearbody", "opisthosoma"]),
      ("thorax", vec!["thorax", "cephalothorax", "body", "midbody"]),
      ("head", vec!["head", "face", "mandible"]),
      ("frontLeftLegA", vec!["frontleftlega", "leftleg1", "leg1l", "l1"]),
      ("frontLeftLegB", vec!["frontleftlegb", "leftleg2", "leg2l", "l2"]),
      ("midLeftLegA", vec!["midleftlega", "leftleg3", "leg3l", "l3"]),
      ("midLeftLegB", vec!["midleftlegb", "leftleg4", "leg4l", "l4"]),
      ("frontRightLegA", vec!["frontrightlega", "rightleg1", "leg1r", "r1"]),
      ("frontRightLegB", vec!["frontrightlegb", "rightleg2", "leg2r", "r2"]),
      ("midRightLegA", vec!["midrightlega", "rightleg3", "leg3r", "r3"]),
      ("midRightLegB", vec!["midrightlegb", "rightleg4", "leg4r", "r4"]),
      ("rearLeftLegA", vec!["rearleftlega", "leftleg5", "leg5l", "l5"]),
      ("rearLeftLegB", vec!["rearleftlegb", "leftleg6", "leg6l", "l6"]),
      ("backLeftLegA", vec!["backleftlega", "leftleg7", "leg7l", "l7"]),
      ("backLeftLegB", vec!["backleftlegb", "leftleg8", "leg8l", "l8"]),
      ("rearRightLegA", vec!["rearrightlega", "rightleg5", "leg5r", "r5"]),
      ("rearRightLegB", vec!["rearrightlegb", "rightleg6", "leg6r", "r6"]),
      ("backRightLegA", vec!["backrightlega", "rightleg7", "leg7r", "r7"]),
      ("backRightLegB", vec!["backrightlegb", "rightleg8", "leg8r", "r8"]),
    ],
    "prop" => vec![
      ("root", vec!["root", "origin", "armature"]),
      ("body", vec!["body", "base", "core", "frame"]),
      ("pivot", vec!["pivot", "hinge", "joint", "mount", "wheel"]),
      ("tip", vec!["tip", "end", "lid", "door", "head"]),
    ],
    "generic-creature" => vec![
      ("root", vec!["root", "armature", "origin"]),
      ("body", vec!["body", "torso", "core", "spine"]),
      ("neck", vec!["neck", "throat"]),
      ("head", vec!["head", "skull", "snout", "face"]),
      ("frontLeftLimb", vec!["frontleftlimb", "leftfrontlimb", "leftarm", "leftforeleg"]),
      ("frontRightLimb", vec!["frontrightlimb", "rightfrontlimb", "rightarm", "rightforeleg"]),
      ("rearLeftLimb", vec!["rearleftlimb", "leftrearlimb", "leftleg", "lefthindleg"]),
      ("rearRightLimb", vec!["rearrightlimb", "rightrearlimb", "rightleg", "righthindleg"]),
      ("tailBase", vec!["tailbase", "tail", "tailroot"]),
      ("tailTip", vec!["tailtip", "tailend"]),
    ],
    _ => vec![
      ("root", vec!["root", "armature", "origin"]),
      ("pelvis", vec!["hips", "pelvis", "hip"]),
      ("spine", vec!["spine", "spine1", "spine01"]),
      ("chest", vec!["chest", "spine2", "spine02", "upperchest"]),
      ("neck", vec!["neck", "neck1"]),
      ("head", vec!["head", "headtop"]),
      ("jaw", vec!["jaw", "chin", "mouth"]),
      ("leftShoulder", vec!["leftshoulder", "shoulderl", "lshoulder", "claviclel"]),
      ("leftUpperArm", vec!["leftarm", "leftupperarm", "upperarml", "arml", "larm"]),
      ("leftForearm", vec!["leftforearm", "leftlowerarm", "forearml", "lowerarml", "lforearm"]),
      ("leftHand", vec!["lefthand", "handl", "lhand"]),
      ("rightShoulder", vec!["rightshoulder", "shoulderr", "rshoulder", "clavicler"]),
      ("rightUpperArm", vec!["rightarm", "rightupperarm", "upperarmr", "armr", "rarm"]),
      ("rightForearm", vec!["rightforearm", "rightlowerarm", "forearmr", "lowerarmr", "rforearm"]),
      ("rightHand", vec!["righthand", "handr", "rhand"]),
      ("leftThigh", vec!["leftupleg", "leftthigh", "uplegl", "thighl", "lthigh"]),
      ("leftCalf", vec!["leftleg", "leftcalf", "legl", "calfl", "lcalf"]),
      ("leftFoot", vec!["leftfoot", "footl", "lfoot"]),
      ("rightThigh", vec!["rightupleg", "rightthigh", "uplegr", "thighr", "rthigh"]),
      ("rightCalf", vec!["rightleg", "rightcalf", "legr", "calfr", "rcalf"]),
      ("rightFoot", vec!["rightfoot", "footr", "rfoot"]),
    ],
  }
}

fn canonical_slots_for_family(rig_family: &str) -> Vec<String> {
  family_slot_specs(rig_family)
    .into_iter()
    .map(|(slot_name, _)| slot_name.to_string())
    .collect()
}

fn family_chain_specs(rig_family: &str) -> Vec<(&'static str, Vec<&'static str>)> {
  match normalize_rig_family(rig_family).as_str() {
    "quadruped" => vec![
      ("Spine chain", vec!["root", "pelvis", "spineLower", "spineUpper", "neck", "head"]),
      ("Front left leg", vec!["frontLeftShoulder", "frontLeftUpperLeg", "frontLeftLowerLeg", "frontLeftFoot"]),
      ("Front right leg", vec!["frontRightShoulder", "frontRightUpperLeg", "frontRightLowerLeg", "frontRightFoot"]),
      ("Hind left leg", vec!["hindLeftHip", "hindLeftUpperLeg", "hindLeftLowerLeg", "hindLeftFoot"]),
      ("Hind right leg", vec!["hindRightHip", "hindRightUpperLeg", "hindRightLowerLeg", "hindRightFoot"]),
      ("Tail chain", vec!["tailBase", "tailTip"]),
    ],
    "arachnid" => vec![
      ("Body chain", vec!["root", "abdomen", "thorax", "head"]),
      ("Front left legs", vec!["frontLeftLegA", "frontLeftLegB"]),
      ("Front right legs", vec!["frontRightLegA", "frontRightLegB"]),
      ("Mid left legs", vec!["midLeftLegA", "midLeftLegB"]),
      ("Mid right legs", vec!["midRightLegA", "midRightLegB"]),
      ("Rear left legs", vec!["rearLeftLegA", "rearLeftLegB", "backLeftLegA", "backLeftLegB"]),
      ("Rear right legs", vec!["rearRightLegA", "rearRightLegB", "backRightLegA", "backRightLegB"]),
    ],
    "prop" => vec![("Control chain", vec!["root", "body", "pivot", "tip"])],
    "generic-creature" => vec![
      ("Body chain", vec!["root", "body", "neck", "head"]),
      ("Front limbs", vec!["frontLeftLimb", "frontRightLimb"]),
      ("Rear limbs", vec!["rearLeftLimb", "rearRightLimb"]),
      ("Tail chain", vec!["tailBase", "tailTip"]),
    ],
    _ => vec![
      ("Spine chain", vec!["root", "pelvis", "spine", "chest", "neck", "head"]),
      ("Left arm chain", vec!["leftShoulder", "leftUpperArm", "leftForearm", "leftHand"]),
      ("Right arm chain", vec!["rightShoulder", "rightUpperArm", "rightForearm", "rightHand"]),
      ("Left leg chain", vec!["leftThigh", "leftCalf", "leftFoot"]),
      ("Right leg chain", vec!["rightThigh", "rightCalf", "rightFoot"]),
    ],
  }
}

fn family_detection_keyword_map() -> Vec<(&'static str, Vec<&'static str>)> {
  vec![
    (
      "humanoid",
      vec!["head", "neck", "shoulder", "arm", "forearm", "hand", "finger", "pelvis", "spine", "thigh", "calf", "foot"],
    ),
    (
      "quadruped",
      vec!["wolf", "dog", "canine", "cat", "feline", "horse", "quadruped", "paw", "snout", "muzzle", "tail", "foreleg", "hindleg", "haunch", "withers"],
    ),
    (
      "arachnid",
      vec!["spider", "arach", "abdomen", "thorax", "cephalothorax", "mandible", "pedipalp", "spinneret", "leg1", "leg2", "leg3", "leg4"],
    ),
    (
      "prop",
      vec!["prop", "object", "door", "lid", "hinge", "wheel", "axle", "turret", "handle", "mount", "panel"],
    ),
  ]
}

fn detect_rig_family(
  file_name: &str,
  node_names: &[String],
  target_node_names: &[String],
  mesh_count: usize,
  joint_count: usize,
) -> (String, f32) {
  let mut corpus = vec![file_name.to_string()];
  corpus.extend(node_names.iter().cloned());
  corpus.extend(target_node_names.iter().cloned());

  let normalized_corpus = corpus
    .iter()
    .map(|value| normalize_lookup_key(value))
    .collect::<Vec<_>>();
  let mut scored_families = family_detection_keyword_map()
    .into_iter()
    .map(|(family, keywords)| {
      let score = keywords
        .into_iter()
        .map(|keyword| {
          let normalized_keyword = normalize_lookup_key(keyword);
          normalized_corpus
            .iter()
            .filter(|candidate| candidate.contains(&normalized_keyword))
            .count() as f32
        })
        .sum::<f32>();
      (family.to_string(), score)
    })
    .collect::<Vec<_>>();

  let leg_index_hits = normalized_corpus
    .iter()
    .filter(|candidate| (1..=8).any(|index| candidate.contains(&format!("leg{index}"))))
    .count() as f32;
  if let Some((_, score)) = scored_families.iter_mut().find(|(family, _)| family == "arachnid") {
    *score += leg_index_hits * 0.8;
  }

  if let Some((_, score)) = scored_families.iter_mut().find(|(family, _)| family == "quadruped") {
    if normalized_corpus.iter().any(|candidate| candidate.contains("paw") || candidate.contains("tail")) {
      *score += 1.5;
    }
  }

  if let Some((_, score)) = scored_families.iter_mut().find(|(family, _)| family == "humanoid") {
    if joint_count >= 12 {
      *score += 2.0;
    }
  }

  scored_families.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(std::cmp::Ordering::Equal));
  let (best_family, best_score) = scored_families
    .first()
    .cloned()
    .unwrap_or_else(|| ("humanoid".to_string(), 0.0));

  if best_score < 1.2 {
    if mesh_count > 0 && joint_count == 0 && target_node_names.len() < 4 {
      return ("prop".to_string(), 0.42);
    }

    return ("generic-creature".to_string(), 0.35);
  }

  let confidence = (best_score / 7.5).clamp(0.35, 0.98);
  (best_family, confidence)
}

fn geometry_guided_rig_family(
  summary: &GlbSummary,
  geometry_analysis: Option<&GeometryAnalysis>,
  fallback_family: &str,
) -> (String, f32) {
  let normalized_fallback = normalize_rig_family(fallback_family);
  let summary_confidence = summary.rig_diagnostics.family_confidence.clamp(0.0, 1.0);

  let Some(geometry_clues) = geometry_analysis.and_then(|analysis| analysis.geometry_clues.as_ref()) else {
    return (normalized_fallback, summary_confidence);
  };

  let geometry_family = normalize_rig_family(
    geometry_clues
      .candidate_rig_family
      .as_deref()
      .unwrap_or(&normalized_fallback),
  );
  let geometry_confidence = geometry_clues.family_confidence.unwrap_or(summary_confidence).clamp(0.0, 1.0);

  if geometry_confidence >= summary_confidence + 0.08 || (summary_confidence < 0.45 && geometry_confidence >= 0.5) {
    return (geometry_family, geometry_confidence);
  }

  (normalized_fallback, summary_confidence.max(geometry_confidence))
}

fn geometry_note(geometry_analysis: Option<&GeometryAnalysis>, rig_family: &str) -> Option<String> {
  let geometry_clues = geometry_analysis?.geometry_clues.as_ref()?;
  let posture = geometry_clues.posture.clone().unwrap_or_else(|| "measured".to_string());
  let confidence = geometry_clues.family_confidence.unwrap_or(0.0).clamp(0.0, 1.0);
  Some(format!(
    "Geometry analysis suggests a {} {} body plan ({:.0}% confidence).",
    posture,
    rig_family.replace('-', " "),
    confidence * 100.0
  ))
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

fn family_slot_value(summary: &GlbSummary, rig_family: &str, slot_name: &str) -> Option<String> {
  if normalize_rig_family(rig_family) == "humanoid" {
    return rig_slot_value(&summary.rig_profile, slot_name);
  }

  let mut candidates = summary.node_names.clone();
  candidates.extend(summary.target_node_names.iter().cloned());

  family_slot_specs(rig_family)
    .into_iter()
    .find(|(candidate_slot_name, _)| *candidate_slot_name == slot_name)
    .and_then(|(_, keywords)| find_profile_node(&candidates, &keywords))
}

fn resolved_family_slots(summary: &GlbSummary, rig_family: &str) -> Vec<String> {
  canonical_slots_for_family(rig_family)
    .into_iter()
    .filter(|slot_name| family_slot_value(summary, rig_family, slot_name).is_some())
    .collect()
}

fn unresolved_family_slots(summary: &GlbSummary, rig_family: &str) -> Vec<String> {
  canonical_slots_for_family(rig_family)
    .into_iter()
    .filter(|slot_name| family_slot_value(summary, rig_family, slot_name).is_none())
    .collect()
}

fn rig_slot_value(rig_profile: &RigProfile, slot_name: &str) -> Option<String> {
  match slot_name {
    "root" => rig_profile.root.clone(),
    "pelvis" => rig_profile.pelvis.clone(),
    "spine" => rig_profile.spine.clone(),
    "chest" => rig_profile.chest.clone(),
    "neck" => rig_profile.neck.clone(),
    "head" => rig_profile.head.clone(),
    "jaw" => rig_profile.jaw.clone(),
    "leftShoulder" => rig_profile.left_shoulder.clone(),
    "leftUpperArm" => rig_profile.left_upper_arm.clone(),
    "leftForearm" => rig_profile.left_forearm.clone(),
    "leftHand" => rig_profile.left_hand.clone(),
    "rightShoulder" => rig_profile.right_shoulder.clone(),
    "rightUpperArm" => rig_profile.right_upper_arm.clone(),
    "rightForearm" => rig_profile.right_forearm.clone(),
    "rightHand" => rig_profile.right_hand.clone(),
    "leftThigh" => rig_profile.left_thigh.clone(),
    "leftCalf" => rig_profile.left_calf.clone(),
    "leftFoot" => rig_profile.left_foot.clone(),
    "rightThigh" => rig_profile.right_thigh.clone(),
    "rightCalf" => rig_profile.right_calf.clone(),
    "rightFoot" => rig_profile.right_foot.clone(),
    _ => None,
  }
}

fn build_family_chain_plan(name: &str, slots: &[&str], summary: &GlbSummary, rig_family: &str, action: &str) -> RigUpgradeChainPlan {
  RigUpgradeChainPlan {
    name: name.to_string(),
    slots: slots.iter().map(|slot| slot.to_string()).collect(),
    existing_nodes: slots
      .iter()
      .filter_map(|slot| family_slot_value(summary, rig_family, slot))
      .collect(),
    action: action.to_string(),
  }
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

fn build_rig_diagnostics(
  document: &gltf::Gltf,
  file_name: &str,
  node_names: &[String],
  rig_profile: &RigProfile,
  target_node_names: &[String],
) -> RigDiagnostics {
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
  let (detected_rig_family, family_confidence) =
    detect_rig_family(file_name, node_names, target_node_names, mesh_count, joint_count);

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

  if detected_rig_family != "humanoid" {
    notes.push(format!(
      "Detected this asset as a {} candidate. Family-aware proposal and upgrade planning should preserve that form instead of forcing a humanoid skeleton.",
      detected_rig_family.replace('-', " ")
    ));
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
    detected_rig_family,
    family_confidence,
    rig_status,
    rigging_needed,
    notes,
  }
}

fn fallback_rig_proposal(summary: &GlbSummary, geometry_analysis: Option<&GeometryAnalysis>) -> RigProposal {
  let (rig_family, family_confidence) = geometry_guided_rig_family(
    summary,
    geometry_analysis,
    &summary.rig_diagnostics.detected_rig_family,
  );
  let canonical_slots = canonical_slots_for_family(&rig_family);
  let unresolved_slots = unresolved_family_slots(summary, &rig_family);
  let diagnostics = &summary.rig_diagnostics;
  let confidence = family_confidence
    .max(diagnostics.detected_humanoid_score)
    .clamp(0.0, 1.0);
  let mut recommended_actions = Vec::new();
  let mut warnings = Vec::new();
  let readiness;
  let rationale;

  if diagnostics.rig_status == "rigged" {
    readiness = "ready".to_string();
    rationale = format!(
      "The asset already looks rigged enough to support {} targeting. Focus on refining joint naming and retargeting quality instead of generating a fresh skeleton.",
      rig_family.replace('-', " ")
    );
    recommended_actions.push(format!(
      "Use the inferred {} joint family as the targeting map for prompt generation.",
      rig_family.replace('-', " ")
    ));
    recommended_actions.push("Review ambiguous or missing slots before exporting production animations.".to_string());
  } else if diagnostics.rig_status == "partial" {
    readiness = "needs-remap".to_string();
    rationale = format!(
      "The asset has some rig structure, but it is incomplete or inconsistent. A rig proposal should preserve existing joints where possible and fill the missing canonical {} slots.",
      rig_family.replace('-', " ")
    );
    recommended_actions.push(format!(
      "Preserve existing skins and joints, then remap them onto the canonical {} profile.",
      rig_family.replace('-', " ")
    ));
    recommended_actions.push("Generate proposals for unresolved slots before attempting motion export.".to_string());
    warnings.push("Partial rigs are prone to side-label mistakes and missing limb chains.".to_string());
  } else {
    readiness = "needs-rigging".to_string();
    rationale = format!(
      "The asset does not appear to have a complete animation-ready rig. Generate a canonical {} skeleton proposal and require review before applying any binding changes.",
      rig_family.replace('-', " ")
    );
    recommended_actions.push(format!(
      "Infer a {} skeleton layout from mesh bounds, hierarchy, and naming hints.",
      rig_family.replace('-', " ")
    ));
    recommended_actions.push("Create a non-destructive rig proposal before any skin binding is written back to disk.".to_string());
    warnings.push("This asset may need manual cleanup after any automated rigging pass.".to_string());
  }

  if diagnostics.skin_count == 0 {
    warnings.push("No existing skin was found, so downstream export will require new skinning data rather than simple retargeting.".to_string());
  }

  if let Some(note) = geometry_note(geometry_analysis, &rig_family) {
    warnings.push(note.clone());
  }

  RigProposal {
    source: "fallback".to_string(),
    rig_family,
    canonical_slots,
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

fn sanitize_rig_proposal(
  mut proposal: RigProposal,
  summary: &GlbSummary,
  geometry_analysis: Option<&GeometryAnalysis>,
) -> RigProposal {
  let (guided_family, geometry_confidence) = geometry_guided_rig_family(
    summary,
    geometry_analysis,
    if proposal.rig_family.trim().is_empty() {
      &summary.rig_diagnostics.detected_rig_family
    } else {
      &proposal.rig_family
    },
  );
  proposal.rig_family = normalize_rig_family(if proposal.rig_family.trim().is_empty() {
    &guided_family
  } else {
    &proposal.rig_family
  });
  proposal.confidence = proposal.confidence.max(geometry_confidence).clamp(0.0, 1.0);

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
    proposal.recommended_actions = fallback_rig_proposal(summary, geometry_analysis).recommended_actions;
  }

  if proposal.proposed_rig_profile == RigProfile::default() {
    proposal.proposed_rig_profile = summary.rig_profile.clone();
  }

  if proposal.canonical_slots.is_empty() {
    proposal.canonical_slots = canonical_slots_for_family(&proposal.rig_family);
  }

  proposal.unresolved_slots = unresolved_family_slots(summary, &proposal.rig_family);

  if proposal.warnings.is_empty() {
    proposal.warnings = fallback_rig_proposal(summary, geometry_analysis).warnings;
  } else if let Some(note) = geometry_note(geometry_analysis, &proposal.rig_family) {
    if !proposal.warnings.iter().any(|warning| warning == &note) {
      proposal.warnings.push(note);
    }
  }

  proposal.rigging_needed = proposal.rigging_needed || summary.rig_diagnostics.rigging_needed;
  proposal
}

fn fallback_rig_upgrade_plan(
  summary: &GlbSummary,
  proposal: &RigProposal,
  geometry_analysis: Option<&GeometryAnalysis>,
) -> RigUpgradePlan {
  let diagnostics = &summary.rig_diagnostics;
  let (rig_family, geometry_confidence) = geometry_guided_rig_family(summary, geometry_analysis, &proposal.rig_family);
  let canonical_slots = if proposal.canonical_slots.is_empty() {
    canonical_slots_for_family(&rig_family)
  } else {
    proposal.canonical_slots.clone()
  };
  let preserved_joint_slots = resolved_family_slots(summary, &rig_family);
  let new_joint_slots = unresolved_family_slots(summary, &rig_family);
  let (readiness, apply_strategy, rationale, requires_weight_painting, can_export_after_upgrade) =
    if diagnostics.rig_status == "rigged" && !proposal.rigging_needed {
      (
        "ready-for-retargeting".to_string(),
        "preserve-and-remap".to_string(),
        format!(
          "The asset already contains enough rig structure to focus on {} joint remapping and canonical targeting instead of building a new skeleton from scratch.",
          rig_family.replace('-', " ")
        ),
        false,
        true,
      )
    } else if diagnostics.rig_status == "partial" {
      (
        "needs-hybrid-upgrade".to_string(),
        "hybrid-remap-and-add".to_string(),
        format!(
          "The asset has partial rig data. Preserve usable joints, add missing canonical {} chains, then review skin assignment for the new joints before export.",
          rig_family.replace('-', " ")
        ),
        true,
        true,
      )
    } else {
      (
        "needs-full-rigging".to_string(),
        "generate-canonical-skeleton".to_string(),
        format!(
          "The asset does not appear to be animation-ready. Create a canonical {} skeleton, bind the mesh non-destructively, then validate the result before downstream export.",
          rig_family.replace('-', " ")
        ),
        true,
        true,
      )
    };

  let chain_action = match apply_strategy.as_str() {
    "preserve-and-remap" => "preserve",
    "hybrid-remap-and-add" => "hybrid",
    _ => "create",
  };

  let mut recommended_steps = vec![
    "Review the proposed canonical slots and confirm side labeling before applying any rig changes.".to_string(),
    "Create a derived asset for rig upgrades instead of overwriting the source GLB.".to_string(),
  ];

  if requires_weight_painting {
    recommended_steps.push("Generate or refine skin weights for any newly added joints before exporting a reusable rigged asset.".to_string());
  } else {
    recommended_steps.push("Retarget prompt-driven animation against the preserved canonical joints and validate exported clips.".to_string());
  }

  let mut warnings = proposal.warnings.clone();
  if requires_weight_painting {
    warnings.push("This upgrade path still needs a future mesh-binding phase before the asset can be considered fully auto-rigged.".to_string());
  }

  if let Some(note) = geometry_note(geometry_analysis, &rig_family) {
    warnings.push(note);
  }

  RigUpgradePlan {
    source: "fallback".to_string(),
    rig_family: rig_family.clone(),
    canonical_slots,
    readiness,
    confidence: proposal.confidence.max(geometry_confidence).clamp(0.0, 1.0),
    rationale,
    target_rig_type: format!("canonical-{rig_family}"),
    apply_strategy,
    requires_weight_painting,
    can_export_after_upgrade,
    preserved_joint_slots,
    new_joint_slots,
    chain_plans: family_chain_specs(&rig_family)
      .into_iter()
      .map(|(name, slots)| build_family_chain_plan(name, &slots, summary, &rig_family, chain_action))
      .collect(),
    recommended_steps,
    warnings,
  }
}

fn sanitize_rig_upgrade_plan(
  mut plan: RigUpgradePlan,
  summary: &GlbSummary,
  proposal: &RigProposal,
  geometry_analysis: Option<&GeometryAnalysis>,
) -> RigUpgradePlan {
  let (guided_family, geometry_confidence) = geometry_guided_rig_family(
    summary,
    geometry_analysis,
    if plan.rig_family.trim().is_empty() {
      &proposal.rig_family
    } else {
      &plan.rig_family
    },
  );
  plan.rig_family = normalize_rig_family(if plan.rig_family.trim().is_empty() {
    &guided_family
  } else {
    &plan.rig_family
  });
  plan.confidence = plan.confidence.max(geometry_confidence).clamp(0.0, 1.0);

  if plan.source.trim().is_empty() {
    plan.source = "fallback".to_string();
  }

  if plan.target_rig_type.trim().is_empty() {
    plan.target_rig_type = format!("canonical-{}", plan.rig_family);
  }

  if plan.apply_strategy.trim().is_empty() {
    plan.apply_strategy = fallback_rig_upgrade_plan(summary, proposal, geometry_analysis).apply_strategy;
  }

  if plan.rationale.trim().is_empty() {
    plan.rationale = "Generated a rig upgrade plan from the current proposal and diagnostics.".to_string();
  }

  if plan.chain_plans.is_empty() {
    plan.chain_plans = fallback_rig_upgrade_plan(summary, proposal, geometry_analysis).chain_plans;
  }

  if plan.canonical_slots.is_empty() {
    plan.canonical_slots = canonical_slots_for_family(&plan.rig_family);
  }

  if plan.preserved_joint_slots.is_empty() {
    plan.preserved_joint_slots = resolved_family_slots(summary, &plan.rig_family);
  }

  if plan.new_joint_slots.is_empty() {
    plan.new_joint_slots = unresolved_family_slots(summary, &plan.rig_family);
  }

  if plan.recommended_steps.is_empty() {
    plan.recommended_steps = fallback_rig_upgrade_plan(summary, proposal, geometry_analysis).recommended_steps;
  }

  if let Some(note) = geometry_note(geometry_analysis, &plan.rig_family) {
    if !plan.warnings.iter().any(|warning| warning == &note) {
      plan.warnings.push(note);
    }
  }

  plan
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

async fn openai_rig_proposal(
  summary: &GlbSummary,
  geometry_analysis: Option<&GeometryAnalysis>,
) -> Result<Option<RigProposal>, String> {
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
        "content": "You analyze 3D assets for rigging readiness. Return JSON only. You never claim that rigging has been applied. Instead, return a cautious proposal with these keys: source, rigFamily, canonicalSlots, riggingNeeded, confidence, readiness, rationale, proposedRigProfile, unresolvedSlots, recommendedActions, warnings. Respect the detected rig family in the summary. Never convert quadruped, arachnid, generic-creature, or prop assets into humanoids unless the evidence is overwhelming. proposedRigProfile may remain sparse for non-humanoid families."
      },
      {
        "role": "user",
        "content": format!(
          "Model summary for rigging analysis: {}\n\nCurrent rig diagnostics: {}\n\nGeometry analysis: {}\n\nReturn a cautious rigging proposal that preserves the detected family shape. If the asset is already rigged enough for animation targeting, keep riggingNeeded false and explain why. If the asset needs rigging or remapping, keep the recommendation non-destructive and mention review steps. The canonicalSlots field should match the target family rather than defaulting to humanoid slots. Treat geometry clues as authoritative when naming is weak or misleading.",
          serde_json::to_string(summary).map_err(|error| error.to_string())?,
          serde_json::to_string(&summary.rig_diagnostics).map_err(|error| error.to_string())?,
          serde_json::to_string(&geometry_analysis).map_err(|error| error.to_string())?
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
  Ok(Some(sanitize_rig_proposal(proposal, summary, geometry_analysis)))
}

async fn openai_rig_upgrade_plan(
  summary: &GlbSummary,
  proposal: &RigProposal,
  geometry_analysis: Option<&GeometryAnalysis>,
) -> Result<Option<RigUpgradePlan>, String> {
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
        "content": "You plan cautious rig upgrades for 3D assets. Return JSON only. Never claim that weights or rigging have already been applied. Return these keys: source, rigFamily, canonicalSlots, readiness, confidence, rationale, targetRigType, applyStrategy, requiresWeightPainting, canExportAfterUpgrade, preservedJointSlots, newJointSlots, chainPlans, recommendedSteps, warnings. Each chainPlans item must include name, slots, existingNodes, action. Respect the requested rig family and never humanoidize quadruped, arachnid, prop, or generic-creature assets."
      },
      {
        "role": "user",
        "content": format!(
          "Model summary: {}\n\nRig proposal: {}\n\nGeometry analysis: {}\n\nBuild a non-destructive rig upgrade plan that preserves the asset's detected family. Prefer preserving existing rig structure when it exists. If the asset is unrigged, plan for canonical family-appropriate skeleton creation plus later weight generation. targetRigType should be family-specific, for example canonical-quadruped or canonical-arachnid when appropriate. Use the geometry analysis to disambiguate family choice, body orientation, and limb layout when naming is sparse.",
          serde_json::to_string(summary).map_err(|error| error.to_string())?,
          serde_json::to_string(proposal).map_err(|error| error.to_string())?,
          serde_json::to_string(&geometry_analysis).map_err(|error| error.to_string())?
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
    return Err(format!("OpenAI rig upgrade request failed with status {}", response.status()));
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
    .ok_or_else(|| "OpenAI response did not contain JSON content for a rig upgrade plan.".to_string())?;

  let mut plan = serde_json::from_str::<RigUpgradePlan>(content)
    .map_err(|error| format!("OpenAI returned invalid JSON for a rig upgrade plan: {error}"))?;
  plan.source = "openai".to_string();
  Ok(Some(sanitize_rig_upgrade_plan(plan, summary, proposal, geometry_analysis)))
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

  let file_name = canonical_path
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("Unnamed model")
    .to_string();
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
        "forearm", "hand", "finger", "leg", "foot", "toe", "tail", "paw", "snout", "muzzle",
        "foreleg", "hindleg", "thorax", "abdomen", "mandible", "hinge", "wheel", "door", "lid"
      ]
      .iter()
      .any(|keyword| key.contains(keyword))
    })
    .take(96)
    .collect::<Vec<_>>();
  let rig_profile = build_rig_profile(&node_names);
  let rig_diagnostics = build_rig_diagnostics(&document, &file_name, &node_names, &rig_profile, &target_node_names);
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
    file_name,
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
  match openai_rig_proposal(&input.summary, input.geometry_analysis.as_ref()).await {
    Ok(Some(proposal)) => Ok(proposal),
    Ok(None) => Ok(fallback_rig_proposal(&input.summary, input.geometry_analysis.as_ref())),
    Err(error) => {
      log::warn!("OpenAI rig proposal generation failed, using fallback proposal: {error}");
      Ok(fallback_rig_proposal(&input.summary, input.geometry_analysis.as_ref()))
    }
  }
}

#[tauri::command]
async fn generate_rig_upgrade_plan(input: GenerateRigUpgradeInput) -> Result<RigUpgradePlan, String> {
  match openai_rig_upgrade_plan(&input.summary, &input.proposal, input.geometry_analysis.as_ref()).await {
    Ok(Some(plan)) => Ok(plan),
    Ok(None) => Ok(fallback_rig_upgrade_plan(&input.summary, &input.proposal, input.geometry_analysis.as_ref())),
    Err(error) => {
      log::warn!("OpenAI rig upgrade generation failed, using fallback plan: {error}");
      Ok(fallback_rig_upgrade_plan(&input.summary, &input.proposal, input.geometry_analysis.as_ref()))
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
      generate_rig_upgrade_plan,
      list_saved_animation_clips,
      save_animation_clip,
      write_binary_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
