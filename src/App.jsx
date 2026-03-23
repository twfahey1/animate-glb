import { startTransition, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import ModelViewport from './components/ModelViewport.jsx'
import './App.css'

const DEFAULT_PROMPT =
  'Create a confident idle animation with subtle breathing, a gentle torso sway, and a slow turn.'

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / 1024 ** exponent

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function sourceLabel(source) {
  if (source === 'openai') {
    return 'OpenAI recipe'
  }

  if (source === 'openai-fallback') {
    return 'OpenAI fallback recipe'
  }

  if (source === 'browser') {
    return 'Browser fallback recipe'
  }

  return 'Local heuristic recipe'
}

function listPreview(values, emptyLabel) {
  if (!values?.length) {
    return emptyLabel
  }

  return values.slice(0, 4).join(', ')
}

function isSupportedModelFile(fileName) {
  return /\.(glb|gltf)$/i.test(fileName)
}

function buildBrowserSummary(file) {
  return {
    filePath: file.name,
    fileName: file.name,
    sizeBytes: file.size,
    sceneCount: 0,
    nodeCount: 0,
    animationCount: 0,
    sceneNames: [],
    nodeNames: [],
    targetNodeNames: [],
    rigProfile: {},
    rigDiagnostics: {
      meshCount: 0,
      primitiveCount: 0,
      materialCount: 0,
      skinCount: 0,
      jointCount: 0,
      namedNodeCount: 0,
      targetableNodeCount: 0,
      resolvedRigSlotCount: 0,
      totalRigSlotCount: 21,
      detectedHumanoidScore: 0,
      detectedRigFamily: 'humanoid',
      familyConfidence: 0,
      rigStatus: 'unknown',
      riggingNeeded: true,
      notes: ['Browser mode does not run Rust-side rig diagnostics.'],
    },
    animationNames: [],
  }
}

function baseModelFilePath(filePath) {
  return String(filePath || '').split('#')[0]
}

function modelFileMatches(leftFilePath, rightFilePath) {
  return baseModelFilePath(leftFilePath) === baseModelFilePath(rightFilePath)
}

function visibleItems(items, isExpanded, previewCount = 12) {
  if (!items?.length) {
    return []
  }

  return isExpanded ? items : items.slice(0, previewCount)
}

function rigProfileEntries(rigProfile) {
  if (!rigProfile) {
    return []
  }

  return Object.entries(rigProfile).filter(([, value]) => Boolean(value))
}

function formatRigSlot(slotName) {
  return slotName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
}

function normalizeRigFamily(rigFamily) {
  if (!rigFamily) {
    return 'humanoid'
  }

  const normalized = String(rigFamily).trim().toLowerCase()

  if (['humanoid', 'human', 'biped'].includes(normalized)) {
    return 'humanoid'
  }

  if (['quadruped', 'canine', 'feline', 'equine'].includes(normalized)) {
    return 'quadruped'
  }

  if (['avian', 'bird', 'raptor', 'eagle', 'hawk', 'owl'].includes(normalized)) {
    return 'avian'
  }

  if (['arachnid', 'spider', 'insectoid'].includes(normalized)) {
    return 'arachnid'
  }

  if (['prop', 'object', 'mechanical'].includes(normalized)) {
    return 'prop'
  }

  if (['generic-creature', 'creature', 'animal', 'beast'].includes(normalized)) {
    return 'generic-creature'
  }

  return 'humanoid'
}

function formatRigFamily(rigFamily) {
  return normalizeRigFamily(rigFamily)
    .replace(/-/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

function canonicalSlotsForFamily(rigFamily) {
  switch (normalizeRigFamily(rigFamily)) {
    case 'avian':
      return [
        'root',
        'pelvis',
        'spineLower',
        'spineUpper',
        'neck',
        'head',
        'beak',
        'leftWingShoulder',
        'leftWingUpper',
        'leftWingLower',
        'leftWingTip',
        'rightWingShoulder',
        'rightWingUpper',
        'rightWingLower',
        'rightWingTip',
        'leftLegUpper',
        'leftLegLower',
        'leftFoot',
        'rightLegUpper',
        'rightLegLower',
        'rightFoot',
        'tailBase',
        'tailTip',
      ]
    case 'quadruped':
      return [
        'root',
        'pelvis',
        'spineLower',
        'spineUpper',
        'neck',
        'head',
        'jaw',
        'frontLeftShoulder',
        'frontLeftUpperLeg',
        'frontLeftLowerLeg',
        'frontLeftFoot',
        'frontRightShoulder',
        'frontRightUpperLeg',
        'frontRightLowerLeg',
        'frontRightFoot',
        'hindLeftHip',
        'hindLeftUpperLeg',
        'hindLeftLowerLeg',
        'hindLeftFoot',
        'hindRightHip',
        'hindRightUpperLeg',
        'hindRightLowerLeg',
        'hindRightFoot',
        'tailBase',
        'tailTip',
      ]
    case 'arachnid':
      return [
        'root',
        'abdomen',
        'thorax',
        'head',
        'frontLeftLegA',
        'frontLeftLegB',
        'midLeftLegA',
        'midLeftLegB',
        'frontRightLegA',
        'frontRightLegB',
        'midRightLegA',
        'midRightLegB',
        'rearLeftLegA',
        'rearLeftLegB',
        'backLeftLegA',
        'backLeftLegB',
        'rearRightLegA',
        'rearRightLegB',
        'backRightLegA',
        'backRightLegB',
      ]
    case 'prop':
      return ['root', 'body', 'pivot', 'tip']
    case 'generic-creature':
      return [
        'root',
        'body',
        'neck',
        'head',
        'frontLeftLimb',
        'frontRightLimb',
        'rearLeftLimb',
        'rearRightLimb',
        'tailBase',
        'tailTip',
      ]
    default:
      return [
        'root',
        'pelvis',
        'spine',
        'chest',
        'neck',
        'head',
        'jaw',
        'leftShoulder',
        'leftUpperArm',
        'leftForearm',
        'leftHand',
        'rightShoulder',
        'rightUpperArm',
        'rightForearm',
        'rightHand',
        'leftThigh',
        'leftCalf',
        'leftFoot',
        'rightThigh',
        'rightCalf',
        'rightFoot',
      ]
  }
}

function familyChainPlans(rigFamily, action = 'create') {
  switch (normalizeRigFamily(rigFamily)) {
    case 'avian':
      return [
        ['Spine chain', ['root', 'pelvis', 'spineLower', 'spineUpper', 'neck', 'head', 'beak']],
        ['Left wing chain', ['leftWingShoulder', 'leftWingUpper', 'leftWingLower', 'leftWingTip']],
        ['Right wing chain', ['rightWingShoulder', 'rightWingUpper', 'rightWingLower', 'rightWingTip']],
        ['Left leg chain', ['leftLegUpper', 'leftLegLower', 'leftFoot']],
        ['Right leg chain', ['rightLegUpper', 'rightLegLower', 'rightFoot']],
        ['Tail chain', ['tailBase', 'tailTip']],
      ].map(([name, slots]) => ({ action, existingNodes: [], name, slots }))
    case 'quadruped':
      return [
        ['Spine chain', ['root', 'pelvis', 'spineLower', 'spineUpper', 'neck', 'head']],
        ['Front left leg', ['frontLeftShoulder', 'frontLeftUpperLeg', 'frontLeftLowerLeg', 'frontLeftFoot']],
        ['Front right leg', ['frontRightShoulder', 'frontRightUpperLeg', 'frontRightLowerLeg', 'frontRightFoot']],
        ['Hind left leg', ['hindLeftHip', 'hindLeftUpperLeg', 'hindLeftLowerLeg', 'hindLeftFoot']],
        ['Hind right leg', ['hindRightHip', 'hindRightUpperLeg', 'hindRightLowerLeg', 'hindRightFoot']],
        ['Tail chain', ['tailBase', 'tailTip']],
      ].map(([name, slots]) => ({ action, existingNodes: [], name, slots }))
    case 'arachnid':
      return [
        ['Body chain', ['root', 'abdomen', 'thorax', 'head']],
        ['Front left legs', ['frontLeftLegA', 'frontLeftLegB']],
        ['Front right legs', ['frontRightLegA', 'frontRightLegB']],
        ['Mid left legs', ['midLeftLegA', 'midLeftLegB']],
        ['Mid right legs', ['midRightLegA', 'midRightLegB']],
        ['Rear left legs', ['rearLeftLegA', 'rearLeftLegB', 'backLeftLegA', 'backLeftLegB']],
        ['Rear right legs', ['rearRightLegA', 'rearRightLegB', 'backRightLegA', 'backRightLegB']],
      ].map(([name, slots]) => ({ action, existingNodes: [], name, slots }))
    case 'prop':
      return [['Control chain', ['root', 'body', 'pivot', 'tip']]].map(([name, slots]) => ({
        action,
        existingNodes: [],
        name,
        slots,
      }))
    case 'generic-creature':
      return [
        ['Body chain', ['root', 'body', 'neck', 'head']],
        ['Front limbs', ['frontLeftLimb', 'frontRightLimb']],
        ['Rear limbs', ['rearLeftLimb', 'rearRightLimb']],
        ['Tail chain', ['tailBase', 'tailTip']],
      ].map(([name, slots]) => ({ action, existingNodes: [], name, slots }))
    default:
      return [
        ['Spine chain', ['root', 'pelvis', 'spine', 'chest', 'neck', 'head']],
        ['Left arm chain', ['leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand']],
        ['Right arm chain', ['rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand']],
        ['Left leg chain', ['leftThigh', 'leftCalf', 'leftFoot']],
        ['Right leg chain', ['rightThigh', 'rightCalf', 'rightFoot']],
      ].map(([name, slots]) => ({ action, existingNodes: [], name, slots }))
  }
}

function pickRigFamilyFromGeometry(summary, geometryAnalysis, fallbackFamily) {
  const normalizedFallback = normalizeRigFamily(fallbackFamily)
  const geometryFamily = normalizeRigFamily(geometryAnalysis?.geometryClues?.candidateRigFamily)
  const geometryConfidence = Number(geometryAnalysis?.geometryClues?.familyConfidence ?? 0)
  const summaryConfidence = Number(summary?.rigDiagnostics?.familyConfidence ?? 0)

  if (!geometryAnalysis?.geometryClues?.candidateRigFamily) {
    return normalizedFallback
  }

  if (geometryConfidence >= Math.max(0.62, summaryConfidence + 0.08)) {
    return geometryFamily
  }

  if (summaryConfidence < 0.45 && geometryConfidence >= 0.5) {
    return geometryFamily
  }

  return normalizedFallback
}

function geometryClueNote(geometryAnalysis, rigFamily) {
  if (!geometryAnalysis?.geometryClues) {
    return ''
  }

  const { posture, familyConfidence } = geometryAnalysis.geometryClues
  return `Geometry clues suggest a ${posture} ${formatRigFamily(rigFamily).toLowerCase()} body plan (${formatConfidence(familyConfidence)} confidence).`
}

function refineRigProposalWithGeometry(summary, proposal, geometryAnalysis) {
  if (!proposal) {
    return proposal
  }

  const rigFamily = pickRigFamilyFromGeometry(summary, geometryAnalysis, proposal.rigFamily)
  const geometryNote = geometryClueNote(geometryAnalysis, rigFamily)
  const geometryConfidence = Number(geometryAnalysis?.geometryClues?.familyConfidence ?? 0)
  const canonicalSlots = canonicalSlotsForFamily(rigFamily)
  const nextProposal = {
    ...proposal,
    canonicalSlots,
    confidence: Math.max(Number(proposal.confidence ?? 0), geometryConfidence),
    rigFamily,
    unresolvedSlots: canonicalSlots.filter((slotName) => !proposal?.proposedRigProfile?.[slotName]),
  }

  if (geometryNote && rigFamily !== normalizeRigFamily(proposal.rigFamily)) {
    nextProposal.rationale = `${proposal.rationale} ${geometryNote}`
    nextProposal.warnings = Array.from(
      new Set([
        ...(proposal.warnings ?? []),
        `Geometry analysis overrode the initial family guess to ${formatRigFamily(rigFamily)}.`,
      ]),
    )
  }

  return nextProposal
}

function refineRigUpgradePlanWithGeometry(summary, proposal, plan, geometryAnalysis) {
  if (!plan) {
    return plan
  }

  const rigFamily = pickRigFamilyFromGeometry(summary, geometryAnalysis, plan.rigFamily ?? proposal?.rigFamily)
  const canonicalSlots = canonicalSlotsForFamily(rigFamily)
  const chainAction =
    plan.applyStrategy === 'preserve-and-remap'
      ? 'preserve'
      : plan.applyStrategy === 'hybrid-remap-and-add'
        ? 'hybrid'
        : 'create'
  const nextPlan = {
    ...plan,
    canonicalSlots,
    chainPlans: familyChainPlans(rigFamily, chainAction).map((chainPlan) => ({
      ...chainPlan,
      existingNodes: chainPlan.slots.map((slotName) => proposal?.proposedRigProfile?.[slotName]).filter(Boolean),
    })),
    confidence: Math.max(Number(plan.confidence ?? 0), Number(geometryAnalysis?.geometryClues?.familyConfidence ?? 0)),
    newJointSlots: canonicalSlots.filter((slotName) => !proposal?.proposedRigProfile?.[slotName]),
    preservedJointSlots: canonicalSlots.filter((slotName) => Boolean(proposal?.proposedRigProfile?.[slotName])),
    rigFamily,
    targetRigType: `canonical-${rigFamily}`,
  }

  if (rigFamily !== normalizeRigFamily(plan.rigFamily)) {
    const geometryNote = geometryClueNote(geometryAnalysis, rigFamily)
    nextPlan.rationale = `${plan.rationale} ${geometryNote}`
    nextPlan.warnings = Array.from(
      new Set([
        ...(plan.warnings ?? []),
        `Geometry analysis adjusted the upgrade target to ${formatRigFamily(rigFamily)}.`,
      ]),
    )
  }

  return nextPlan
}

function formatRigStatus(status) {
  if (!status) {
    return 'Unknown'
  }

  if (status === 'partial') {
    return 'Partial rig'
  }

  if (status === 'rigged') {
    return 'Rigged'
  }

  if (status === 'unrigged') {
    return 'Unrigged'
  }

  return status.replace(/(^.|-.?)/g, (segment) => segment.replace('-', ' ').toUpperCase())
}

function formatConfidence(value) {
  if (!Number.isFinite(value)) {
    return '0%'
  }

  return `${Math.round(value * 100)}%`
}

function buildLocalRecipe(prompt, rigFamily = 'humanoid') {
  const normalized = prompt.toLowerCase()
  const normalizedRigFamily = normalizeRigFamily(rigFamily)
  const durationSeconds = normalized.includes('slow')
    ? 6
    : normalized.includes('fast') || normalized.includes('snappy')
      ? 2.4
      : 4
  const tracks = [
    {
      binding: '.position[y]',
      interpolation: 'smooth',
      times: [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, durationSeconds],
      values: [0, 0.06, 0, 0.07, 0],
    },
    {
      binding: '.scale[y]',
      interpolation: 'smooth',
      times: [0, durationSeconds * 0.5, durationSeconds],
      values: [1, 1.03, 1],
    },
  ]

  let rationale = 'Generated a browser-mode idle loop with a simple breathing profile.'

  if (
    normalizedRigFamily === 'avian' &&
    (normalized.includes('wing') || normalized.includes('flap') || normalized.includes('fly'))
  ) {
    const wingTimes = [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, durationSeconds]
    tracks.push(
      {
        targetName: 'leftWingUpper',
        binding: '.rotation[z]',
        interpolation: 'smooth',
        times: wingTimes,
        values: [0.2, -0.75, 0.28, -0.68, 0.2],
      },
      {
        targetName: 'leftWingLower',
        binding: '.rotation[z]',
        interpolation: 'smooth',
        times: wingTimes,
        values: [0.12, -0.52, 0.16, -0.46, 0.12],
      },
      {
        targetName: 'rightWingUpper',
        binding: '.rotation[z]',
        interpolation: 'smooth',
        times: wingTimes,
        values: [-0.2, 0.75, -0.28, 0.68, -0.2],
      },
      {
        targetName: 'rightWingLower',
        binding: '.rotation[z]',
        interpolation: 'smooth',
        times: wingTimes,
        values: [-0.12, 0.52, -0.16, 0.46, -0.12],
      },
      {
        targetName: 'tailBase',
        binding: '.rotation[x]',
        interpolation: 'smooth',
        times: [0, durationSeconds * 0.5, durationSeconds],
        values: [0.04, -0.08, 0.04],
      },
    )
    rationale = 'Added a browser-mode wing flap cycle targeting canonical avian wing joints.'
  }

  if (normalized.includes('turn') || normalized.includes('spin') || normalized.includes('rotate')) {
    tracks.push({
      binding: '.rotation[y]',
      interpolation: 'smooth',
      times: [0, durationSeconds * 0.5, durationSeconds],
      values: [0, Math.PI * 0.5, Math.PI],
    })
    rationale = 'Added a turning motion on top of a browser-mode idle loop.'
  }

  if (normalized.includes('sway') || normalized.includes('dance') || normalized.includes('groove')) {
    tracks.push({
      binding: '.position[x]',
      interpolation: 'smooth',
      times: [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, durationSeconds],
      values: [0, 0.12, 0, -0.12, 0],
    })
    tracks.push({
      binding: '.rotation[z]',
      interpolation: 'smooth',
      times: [0, durationSeconds * 0.25, durationSeconds * 0.5, durationSeconds * 0.75, durationSeconds],
      values: [0, 0.16, 0, -0.16, 0],
    })
    rationale = 'Added a side-to-side sway for browser-mode prompt previewing.'
  }

  return {
    durationSeconds,
    looping: true,
    name: 'Browser Prompt Motion',
    rationale,
    source: 'browser',
    tracks,
  }
}

function formatSavedTime(epochMs) {
  if (!epochMs) {
    return ''
  }

  return new Date(Number(epochMs)).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getErrorMessage(error, fallbackMessage) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return fallbackMessage
}

function isMissingTauriCommand(error, commandName) {
  const message = getErrorMessage(error, '')
  return message.includes(`Command ${commandName} not found`)
}

function slugifyFileToken(value, fallback = 'generated-motion') {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

function buildExportFileName(fileName, recipeName) {
  const baseName = fileName?.replace(/\.[^.]+$/, '') || 'model'
  return `${slugifyFileToken(baseName, 'model')}-${slugifyFileToken(recipeName, 'generated-motion')}.glb`
}

function buildRiggedExportBaseName(fileName) {
  const baseName = fileName?.replace(/\.[^.]+$/, '') || 'model'
  return `${slugifyFileToken(baseName, 'model')}-rigged-upgrade`
}

function buildWorkingCopyFileName(fileName) {
  const baseName = fileName?.replace(/\.[^.]+$/, '') || 'model'
  return `${slugifyFileToken(baseName, 'model')}-rigged-working-copy.glb`
}

function replaceFileExtension(filePath, nextExtension) {
  if (!filePath) {
    return nextExtension
  }

  if (/\.[^.\/]+$/i.test(filePath)) {
    return filePath.replace(/\.[^.\/]+$/i, nextExtension)
  }

  return `${filePath}${nextExtension}`
}

function encodeTextBytes(value) {
  return Array.from(new TextEncoder().encode(value))
}

function downloadBytes(bytes, fileName, mimeType) {
  const blob = new Blob([Uint8Array.from(bytes)], { type: mimeType })
  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = fileName
  link.click()
  URL.revokeObjectURL(downloadUrl)
}

function buildLocalRigProposal(summary, source = 'client-fallback', geometryAnalysis = null) {
  const diagnostics = summary?.rigDiagnostics ?? {}
  const rigProfile = summary?.rigProfile ?? {}
  const rigFamily = pickRigFamilyFromGeometry(summary, geometryAnalysis, diagnostics.detectedRigFamily)
  const canonicalSlots = canonicalSlotsForFamily(rigFamily)
  const unresolvedSlots = canonicalSlots.filter((slotName) => !rigProfile[slotName])

  const rigStatus = diagnostics.rigStatus ?? 'unknown'
  const confidence = Number.isFinite(diagnostics.familyConfidence)
    ? diagnostics.familyConfidence
    : Number.isFinite(diagnostics.detectedHumanoidScore)
      ? diagnostics.detectedHumanoidScore
    : 0

  let readiness = 'needs-rigging'
  let rationale = 'Built a local rig proposal from the current model summary because backend rig analysis was unavailable.'
  const recommendedActions = []
  const warnings = [...(diagnostics.notes ?? [])]

  if (rigStatus === 'rigged') {
    readiness = 'ready'
    rationale = `The current model summary already indicates a usable ${formatRigFamily(rigFamily).toLowerCase()} rig. A local fallback proposal is enough to continue targeting work.`
    recommendedActions.push(`Use the canonical ${formatRigFamily(rigFamily).toLowerCase()} joint family as the active targeting map for prompt generation.`)
    recommendedActions.push('Review any unresolved slots before exporting production-ready animation assets.')
  } else if (rigStatus === 'partial') {
    readiness = 'needs-remap'
    rationale = `The current model summary suggests a partial ${formatRigFamily(rigFamily).toLowerCase()} rig. Continue with remapping and unresolved-slot review before any destructive rigging step.`
    recommendedActions.push(`Preserve existing joints and map them onto the canonical ${formatRigFamily(rigFamily).toLowerCase()} profile.`)
    recommendedActions.push('Resolve missing limb and torso slots before attempting reusable downstream exports.')
  } else {
    recommendedActions.push(`Infer a canonical ${formatRigFamily(rigFamily).toLowerCase()} layout from naming and geometry hints instead of defaulting to a humanoid skeleton.`)
    recommendedActions.push('Review the rig health panel to confirm whether the asset needs a new skeleton or just better naming.')
  }

  const geometryNote = geometryClueNote(geometryAnalysis, rigFamily)
  if (geometryNote) {
    rationale = `${rationale} ${geometryNote}`
  }

  if (!warnings.length) {
    warnings.push('This proposal was generated locally from the loaded summary and may be less specific than the Rust-side analysis path.')
  }

  return {
    source,
    rigFamily,
    canonicalSlots,
    riggingNeeded: diagnostics.riggingNeeded ?? true,
    confidence,
    readiness,
    rationale,
    proposedRigProfile: rigProfile,
    unresolvedSlots,
    recommendedActions,
    warnings,
  }
}

function buildWorkingCopyRigProposal(summary, activePlan) {
  const diagnostics = summary?.rigDiagnostics ?? {}
  const rigFamily = normalizeRigFamily(activePlan?.rigFamily ?? diagnostics.detectedRigFamily)
  const canonicalSlots = activePlan?.canonicalSlots?.length
    ? activePlan.canonicalSlots
    : canonicalSlotsForFamily(rigFamily)
  const proposedRigProfile = summary?.rigProfile ?? {}
  const unresolvedSlots = canonicalSlots.filter((slotName) => !proposedRigProfile[slotName])

  return {
    source: 'working-copy',
    rigFamily,
    canonicalSlots,
    riggingNeeded: false,
    confidence: 1,
    readiness: 'ready',
    rationale: `The active scene is now a derived rigged working copy using the ${formatRigFamily(rigFamily).toLowerCase()} upgrade plan. Continue generating motion against this promoted asset, then save it explicitly when you want a new GLB on disk.`,
    proposedRigProfile,
    unresolvedSlots,
    recommendedActions: [
      'Generate motion against the promoted working copy instead of the original raw source asset.',
      'Use Save rigged working copy to persist the promoted rig without overwriting the source file.',
    ],
    warnings: ['The original source file is unchanged until you explicitly save this rigged working copy.'],
  }
}

function buildLocalRigUpgradePlan(summary, proposal, source = 'client-fallback', geometryAnalysis = null) {
  const rigProfile = proposal?.proposedRigProfile ?? summary?.rigProfile ?? {}
  const rigFamily = pickRigFamilyFromGeometry(
    summary,
    geometryAnalysis,
    proposal?.rigFamily ?? summary?.rigDiagnostics?.detectedRigFamily,
  )
  const canonicalSlots = proposal?.canonicalSlots?.length
    ? proposal.canonicalSlots
    : canonicalSlotsForFamily(rigFamily)
  const preservedJointSlots = canonicalSlots.filter((slotName) => Boolean(rigProfile[slotName]))
  const newJointSlots = canonicalSlots.filter((slotName) => !rigProfile[slotName])

  const rigStatus = summary?.rigDiagnostics?.rigStatus ?? 'unknown'
  const applyStrategy =
    rigStatus === 'rigged' && !proposal?.riggingNeeded
      ? 'preserve-and-remap'
      : rigStatus === 'partial'
        ? 'hybrid-remap-and-add'
        : 'generate-canonical-skeleton'

  const chainAction =
    applyStrategy === 'preserve-and-remap'
      ? 'preserve'
      : applyStrategy === 'hybrid-remap-and-add'
        ? 'hybrid'
        : 'create'

  const chainPlans = [
    ...familyChainPlans(rigFamily, chainAction),
  ].map((chainPlan) => ({
    ...chainPlan,
    existingNodes: chainPlan.slots.map((slotName) => rigProfile[slotName]).filter(Boolean),
  }))

  const requiresWeightPainting = applyStrategy !== 'preserve-and-remap'
  return {
    source,
    readiness:
      applyStrategy === 'preserve-and-remap'
        ? 'ready-for-retargeting'
        : applyStrategy === 'hybrid-remap-and-add'
          ? 'needs-hybrid-upgrade'
          : 'needs-full-rigging',
    confidence: proposal?.confidence ?? summary?.rigDiagnostics?.detectedHumanoidScore ?? 0,
    rationale:
      applyStrategy === 'preserve-and-remap'
        ? `The current asset already has enough ${formatRigFamily(rigFamily).toLowerCase()} rig structure to preserve existing joints and upgrade targeting through remapping.`
        : applyStrategy === 'hybrid-remap-and-add'
          ? `The current asset has partial rig structure. Upgrade by preserving usable joints and adding canonical ${formatRigFamily(rigFamily).toLowerCase()} chains for missing body regions.`
          : `The current asset needs a canonical ${formatRigFamily(rigFamily).toLowerCase()} skeleton plan plus a later skin-weight generation step before it can behave like a fully rigged asset.`,
    rigFamily,
    canonicalSlots,
    targetRigType: `canonical-${rigFamily}`,
    applyStrategy,
    requiresWeightPainting,
    canExportAfterUpgrade: true,
    preservedJointSlots,
    newJointSlots,
    chainPlans,
    recommendedSteps: [
      'Review the proposed canonical slots before any destructive rigging step.',
      'Create a derived rigged asset instead of overwriting the original GLB.',
      requiresWeightPainting
        ? 'Generate or refine skin weights for newly added joints before exporting the upgraded asset.'
        : 'Retarget generated motion against the preserved rig and validate the exported GLB in downstream tools.',
    ],
    warnings: [
      'This is a non-destructive rig upgrade plan, not an applied rigging pass.',
      ...(geometryClueNote(geometryAnalysis, rigFamily)
        ? [`Geometry-guided planning is active for the detected ${formatRigFamily(rigFamily).toLowerCase()} body plan.`]
        : []),
      ...(proposal?.warnings ?? []),
    ],
  }
}

function plannedJointSlots(rigUpgradePlan) {
  if (!rigUpgradePlan) {
    return []
  }

  if (rigUpgradePlan.canonicalSlots?.length) {
    return rigUpgradePlan.canonicalSlots
  }

  const orderedSlots = []
  const seenSlots = new Set()

  for (const chainPlan of rigUpgradePlan.chainPlans ?? []) {
    for (const slotName of chainPlan.slots ?? []) {
      if (!seenSlots.has(slotName)) {
        seenSlots.add(slotName)
        orderedSlots.push(slotName)
      }
    }
  }

  for (const slotName of rigUpgradePlan.newJointSlots ?? []) {
    if (!seenSlots.has(slotName)) {
      seenSlots.add(slotName)
      orderedSlots.push(slotName)
    }
  }

  for (const slotName of rigUpgradePlan.preservedJointSlots ?? []) {
    if (!seenSlots.has(slotName)) {
      seenSlots.add(slotName)
      orderedSlots.push(slotName)
    }
  }

  return orderedSlots
}

function buildEditableRigPlan(rigUpgradePlan, rigEditDraft) {
  if (!rigUpgradePlan) {
    return null
  }

  if (!rigEditDraft) {
    return rigUpgradePlan
  }

  return {
    ...rigUpgradePlan,
    customAnchorMap: rigEditDraft.anchorMap ?? {},
    customJoints: rigEditDraft.customJoints ?? [],
  }
}

function formatCoordinateValue(value) {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000'
}

function buildExportStatusMessage(targetLabel, exportPayload) {
  const totalCount = exportPayload?.exportAnimationCount ?? 0
  const sourceCount = exportPayload?.sourceAnimationCount ?? 0
  const includedGeneratedCount = exportPayload?.includedRecipeNames?.length ?? 0
  const skippedNames = exportPayload?.skippedRecipeNames ?? []
  const exportedSummary = `Exported ${totalCount} animation${totalCount === 1 ? '' : 's'} to ${targetLabel}.`
  const compositionSummary = ` Included ${sourceCount} source clip${sourceCount === 1 ? '' : 's'} and ${includedGeneratedCount} saved or generated clip${includedGeneratedCount === 1 ? '' : 's'}.`

  if (!skippedNames.length) {
    return `${exportedSummary}${compositionSummary}`
  }

  return `${exportedSummary}${compositionSummary} Skipped ${skippedNames.length} clip${skippedNames.length === 1 ? '' : 's'} with no playable targets: ${skippedNames.join(', ')}.`
}

function App() {
  const browserInputRef = useRef(null)
  const browserObjectUrlRef = useRef('')
  const viewportRef = useRef(null)
  const isTauriRuntime = typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [summary, setSummary] = useState(null)
  const [viewerUrl, setViewerUrl] = useState('')
  const [viewerFilePath, setViewerFilePath] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [savedClips, setSavedClips] = useState([])
  const [rigProposal, setRigProposal] = useState(null)
  const [rigUpgradePlan, setRigUpgradePlan] = useState(null)
  const [rigEditDraft, setRigEditDraft] = useState(null)
  const [selectedRigSlot, setSelectedRigSlot] = useState('')
  const [newRigJointName, setNewRigJointName] = useState('')
  const [newRigJointParent, setNewRigJointParent] = useState('root')
  const [geometryAnalysis, setGeometryAnalysis] = useState(null)
  const [isRigPreviewEnabled, setIsRigPreviewEnabled] = useState(false)
  const [includeEmbeddedClipsInRigExport, setIncludeEmbeddedClipsInRigExport] = useState(false)
  const [activeSavedClipId, setActiveSavedClipId] = useState('')
  const [viewerStatus, setViewerStatus] = useState('Choose a GLB to inspect and preview.')
  const [errorMessage, setErrorMessage] = useState('')
  const [showAllNodes, setShowAllNodes] = useState(false)
  const [showAllTargetNodes, setShowAllTargetNodes] = useState(false)
  const [isPickingModel, setIsPickingModel] = useState(false)
  const [isGeneratingRecipe, setIsGeneratingRecipe] = useState(false)
  const [isLoadingSavedClips, setIsLoadingSavedClips] = useState(false)
  const [isSavingClip, setIsSavingClip] = useState(false)
  const [isExportingGlb, setIsExportingGlb] = useState(false)
  const [isGeneratingRigProposal, setIsGeneratingRigProposal] = useState(false)
  const [isGeneratingRigUpgrade, setIsGeneratingRigUpgrade] = useState(false)
  const [isAnalyzingGeometry, setIsAnalyzingGeometry] = useState(false)
  const [isApplyingRigUpgrade, setIsApplyingRigUpgrade] = useState(false)
  const [isActivatingRigWorkingCopy, setIsActivatingRigWorkingCopy] = useState(false)
  const [isSavingWorkingCopy, setIsSavingWorkingCopy] = useState(false)
  const [isRigWorkingCopyActive, setIsRigWorkingCopyActive] = useState(false)
  const [sourceAnimationPreviewName, setSourceAnimationPreviewName] = useState('')
  const [removingSourceAnimationName, setRemovingSourceAnimationName] = useState('')

  useEffect(() => {
    return () => {
      if (browserObjectUrlRef.current) {
        URL.revokeObjectURL(browserObjectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime) {
      return
    }

    async function loadSavedClips() {
      setIsLoadingSavedClips(true)

      try {
        const clips = await invoke('list_saved_animation_clips')
        setSavedClips(clips)
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to load saved animation clips.',
        )
      } finally {
        setIsLoadingSavedClips(false)
      }
    }

    loadSavedClips()
  }, [isTauriRuntime])

  const filteredSavedClips = summary
    ? savedClips.filter((clip) => modelFileMatches(clip.modelFilePath, summary.filePath))
    : []
  const exportRecipes = filteredSavedClips.map((clip) => clip.recipe)
  if (recipe && !activeSavedClipId) {
    exportRecipes.unshift(recipe)
  }
  const canCarryEmbeddedClipsIntoRigExport =
    Boolean(summary?.animationCount) && rigUpgradePlan?.applyStrategy === 'preserve-and-remap'
  const canonicalJointSlots = plannedJointSlots(rigUpgradePlan)
  const detectedRigFamily = normalizeRigFamily(summary?.rigDiagnostics?.detectedRigFamily)
  const editableRigPlan = buildEditableRigPlan(rigUpgradePlan, rigEditDraft)
  const rigEditorSlots = Object.keys(rigEditDraft?.anchorMap ?? {})
  const selectedRigPosition = selectedRigSlot ? rigEditDraft?.anchorMap?.[selectedRigSlot] ?? null : null

  function applyBrowserFile(file) {
    if (!file) {
      return
    }

    if (!isSupportedModelFile(file.name)) {
      setErrorMessage('Choose a .glb or .gltf file.')
      return
    }

    if (browserObjectUrlRef.current) {
      URL.revokeObjectURL(browserObjectUrlRef.current)
    }

    const objectUrl = URL.createObjectURL(file)
    browserObjectUrlRef.current = objectUrl

    startTransition(() => {
      setSummary(buildBrowserSummary(file))
      setViewerUrl(objectUrl)
      setViewerFilePath('')
      setActiveSavedClipId('')
      setShowAllNodes(false)
      setShowAllTargetNodes(false)
      setRigProposal(null)
      setRigUpgradePlan(null)
      setRigEditDraft(null)
      setSelectedRigSlot('')
      setNewRigJointName('')
      setNewRigJointParent('root')
      setGeometryAnalysis(null)
      setIsRigPreviewEnabled(false)
      setIsRigWorkingCopyActive(false)
      setSourceAnimationPreviewName('')
      setRecipe(null)
    })
  }

  function handleBrowserInputChange(event) {
    const [file] = event.target.files ?? []
    setErrorMessage('')
    applyBrowserFile(file)
    event.target.value = ''
  }

  async function handleChooseModel() {
    setErrorMessage('')
    setIsPickingModel(true)

    try {
      if (!isTauriRuntime) {
        browserInputRef.current?.click()
        return
      }

      const selection = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: '3D model',
            extensions: ['glb', 'gltf'],
          },
        ],
      })

      if (!selection || Array.isArray(selection)) {
        return
      }

      const nextSummary = await invoke('inspect_glb', { filePath: selection })

      startTransition(() => {
        setSummary(nextSummary)
        setViewerUrl('')
        setViewerFilePath(nextSummary.filePath)
        setActiveSavedClipId('')
        setShowAllNodes(false)
        setShowAllTargetNodes(false)
        setRigProposal(null)
        setRigUpgradePlan(null)
        setRigEditDraft(null)
        setSelectedRigSlot('')
        setNewRigJointName('')
        setNewRigJointParent('root')
        setGeometryAnalysis(null)
        setIsRigPreviewEnabled(false)
        setIsRigWorkingCopyActive(false)
        setSourceAnimationPreviewName('')
        setRecipe(null)
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to open the model file.')
    } finally {
      setIsPickingModel(false)
    }
  }

  async function handleGenerateRecipe(event) {
    event.preventDefault()

    if (!summary || !prompt.trim()) {
      return
    }

    setErrorMessage('')
    setIsGeneratingRecipe(true)

    try {
      if (!isTauriRuntime) {
        const fallbackRigFamily = rigProposal?.rigFamily ?? summary?.rigDiagnostics?.detectedRigFamily
        startTransition(() => {
          setActiveSavedClipId('')
          setSourceAnimationPreviewName('')
          setRecipe(buildLocalRecipe(prompt, fallbackRigFamily))
        })
        return
      }

      const nextRecipe = await invoke('generate_animation_recipe', {
        input: {
          prompt,
          summary,
        },
      })

      startTransition(() => {
        setActiveSavedClipId('')
        setSourceAnimationPreviewName('')
        setRecipe(nextRecipe)
      })
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Animation generation failed for the current prompt.',
      )
    } finally {
      setIsGeneratingRecipe(false)
    }
  }

  async function handleSaveClip() {
    if (!isTauriRuntime || !summary || !recipe) {
      return
    }

    setErrorMessage('')
    setIsSavingClip(true)

    try {
      const savedClip = await invoke('save_animation_clip', {
        input: {
          prompt,
          summary,
          recipe,
        },
      })

      startTransition(() => {
        setSavedClips((currentClips) => [
          savedClip,
          ...currentClips.filter((clip) => clip.id !== savedClip.id),
        ])
        setActiveSavedClipId(savedClip.id)
        setSourceAnimationPreviewName('')
        setRecipe(savedClip.recipe)
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save this animation clip.')
    } finally {
      setIsSavingClip(false)
    }
  }

  async function handleGenerateRigProposal() {
    if (!summary) {
      return
    }

    setErrorMessage('')
    setIsGeneratingRigProposal(true)

    try {
      if (!isTauriRuntime) {
        setRigProposal({
          ...buildLocalRigProposal(summary, 'browser', geometryAnalysis),
          readiness: 'browser-limited',
          rationale:
            'Rig proposal generation requires the Rust desktop path because browser mode does not run the deeper rig diagnostics pipeline.',
          recommendedActions: ['Run the app in npm run tauri:dev to inspect and plan rigging for this model.'],
          warnings: ['Browser mode cannot inspect skins, joints, or glTF rig structure.'],
        })
        return
      }

      let nextGeometryAnalysis = geometryAnalysis

      if (!nextGeometryAnalysis && viewportRef.current) {
        nextGeometryAnalysis = await viewportRef.current.analyzeRigGeometry()
        startTransition(() => {
          setGeometryAnalysis(nextGeometryAnalysis)
        })
      }

      const nextProposal = await invoke('generate_rig_proposal', {
        input: {
          geometryAnalysis: nextGeometryAnalysis,
          summary,
        },
      })

      startTransition(() => {
        setRigProposal(refineRigProposalWithGeometry(summary, nextProposal, nextGeometryAnalysis))
        setRigUpgradePlan(null)
        setRigEditDraft(null)
        setSelectedRigSlot('')
        setIsRigPreviewEnabled(false)
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to analyze rigging for this model.')
      const resolvedMessage = isMissingTauriCommand(error, 'generate_rig_proposal')
        ? 'The running desktop app does not include the new rigging command yet. Restart npm run tauri:dev and try Analyze rigging again. Showing a local fallback rig proposal instead.'
        : `${message} Showing a local fallback rig proposal instead.`
      startTransition(() => {
        setRigProposal(buildLocalRigProposal(summary, 'client-fallback', geometryAnalysis))
        setRigUpgradePlan(null)
        setRigEditDraft(null)
        setSelectedRigSlot('')
        setIsRigPreviewEnabled(false)
      })
      setErrorMessage(resolvedMessage)
    } finally {
      setIsGeneratingRigProposal(false)
    }
  }

  async function handleAnalyzeRigGeometry() {
    if (!viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsAnalyzingGeometry(true)

    try {
      const nextGeometryAnalysis = await viewportRef.current.analyzeRigGeometry()
      startTransition(() => {
        setGeometryAnalysis(nextGeometryAnalysis)
      })
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to analyze body geometry for this model.'))
    } finally {
      setIsAnalyzingGeometry(false)
    }
  }

  async function handleGenerateRigUpgradePlan() {
    if (!summary || !rigProposal) {
      return
    }

    setErrorMessage('')
    setIsGeneratingRigUpgrade(true)

    try {
      let nextGeometryAnalysis = geometryAnalysis

      if (!nextGeometryAnalysis && viewportRef.current) {
        nextGeometryAnalysis = await viewportRef.current.analyzeRigGeometry()
        startTransition(() => {
          setGeometryAnalysis(nextGeometryAnalysis)
        })
      }

      if (!isTauriRuntime) {
        const nextPlan = buildLocalRigUpgradePlan(summary, rigProposal, 'browser', nextGeometryAnalysis)
        setRigUpgradePlan(nextPlan)
        setRigEditDraft(null)
        setSelectedRigSlot('')
        return
      }

      const nextPlan = await invoke('generate_rig_upgrade_plan', {
        input: {
          geometryAnalysis: nextGeometryAnalysis,
          summary,
          proposal: rigProposal,
        },
      })

      startTransition(() => {
        setRigUpgradePlan(refineRigUpgradePlanWithGeometry(summary, rigProposal, nextPlan, nextGeometryAnalysis))
        setRigEditDraft(null)
        setSelectedRigSlot('')
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to generate a rig upgrade plan.')
      const resolvedMessage = isMissingTauriCommand(error, 'generate_rig_upgrade_plan')
        ? 'The running desktop app does not include the new rig upgrade command yet. Restart npm run tauri:dev and try again. Showing a local fallback upgrade plan instead.'
        : `${message} Showing a local fallback upgrade plan instead.`
      startTransition(() => {
        setRigUpgradePlan(buildLocalRigUpgradePlan(summary, rigProposal, 'client-fallback', geometryAnalysis))
        setRigEditDraft(null)
        setSelectedRigSlot('')
      })
      setErrorMessage(resolvedMessage)
    } finally {
      setIsGeneratingRigUpgrade(false)
    }
  }

  async function handleStartRigEditing() {
    if (!viewportRef.current || !rigUpgradePlan) {
      return
    }

    try {
      const draft = await viewportRef.current.buildRigEditDraft(editableRigPlan ?? rigUpgradePlan, geometryAnalysis)
      startTransition(() => {
        setRigEditDraft(draft)
        setSelectedRigSlot((currentValue) => currentValue || draft.slotOrder[0] || '')
        setNewRigJointParent(draft.slotOrder[0] || 'root')
        setIsRigPreviewEnabled(true)
      })
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to start rig editing for this model.'))
    }
  }

  function handleRigDraftChange(nextDraft) {
    setRigEditDraft(nextDraft)
  }

  function handleRigSlotSelect(slotName) {
    setSelectedRigSlot(slotName)
    if (slotName) {
      setNewRigJointParent(slotName)
    }
  }

  function handleRigCoordinateChange(axis, rawValue) {
    if (!selectedRigSlot || !rigEditDraft) {
      return
    }

    const nextValue = Number(rawValue)
    if (!Number.isFinite(nextValue)) {
      return
    }

    setRigEditDraft((currentDraft) => {
      if (!currentDraft?.anchorMap?.[selectedRigSlot]) {
        return currentDraft
      }

      return {
        ...currentDraft,
        anchorMap: {
          ...currentDraft.anchorMap,
          [selectedRigSlot]: {
            ...currentDraft.anchorMap[selectedRigSlot],
            [axis]: nextValue,
          },
        },
      }
    })
  }

  function handleAddRigJoint() {
    const slotName = newRigJointName.trim()
    if (!slotName || !rigEditDraft) {
      return
    }

    const parentSlot = newRigJointParent || selectedRigSlot || 'root'
    const parentPosition = rigEditDraft.anchorMap[parentSlot] ?? rigEditDraft.anchorMap.root ?? { x: 0, y: 0, z: 0 }

    if (rigEditDraft.anchorMap[slotName]) {
      setErrorMessage(`A joint named ${slotName} already exists in this rig draft.`)
      return
    }

    setErrorMessage('')
    setRigEditDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      const nextPosition = {
        x: Number((parentPosition.x + 0.08).toFixed(4)),
        y: Number((parentPosition.y + 0.08).toFixed(4)),
        z: Number(parentPosition.z.toFixed(4)),
      }

      return {
        ...currentDraft,
        anchorMap: {
          ...currentDraft.anchorMap,
          [slotName]: nextPosition,
        },
        customJoints: [
          ...(currentDraft.customJoints ?? []),
          {
            parentSlot,
            slotName,
            position: nextPosition,
          },
        ],
        slotOrder: [...(currentDraft.slotOrder ?? []), slotName],
      }
    })
    setSelectedRigSlot(slotName)
    setNewRigJointName('')
    setIsRigPreviewEnabled(true)
  }

  function handleRemoveCustomJoint(slotName) {
    if (!rigEditDraft?.customJoints?.some((joint) => joint.slotName === slotName)) {
      return
    }

    setRigEditDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }

      const removableSlots = new Set([slotName])
      let foundNestedSlot = true
      while (foundNestedSlot) {
        foundNestedSlot = false
        ;(currentDraft.customJoints ?? []).forEach((joint) => {
          if (removableSlots.has(joint.parentSlot) && !removableSlots.has(joint.slotName)) {
            removableSlots.add(joint.slotName)
            foundNestedSlot = true
          }
        })
      }

      const nextAnchorMap = { ...(currentDraft.anchorMap ?? {}) }
      removableSlots.forEach((removableSlot) => {
        delete nextAnchorMap[removableSlot]
      })

      return {
        ...currentDraft,
        anchorMap: nextAnchorMap,
        customJoints: (currentDraft.customJoints ?? []).filter((joint) => !removableSlots.has(joint.slotName)),
        slotOrder: (currentDraft.slotOrder ?? []).filter((candidate) => !removableSlots.has(candidate)),
      }
    })

    setSelectedRigSlot((currentValue) => {
      if (!currentValue) {
        return currentValue
      }

      if (currentValue === slotName) {
        return ''
      }

      return rigEditDraft?.customJoints?.some(
        (joint) => joint.slotName === currentValue && joint.parentSlot === slotName,
      )
        ? ''
        : currentValue
    })
  }

  function handleToggleRigPreview() {
    if (!editableRigPlan) {
      return
    }

    setIsRigPreviewEnabled((currentValue) => !currentValue)
  }

  async function handleApplyRigUpgrade() {
    if (!summary || !rigProposal || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsApplyingRigUpgrade(true)

    try {
      const activePlan = editableRigPlan ?? buildLocalRigUpgradePlan(summary, rigProposal, 'client-fallback', geometryAnalysis)
      const resolvedGeometryAnalysis = geometryAnalysis ?? (await viewportRef.current.analyzeRigGeometry())
      const appliedResult = await viewportRef.current.applyRigUpgradePlan(
        activePlan,
        resolvedGeometryAnalysis,
        recipe,
        rigProposal?.proposedRigProfile,
        {
          includeEmbeddedSourceClips: includeEmbeddedClipsInRigExport,
        },
      )
      const baseName = buildRiggedExportBaseName(summary.fileName)
      const rigPackage = {
        appliedAt: new Date().toISOString(),
        geometryAnalysis: resolvedGeometryAnalysis,
        rigProposal,
        rigUpgradePlan: activePlan,
        sourceModel: {
          fileName: summary.fileName,
          filePath: summary.filePath,
        },
        summary,
        upgradeResult: appliedResult.metadata,
        embeddedRiggedAnimationCount: appliedResult.riggedAnimationCount,
        includedSourceAnimationCount: appliedResult.includedSourceAnimationCount,
        includeEmbeddedClipsInRigExport,
        generatedBoneNames: appliedResult.generatedBoneNames,
      }
      const rigPackageBytes = encodeTextBytes(`${JSON.stringify(rigPackage, null, 2)}\n`)

      startTransition(() => {
        setGeometryAnalysis(resolvedGeometryAnalysis)
        setRigUpgradePlan(activePlan)
      })

      if (!isTauriRuntime) {
        downloadBytes(appliedResult.riggedGlbBytes, `${baseName}.glb`, 'model/gltf-binary')
        downloadBytes(rigPackageBytes, `${baseName}.rig-package.json`, 'application/json')
        setViewerStatus(`Downloaded ${baseName}.glb and ${baseName}.rig-package.json.`)
        return
      }

      const targetPath = await saveFileDialog({
        defaultPath: `${baseName}.glb`,
        filters: [
          {
            name: 'Rigged GLB model',
            extensions: ['glb'],
          },
        ],
      })

      if (!targetPath || Array.isArray(targetPath)) {
        return
      }

      const rigPackagePath = replaceFileExtension(targetPath, '.rig-package.json')

      await invoke('write_binary_file', {
        filePath: targetPath,
        bytes: appliedResult.riggedGlbBytes,
      })
      await invoke('write_binary_file', {
        filePath: rigPackagePath,
        bytes: rigPackageBytes,
      })

      setViewerStatus(`Saved ${targetPath} and ${rigPackagePath}.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to apply the rig upgrade to this model.'))
    } finally {
      setIsApplyingRigUpgrade(false)
    }
  }

  async function handleActivateRigWorkingCopy() {
    if (!summary || !rigProposal || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsActivatingRigWorkingCopy(true)

    try {
      const activePlan = editableRigPlan ?? buildLocalRigUpgradePlan(summary, rigProposal, 'client-fallback', geometryAnalysis)
      const resolvedGeometryAnalysis = geometryAnalysis ?? (await viewportRef.current.analyzeRigGeometry())
      const activationResult = await viewportRef.current.activateRigWorkingCopy(
        activePlan,
        resolvedGeometryAnalysis,
        recipe,
        rigProposal?.proposedRigProfile,
        {
          includeEmbeddedSourceClips: includeEmbeddedClipsInRigExport,
        },
      )
      const nextSummary = activationResult.workingSummary

      startTransition(() => {
        setSummary(nextSummary)
        setGeometryAnalysis(activationResult.geometryAnalysis)
        setRigProposal(buildWorkingCopyRigProposal(nextSummary, activePlan))
        setRigUpgradePlan(null)
        setRigEditDraft(null)
        setSelectedRigSlot('')
        setIsRigPreviewEnabled(false)
        setIsRigWorkingCopyActive(true)
        setActiveSavedClipId('')
        setSourceAnimationPreviewName('')
        setRecipe(activationResult.workingRecipe ?? null)
      })
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to promote a rigged working copy for this model.'))
    } finally {
      setIsActivatingRigWorkingCopy(false)
    }
  }

  async function handleSaveWorkingCopyGlb() {
    if (!summary || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsSavingWorkingCopy(true)

    try {
      const exportPayload = await viewportRef.current.exportCurrentSourceGlb()
      const suggestedName = summary.fileName || buildWorkingCopyFileName(exportPayload.defaultFileName)

      if (!isTauriRuntime) {
        downloadBytes(exportPayload.bytes, suggestedName, 'model/gltf-binary')
        setViewerStatus(`Downloaded ${suggestedName}.`)
        return
      }

      const targetPath = await saveFileDialog({
        defaultPath: suggestedName,
        filters: [
          {
            name: 'GLB model',
            extensions: ['glb'],
          },
        ],
      })

      if (!targetPath || Array.isArray(targetPath)) {
        return
      }

      await invoke('write_binary_file', {
        filePath: targetPath,
        bytes: exportPayload.bytes,
      })

      setViewerStatus(`Saved ${targetPath}.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to save the current rigged working copy.'))
    } finally {
      setIsSavingWorkingCopy(false)
    }
  }

  async function handleExportGlb() {
    if (!summary || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsExportingGlb(true)

    try {
      const exportPayload = await viewportRef.current.exportAnimationBundle(exportRecipes)
      const defaultExportLabel = exportRecipes.length > 1 || (summary.animationCount ?? 0) > 0
        ? 'animation-bundle'
        : exportRecipes[0]?.name || exportPayload.defaultFileName
      const suggestedName = buildExportFileName(summary.fileName, defaultExportLabel)

      if (!isTauriRuntime) {
        downloadBytes(exportPayload.bytes, suggestedName, 'model/gltf-binary')
        setViewerStatus(buildExportStatusMessage(suggestedName, exportPayload))
        return
      }

      const targetPath = await saveFileDialog({
        defaultPath: suggestedName,
        filters: [
          {
            name: 'GLB model',
            extensions: ['glb'],
          },
        ],
      })

      if (!targetPath || Array.isArray(targetPath)) {
        return
      }

      await invoke('write_binary_file', {
        filePath: targetPath,
        bytes: exportPayload.bytes,
      })

      setViewerStatus(buildExportStatusMessage(targetPath, exportPayload))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to export the current GLB.')
    } finally {
      setIsExportingGlb(false)
    }
  }

  function handlePreviewSourceAnimation(animationName) {
    startTransition(() => {
      setActiveSavedClipId('')
      setSourceAnimationPreviewName(animationName)
      setRecipe(null)
    })
  }

  async function handleRemoveSourceAnimation(animationName) {
    if (!summary || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setRemovingSourceAnimationName(animationName)

    try {
      const nextPreviewName = sourceAnimationPreviewName === animationName ? '' : sourceAnimationPreviewName
      const result = await viewportRef.current.removeSourceAnimation(animationName, {
        previewAnimationName: nextPreviewName,
      })

      startTransition(() => {
        setSummary((currentSummary) => {
          if (!currentSummary) {
            return currentSummary
          }

          return {
            ...currentSummary,
            animationCount: result.animationCount,
            animationNames: result.animationNames,
          }
        })
        setSourceAnimationPreviewName(result.previewAnimationName || '')
      })
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to remove that source animation from the current file.'))
    } finally {
      setRemovingSourceAnimationName('')
    }
  }

  function handlePlaySavedClip(savedClip) {
    startTransition(() => {
      setActiveSavedClipId(savedClip.id)
      setSourceAnimationPreviewName('')
      setPrompt(savedClip.prompt)
      setRecipe(savedClip.recipe)
    })
  }

  return (
    <main className="shell">
      <input
        ref={browserInputRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        onChange={handleBrowserInputChange}
        hidden
      />

      <section className="hero-panel">
        <div>
          <p className="eyebrow">Tauri + Rust + Three.js</p>
          <h1>Animate GLB</h1>
        </div>
        <p className="hero-copy">
          Inspect a GLB, preview it locally, then turn a natural-language prompt into a transform
          animation clip you can iterate on.
        </p>
        <div className="hero-actions">
          <button
            className="primary-button"
            type="button"
            onClick={handleChooseModel}
            disabled={isPickingModel}
          >
            {isPickingModel ? 'Opening picker…' : 'Choose GLB'}
          </button>
          <span className="inline-status">{summary?.fileName ?? 'No model selected yet'}</span>
        </div>
        {!isTauriRuntime ? (
          <p className="runtime-note">
            Running in browser mode. File selection and prompt recipes use local fallbacks here.
            Use <strong>npm run tauri:dev</strong> for the native file dialog and Rust metadata parsing.
          </p>
        ) : null}
      </section>

      <section className="workspace-grid">
        <div className="panel viewer-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Preview</p>
              <h2>Viewport</h2>
            </div>
            <p className="panel-note">Orbit: drag. Zoom: scroll. Pan: right-click.</p>
          </div>

          <ModelViewport
            ref={viewportRef}
            geometryAnalysis={geometryAnalysis}
            isTauriRuntime={isTauriRuntime}
            modelFilePath={viewerFilePath}
            modelUrl={viewerUrl}
            recipe={recipe}
            rigPreviewEnabled={isRigPreviewEnabled}
            rigPreviewPlan={editableRigPlan}
            rigEditDraft={rigEditDraft}
            rigProfile={rigProposal?.proposedRigProfile}
            selectedRigSlot={selectedRigSlot}
            onRigDraftChange={handleRigDraftChange}
            onRigSlotSelect={handleRigSlotSelect}
            sourceAnimationPreviewName={sourceAnimationPreviewName}
            onStatusChange={setViewerStatus}
          />

          <div className="viewer-footer">
            <p>{viewerStatus}</p>
            {summary ? <p>{formatBytes(summary.sizeBytes)}</p> : null}
          </div>
        </div>

        <div className="control-column">
          <section className="panel metadata-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Model</p>
                <h2>Metadata</h2>
              </div>
            </div>

            <div className="stats-grid">
              <article>
                <span>Scenes</span>
                <strong>{summary?.sceneCount ?? 0}</strong>
              </article>
              <article>
                <span>Nodes</span>
                <strong>{summary?.nodeCount ?? 0}</strong>
              </article>
              <article>
                <span>Animations</span>
                <strong>{summary?.animationCount ?? 0}</strong>
              </article>
              <article>
                <span>Size</span>
                <strong>{summary ? formatBytes(summary.sizeBytes) : '0 B'}</strong>
              </article>
            </div>

            {isRigWorkingCopyActive ? (
              <div className="metadata-expanded-card">
                <div className="metadata-expanded-header">
                  <div>
                    <p className="label">Source</p>
                    <h3>Active rigged working copy</h3>
                  </div>
                  <span className="pill">Promoted in session</span>
                </div>
                <p className="metadata-note">
                  The viewport is currently driven by a derived rigged working copy. Prompt generation and GLB export now target this promoted asset until you load a different model.
                </p>
              </div>
            ) : null}

            <dl className="metadata-list">
              <div>
                <dt>Scenes</dt>
                <dd>{listPreview(summary?.sceneNames, 'No named scenes')}</dd>
              </div>
              <div>
                <dt>Nodes</dt>
                <dd>{listPreview(summary?.nodeNames, 'No named nodes')}</dd>
              </div>
              <div>
                <dt>Embedded clips</dt>
                <dd>{listPreview(summary?.animationNames, 'No embedded animations')}</dd>
              </div>
            </dl>

            <div className="metadata-expanded-card">
              <div className="metadata-expanded-header">
                <div>
                  <p className="label">Hierarchy</p>
                  <h3>All discovered nodes</h3>
                </div>
                <button
                  className="secondary-button metadata-toggle"
                  type="button"
                  onClick={() => setShowAllNodes((currentValue) => !currentValue)}
                  disabled={!summary?.nodeNames?.length}
                >
                  {showAllNodes ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {summary?.nodeNames?.length ? (
                <>
                  <p className="metadata-note">
                    Showing {visibleItems(summary.nodeNames, showAllNodes).length} of {summary.nodeNames.length}{' '}
                    collected node names. The numeric node stat above is the full parsed node count.
                  </p>
                  <div className="token-list">
                    {visibleItems(summary.nodeNames, showAllNodes).map((nodeName) => (
                      <span className="token-chip" key={nodeName}>
                        {nodeName}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="metadata-note">No named nodes were captured for this model.</p>
              )}
            </div>

            <div className="metadata-expanded-card">
              <div className="metadata-expanded-header">
                <div>
                  <p className="label">Targeting</p>
                  <h3>Prompt-targetable bones and nodes</h3>
                </div>
                <button
                  className="secondary-button metadata-toggle"
                  type="button"
                  onClick={() => setShowAllTargetNodes((currentValue) => !currentValue)}
                  disabled={!summary?.targetNodeNames?.length}
                >
                  {showAllTargetNodes ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {summary?.targetNodeNames?.length ? (
                <>
                  <p className="metadata-note">
                    These are the named nodes the prompt system currently considers for local body motion.
                  </p>
                  <div className="token-list">
                    {visibleItems(summary.targetNodeNames, showAllTargetNodes).map((nodeName) => (
                      <span className="token-chip token-chip-target" key={nodeName}>
                        {nodeName}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="metadata-note">
                  No targetable named bones or nodes were detected for this model yet.
                </p>
              )}
            </div>

            <div className="metadata-expanded-card">
              <div className="metadata-expanded-header">
                <div>
                  <p className="label">Rig map</p>
                  <h3>Canonical joint profile</h3>
                </div>
              </div>
              {rigProfileEntries(summary?.rigProfile).length ? (
                <dl className="rig-profile-list">
                  {rigProfileEntries(summary?.rigProfile).map(([slotName, nodeName]) => (
                    <div key={slotName}>
                      <dt>{formatRigSlot(slotName)}</dt>
                      <dd>{nodeName}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="metadata-note">
                  No canonical rig profile could be inferred from the currently captured node names.
                </p>
              )}
            </div>

            <div className="metadata-expanded-card">
              <div className="metadata-expanded-header">
                <div>
                  <p className="label">Rig health</p>
                  <h3>Rigging readiness</h3>
                </div>
                <span className={`status-chip status-${summary?.rigDiagnostics?.rigStatus ?? 'unknown'}`}>
                  {formatRigStatus(summary?.rigDiagnostics?.rigStatus)}
                </span>
              </div>
              <div className="rig-diagnostics-grid">
                <div>
                  <dt>Meshes</dt>
                  <dd>{summary?.rigDiagnostics?.meshCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Skins</dt>
                  <dd>{summary?.rigDiagnostics?.skinCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Joints</dt>
                  <dd>{summary?.rigDiagnostics?.jointCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Resolved slots</dt>
                  <dd>
                    {summary?.rigDiagnostics?.resolvedRigSlotCount ?? 0}/
                    {summary?.rigDiagnostics?.totalRigSlotCount ?? 0}
                  </dd>
                </div>
                <div>
                  <dt>Humanoid score</dt>
                  <dd>{formatConfidence(summary?.rigDiagnostics?.detectedHumanoidScore)}</dd>
                </div>
                <div>
                  <dt>Rig family</dt>
                  <dd>{formatRigFamily(summary?.rigDiagnostics?.detectedRigFamily)}</dd>
                </div>
                <div>
                  <dt>Family confidence</dt>
                  <dd>{formatConfidence(summary?.rigDiagnostics?.familyConfidence)}</dd>
                </div>
              </div>
              {summary?.rigDiagnostics?.notes?.length ? (
                <ul className="detail-list">
                  {summary.rigDiagnostics.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="metadata-note">No additional rigging notes were recorded for this asset.</p>
              )}
            </div>

            {geometryAnalysis ? (
              <div className="metadata-expanded-card">
                <div className="metadata-expanded-header">
                  <div>
                    <p className="label">Geometry</p>
                    <h3>Body-region analysis</h3>
                  </div>
                </div>
                <div className="rig-diagnostics-grid">
                  <div>
                    <dt>Meshes</dt>
                    <dd>{geometryAnalysis.meshCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Triangles</dt>
                    <dd>{geometryAnalysis.triangleCount ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Height</dt>
                    <dd>{geometryAnalysis?.overallBounds?.size?.y ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Width</dt>
                    <dd>{geometryAnalysis?.overallBounds?.size?.x ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Posture</dt>
                    <dd>{geometryAnalysis?.geometryClues?.posture ?? 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Geometry family</dt>
                    <dd>
                      {geometryAnalysis?.geometryClues?.candidateRigFamily
                        ? `${formatRigFamily(geometryAnalysis.geometryClues.candidateRigFamily)} (${formatConfidence(geometryAnalysis.geometryClues.familyConfidence)})`
                        : 'Unknown'}
                    </dd>
                  </div>
                </div>
                  {geometryAnalysis?.geometryClues?.familyScores ? (
                    <div className="detail-block">
                      <p className="label">Geometry family scores</p>
                      <div className="token-list">
                        {Object.entries(geometryAnalysis.geometryClues.familyScores).map(([familyName, value]) => (
                          <span className="token-chip" key={familyName}>
                            {formatRigFamily(familyName)} {formatConfidence(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {geometryAnalysis?.groundContacts?.quadrupedContacts ? (
                    <div className="detail-block">
                      <p className="label">Ground limb clusters</p>
                      <ul className="detail-list">
                        {Object.entries(geometryAnalysis.groundContacts.quadrupedContacts)
                          .filter(([, contact]) => Boolean(contact))
                          .map(([contactName, contact]) => (
                          <li key={contactName}>
                            <strong>{formatRigSlot(contactName)}</strong>: forward {contact.forward}, lateral {contact.lateral}, density {contact.totalDensity ?? contact.count}, supports {contact.supportCount ?? 1}, {contact.isSplitContact ? 'split contact' : 'single contact'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                {geometryAnalysis.meshRegions?.length ? (
                  <ul className="detail-list">
                    {geometryAnalysis.meshRegions.map((meshRegion) => (
                      <li key={`${meshRegion.name}-${meshRegion.region}`}>
                        <strong>{meshRegion.name}</strong>: {meshRegion.region}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="panel prompt-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Rigging</p>
                <h2>Rig proposal</h2>
              </div>
              <span className="pill">{rigProposal ? rigProposal.source : 'Awaiting analysis'}</span>
            </div>

            <div className="recipe-card">
              <div className="recipe-headline">
                <div>
                  <p className="label">Current result</p>
                  <h3>{rigProposal ? formatRigStatus(rigProposal.readiness) : 'No rig proposal yet'}</h3>
                </div>
                <span className="duration-badge">
                  {rigProposal ? formatConfidence(rigProposal.confidence) : '0%'}
                </span>
              </div>

              <p className="metadata-note">
                {rigProposal
                  ? `Target family: ${formatRigFamily(rigProposal.rigFamily)}`
                  : `Detected family: ${formatRigFamily(detectedRigFamily)}`}
              </p>

              <p className="recipe-rationale">
                {rigProposal?.rationale ??
                  'Analyze the current model to determine whether it is already rigged, partially rigged, or still needs a canonical rig proposal.'}
              </p>

              <div className="clip-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleAnalyzeRigGeometry}
                  disabled={!summary || isAnalyzingGeometry}
                >
                  {isAnalyzingGeometry ? 'Analyzing geometry…' : 'Analyze body geometry'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleGenerateRigProposal}
                  disabled={!summary || isGeneratingRigProposal}
                >
                  {isGeneratingRigProposal ? 'Analyzing rig…' : 'Analyze rigging'}
                </button>
                <span className="clip-actions-note">
                  {rigProposal
                    ? rigProposal.riggingNeeded
                      ? 'Proposal indicates this asset still needs rigging or remapping before a full rigging pipeline can be applied.'
                      : 'Proposal indicates the current asset is already usable for rig-aware animation targeting.'
                    : 'This step is analysis only. It does not modify the loaded asset.'}
                </span>
              </div>

              {rigProposal ? (
                <>
                  <div className="clip-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleGenerateRigUpgradePlan}
                      disabled={!rigProposal || isGeneratingRigUpgrade}
                    >
                      {isGeneratingRigUpgrade ? 'Planning upgrade…' : 'Generate rig upgrade plan'}
                    </button>
                    <span className="clip-actions-note">
                      Build a non-destructive upgrade path from the current proposal so previously unrigged assets can move toward a full canonical rig.
                    </span>
                  </div>

                  {rigUpgradePlan ? (
                    <div className="clip-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={handleToggleRigPreview}
                      >
                        {isRigPreviewEnabled ? 'Hide generated rig preview' : 'Preview generated rig'}
                      </button>
                      <span className="clip-actions-note">
                        Overlay the generated canonical skeleton in the viewport before exporting the derived rigged asset.
                      </span>
                    </div>
                  ) : null}

                  {rigProposal.recommendedActions?.length ? (
                    <div className="detail-block">
                      <p className="label">Recommended actions</p>
                      <ul className="detail-list">
                        {rigProposal.recommendedActions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {rigProposal.unresolvedSlots?.length ? (
                    <div className="detail-block">
                      <p className="label">Unresolved slots</p>
                      <div className="token-list">
                        {rigProposal.unresolvedSlots.map((slotName) => (
                          <span className="token-chip" key={slotName}>
                            {formatRigSlot(slotName)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {rigProposal.warnings?.length ? (
                    <div className="detail-block">
                      <p className="label">Warnings</p>
                      <ul className="detail-list">
                        {rigProposal.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}

              {rigUpgradePlan ? (
                <div className="detail-block detail-block-large">
                  <div className="recipe-headline">
                    <div>
                      <p className="label">Upgrade plan</p>
                      <h3>{formatRigStatus(rigUpgradePlan.readiness)}</h3>
                    </div>
                    <span className="duration-badge">{formatConfidence(rigUpgradePlan.confidence)}</span>
                  </div>

                  <p className="recipe-rationale">{rigUpgradePlan.rationale}</p>

                  <div className="rig-diagnostics-grid">
                    <div>
                      <dt>Rig family</dt>
                      <dd>{formatRigFamily(rigUpgradePlan.rigFamily)}</dd>
                    </div>
                    <div>
                      <dt>Target rig</dt>
                      <dd>{rigUpgradePlan.targetRigType}</dd>
                    </div>
                    <div>
                      <dt>Strategy</dt>
                      <dd>{rigUpgradePlan.applyStrategy}</dd>
                    </div>
                    <div>
                      <dt>Weights needed</dt>
                      <dd>{rigUpgradePlan.requiresWeightPainting ? 'Yes' : 'No'}</dd>
                    </div>
                    <div>
                      <dt>Export after upgrade</dt>
                      <dd>{rigUpgradePlan.canExportAfterUpgrade ? 'Yes' : 'No'}</dd>
                    </div>
                  </div>

                  {rigUpgradePlan.chainPlans?.length ? (
                    <div className="detail-block">
                      <p className="label">Chain plan</p>
                      <ul className="detail-list">
                        {rigUpgradePlan.chainPlans.map((chainPlan) => (
                          <li key={chainPlan.name}>
                            <strong>{chainPlan.name}</strong>: {chainPlan.action} · {chainPlan.slots.join(', ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="detail-block">
                    <div className="editor-header">
                      <div>
                        <p className="label">Rig editor</p>
                        <p className="metadata-note">
                          Drag preview joints in the viewport, fine-tune coordinates here, or add custom joints before export.
                        </p>
                      </div>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={handleStartRigEditing}
                      >
                        {rigEditDraft ? 'Refresh editable rig' : 'Edit rig layout'}
                      </button>
                    </div>

                    {rigEditDraft ? (
                      <>
                        <div className="token-list">
                          {rigEditorSlots.map((slotName) => (
                            <button
                              className={`token-chip token-chip-button${selectedRigSlot === slotName ? ' token-chip-target' : ''}`}
                              key={slotName}
                              type="button"
                              onClick={() => handleRigSlotSelect(slotName)}
                            >
                              {formatRigSlot(slotName)}
                            </button>
                          ))}
                        </div>

                        {selectedRigPosition ? (
                          <div className="rig-editor-grid">
                            <label>
                              <span className="label">X</span>
                              <input
                                type="number"
                                step="0.01"
                                value={formatCoordinateValue(selectedRigPosition.x)}
                                onChange={(event) => handleRigCoordinateChange('x', event.target.value)}
                              />
                            </label>
                            <label>
                              <span className="label">Y</span>
                              <input
                                type="number"
                                step="0.01"
                                value={formatCoordinateValue(selectedRigPosition.y)}
                                onChange={(event) => handleRigCoordinateChange('y', event.target.value)}
                              />
                            </label>
                            <label>
                              <span className="label">Z</span>
                              <input
                                type="number"
                                step="0.01"
                                value={formatCoordinateValue(selectedRigPosition.z)}
                                onChange={(event) => handleRigCoordinateChange('z', event.target.value)}
                              />
                            </label>
                          </div>
                        ) : null}

                        <div className="rig-editor-add">
                          <label>
                            <span className="label">New joint</span>
                            <input
                              type="text"
                              value={newRigJointName}
                              onChange={(event) => setNewRigJointName(event.target.value)}
                              placeholder="leftWingFeatherTip"
                            />
                          </label>
                          <label>
                            <span className="label">Parent</span>
                            <select
                              value={newRigJointParent}
                              onChange={(event) => setNewRigJointParent(event.target.value)}
                            >
                              {rigEditorSlots.map((slotName) => (
                                <option key={slotName} value={slotName}>
                                  {formatRigSlot(slotName)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={handleAddRigJoint}
                            disabled={!newRigJointName.trim()}
                          >
                            Add joint
                          </button>
                        </div>

                        {rigEditDraft.customJoints?.length ? (
                          <ul className="detail-list">
                            {rigEditDraft.customJoints.map((joint) => (
                              <li key={joint.slotName} className="rig-editor-row">
                                <span>
                                  <strong>{formatRigSlot(joint.slotName)}</strong> attached to {formatRigSlot(joint.parentSlot)}
                                </span>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => handleRemoveCustomJoint(joint.slotName)}
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  {rigUpgradePlan.newJointSlots?.length ? (
                    <div className="detail-block">
                      <p className="label">New joints to create</p>
                      <div className="token-list">
                        {rigUpgradePlan.newJointSlots.map((slotName) => (
                          <span className="token-chip" key={slotName}>
                            {formatRigSlot(slotName)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {canonicalJointSlots.length ? (
                    <div className="detail-block">
                      <p className="label">Canonical joint coverage</p>
                      <p className="metadata-note">
                        {rigUpgradePlan.applyStrategy === 'preserve-and-remap'
                          ? 'These canonical joints will be preserved or remapped onto the existing rig during derived export.'
                          : 'These canonical joints define the synthetic skeleton that will be created for the derived rigged asset.'}
                      </p>
                      <div className="token-list">
                        {canonicalJointSlots.map((slotName) => (
                          <span className="token-chip" key={slotName}>
                            {formatRigSlot(slotName)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {rigUpgradePlan.recommendedSteps?.length ? (
                    <div className="detail-block">
                      <p className="label">Upgrade steps</p>
                      <ul className="detail-list">
                        {rigUpgradePlan.recommendedSteps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {rigUpgradePlan.warnings?.length ? (
                    <div className="detail-block">
                      <p className="label">Upgrade warnings</p>
                      <ul className="detail-list">
                        {rigUpgradePlan.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="detail-block">
                    <p className="label">Derived export options</p>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={includeEmbeddedClipsInRigExport && canCarryEmbeddedClipsIntoRigExport}
                        onChange={(event) => setIncludeEmbeddedClipsInRigExport(event.target.checked)}
                        disabled={!canCarryEmbeddedClipsIntoRigExport}
                      />
                      <span>
                        Carry forward original embedded clips when the plan can safely preserve and remap the source rig.
                      </span>
                    </label>
                    <p className="metadata-note option-note">
                      {canCarryEmbeddedClipsIntoRigExport
                        ? `This model has ${summary.animationCount} embedded clip${summary.animationCount === 1 ? '' : 's'}, and the current plan can retain them alongside the generated rigged motion.`
                        : 'Original embedded clips are only copied into the derived export when the upgrade strategy is preserve-and-remap and the source model already contains embedded animations.'}
                    </p>
                  </div>

                  <div className="clip-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleApplyRigUpgrade}
                      disabled={!rigProposal || isApplyingRigUpgrade}
                    >
                      {isApplyingRigUpgrade ? 'Applying rig…' : 'Apply rig upgrade and save derived asset'}
                    </button>
                    <span className="clip-actions-note">
                      This creates a derived rigged GLB and a sidecar rig package. It does not overwrite the original source file.
                    </span>
                  </div>

                  <div className="clip-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={handleActivateRigWorkingCopy}
                      disabled={!rigProposal || isActivatingRigWorkingCopy}
                    >
                      {isActivatingRigWorkingCopy ? 'Promoting rig…' : 'Promote rigged working copy'}
                    </button>
                    <span className="clip-actions-note">
                      Replace the active preview source with the derived rigged result so later prompts and exports operate on the promoted asset instead of the raw source.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel prompt-panel">
            <div className="panel-header compact">
              <div>
                <p className="panel-kicker">Prompt</p>
                <h2>Animation recipe</h2>
              </div>
              <span className="pill">{recipe ? sourceLabel(recipe.source) : 'Awaiting prompt'}</span>
            </div>

            <form className="prompt-form" onSubmit={handleGenerateRecipe}>
              <label className="label" htmlFor="animation-prompt">
                Describe the motion you want
              </label>
              <textarea
                id="animation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Create a relaxed idle with a soft bounce and a slow half turn."
                rows={6}
              />

              <div className="form-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!summary || isGeneratingRecipe || !prompt.trim()}
                >
                  {isGeneratingRecipe ? 'Generating…' : 'Generate animation'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setActiveSavedClipId('')
                    setRecipe(null)
                  }}
                  disabled={!recipe}
                >
                  Clear recipe
                </button>
              </div>
            </form>

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

            <div className="recipe-card">
              <div className="recipe-headline">
                <div>
                  <p className="label">Current result</p>
                  <h3>{recipe?.name ?? 'No generated clip yet'}</h3>
                </div>
                <span className="duration-badge">
                  {recipe ? `${recipe.durationSeconds.toFixed(1)}s` : '0.0s'}
                </span>
              </div>

              <p className="recipe-rationale">
                {recipe?.rationale ??
                  'The backend will return a transform-based recipe that the viewer converts into a Three.js animation clip.'}
              </p>

              <div className="clip-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleSaveClip}
                  disabled={!isTauriRuntime || !summary || !recipe || isSavingClip}
                >
                  {isSavingClip ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleExportGlb}
                  disabled={!summary || isExportingGlb}
                >
                  {isExportingGlb ? 'Saving GLB…' : 'Save GLB with animations'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleSaveWorkingCopyGlb}
                  disabled={!summary || !isRigWorkingCopyActive || isSavingWorkingCopy}
                >
                  {isSavingWorkingCopy ? 'Saving working copy…' : 'Save rigged working copy'}
                </button>
                <span className="clip-actions-note">
                  {activeSavedClipId
                    ? 'Saved clip selected for playback.'
                    : isRigWorkingCopyActive
                      ? `Export now bundles the current source animation set plus ${exportRecipes.length} saved or generated clip${exportRecipes.length === 1 ? '' : 's'} into one GLB.`
                      : `Export now bundles the current file animation set plus ${exportRecipes.length} saved or generated clip${exportRecipes.length === 1 ? '' : 's'} into one GLB.`}
                </span>
              </div>

              <ul className="track-list">
                {(recipe?.tracks ?? []).map((track) => (
                  <li key={`${track.targetName ?? 'root'}-${track.binding}-${track.times.join('-')}`}>
                    <span>{track.targetName ? `${track.targetName} ${track.binding}` : `Root ${track.binding}`}</span>
                    <strong>{track.times.length} keyframes</strong>
                  </li>
                ))}
              </ul>
            </div>

            <div className="saved-clips-card">
              <div className="recipe-headline">
                <div>
                  <p className="label">File animations</p>
                  <h3>Embedded and working-copy clips</h3>
                </div>
                <span className="duration-badge">{summary?.animationCount ?? 0}</span>
              </div>

              {!summary ? (
                <p className="recipe-rationale">Load a model to inspect animations already stored in the file.</p>
              ) : summary.animationNames?.length ? (
                <>
                  <p className="recipe-rationale">
                    Preview the animations already embedded in the current file, or remove any clip before exporting a consolidated GLB.
                  </p>
                  <ul className="animation-source-list">
                    {summary.animationNames.map((animationName) => (
                      <li className="animation-source-item" key={animationName}>
                        <button
                          className={`saved-clip-button animation-source-button ${!recipe && sourceAnimationPreviewName === animationName ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => handlePreviewSourceAnimation(animationName)}
                        >
                          <span className="saved-clip-title">{animationName}</span>
                          <span className="saved-clip-meta">Already embedded in the current source file</span>
                        </button>
                        <button
                          className="secondary-button animation-source-action"
                          type="button"
                          onClick={() => handleRemoveSourceAnimation(animationName)}
                          disabled={removingSourceAnimationName === animationName}
                        >
                          {removingSourceAnimationName === animationName ? 'Removing…' : 'Remove'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="recipe-rationale">No animations are currently embedded in this file.</p>
              )}
            </div>

            <div className="saved-clips-card">
              <div className="recipe-headline">
                <div>
                  <p className="label">Library</p>
                  <h3>Saved clips</h3>
                </div>
                <span className="duration-badge">{filteredSavedClips.length}</span>
              </div>

              {!summary ? (
                <p className="recipe-rationale">Load a model to browse clips saved for it.</p>
              ) : isLoadingSavedClips ? (
                <p className="recipe-rationale">Loading saved clips…</p>
              ) : filteredSavedClips.length ? (
                <ul className="saved-clip-list">
                  {filteredSavedClips.map((savedClip) => (
                    <li key={savedClip.id}>
                      <button
                        className={`saved-clip-button ${activeSavedClipId === savedClip.id ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => handlePlaySavedClip(savedClip)}
                      >
                        <span className="saved-clip-title">{savedClip.recipe.name}</span>
                        <span className="saved-clip-meta">
                          {formatSavedTime(savedClip.savedAtEpochMs)} · {savedClip.recipe.durationSeconds.toFixed(1)}s
                        </span>
                        <span className="saved-clip-prompt">{savedClip.prompt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="recipe-rationale">No saved clips for {summary.fileName} yet.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

export default App
