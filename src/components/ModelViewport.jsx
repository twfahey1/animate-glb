import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

function disposeMaterial(material) {
  if (!material) {
    return
  }

  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.dispose()
    }
  }

  material.dispose()
}

function disposeObject(root) {
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose()
    }

    if (Array.isArray(node.material)) {
      node.material.forEach(disposeMaterial)
      return
    }

    disposeMaterial(node.material)
  })
}

function collectRenderStats(root) {
  const stats = {
    materialCount: 0,
    meshCount: 0,
    skinnedMeshCount: 0,
    triangleCount: 0,
    visibleMeshCount: 0,
  }

  root.updateMatrixWorld(true)
  root.traverse((node) => {
    if (!node.isMesh) {
      return
    }

    stats.meshCount += 1

    if (node.isSkinnedMesh) {
      stats.skinnedMeshCount += 1
    }

    if (node.visible) {
      stats.visibleMeshCount += 1
    }

    if (node.geometry?.index) {
      stats.triangleCount += node.geometry.index.count / 3
    } else if (node.geometry?.attributes?.position) {
      stats.triangleCount += node.geometry.attributes.position.count / 3
    }

    if (Array.isArray(node.material)) {
      stats.materialCount += node.material.length
    } else if (node.material) {
      stats.materialCount += 1
    }
  })

  return stats
}

function normalizePreviewScale(object, box) {
  const size = box.getSize(new THREE.Vector3())
  const largestDimension = Math.max(size.x, size.y, size.z)

  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    return {
      normalized: false,
      previewScale: object.scale.x,
    }
  }

  let scaleFactor = 1

  if (largestDimension < 0.05) {
    scaleFactor = 1.8 / largestDimension
  } else if (largestDimension > 12) {
    scaleFactor = 7.5 / largestDimension
  }

  if (Math.abs(scaleFactor - 1) < 0.001) {
    return {
      normalized: false,
      previewScale: object.scale.x,
    }
  }

  object.scale.multiplyScalar(scaleFactor)
  object.updateMatrixWorld(true)

  return {
    normalized: true,
    previewScale: object.scale.x,
  }
}

function frameObject(camera, controls, object) {
  object.updateMatrixWorld(true)
  let box = new THREE.Box3().setFromObject(object)

  if (box.isEmpty()) {
    camera.position.set(1.8, 1.1, 2.6)
    camera.near = 0.01
    camera.far = 200
    camera.updateProjectionMatrix()
    controls.target.set(0, 0.75, 0)
    controls.update()

    return { centered: false, radius: 1 }
  }

  const scaleInfo = normalizePreviewScale(object, box)

  if (scaleInfo.normalized) {
    box = new THREE.Box3().setFromObject(object)
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) {
    camera.position.set(1.8, 1.1, 2.6)
    camera.near = 0.01
    camera.far = 200
    camera.updateProjectionMatrix()
    controls.target.set(0, 0.75, 0)
    controls.update()

    return { centered: false, radius: 1 }
  }

  const maxSize = Math.max(size.x, size.y, size.z, 0.001)
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov * 0.5)
  const fitHeightDistance = size.y > 0 ? size.y * 0.5 / Math.tan(halfVerticalFov) : 0
  const fitWidthDistance = size.x > 0 ? size.x * 0.5 / (Math.tan(halfVerticalFov) * camera.aspect) : 0
  const distance = Math.max(fitHeightDistance, fitWidthDistance, maxSize * 0.75, 0.12) * 1.35
  const radius = Math.max(distance, maxSize)

  object.position.sub(center)
  camera.position.set(distance * 0.72, distance * 0.48, distance)
  camera.near = Math.max(distance / 1000, 0.001)
  camera.far = Math.max(distance * 40, 200)
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()

  return {
    centered: true,
    normalized: scaleInfo.normalized,
    previewScale: scaleInfo.previewScale,
    radius,
  }
}

function normalizeLookupKey(value) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function findTargetObject(root, targetName) {
  if (!targetName) {
    return root
  }

  const exactMatch = root.getObjectByName(targetName)

  if (exactMatch) {
    return exactMatch
  }

  const requestedKey = normalizeLookupKey(targetName)

  if (!requestedKey) {
    return null
  }

  let fallbackMatch = null

  root.traverse((node) => {
    if (fallbackMatch || !node.name) {
      return
    }

    const candidateKey = normalizeLookupKey(node.name)

    if (candidateKey === requestedKey || candidateKey.includes(requestedKey) || requestedKey.includes(candidateKey)) {
      fallbackMatch = node
    }
  })

  return fallbackMatch
}

function parseBinding(binding) {
  const match = binding.match(/^\.(position|rotation|scale)\[([xyz])\]$/)

  if (!match) {
    return null
  }

  return {
    axis: match[2],
    property: match[1],
  }
}

function absoluteTrackValues(targetObject, binding, relativeValues) {
  const parsedBinding = parseBinding(binding)

  if (!parsedBinding) {
    return relativeValues
  }

  const baseline = targetObject[parsedBinding.property]?.[parsedBinding.axis]

  if (!Number.isFinite(baseline)) {
    return relativeValues
  }

  if (parsedBinding.property === 'scale') {
    return relativeValues.map((value) => baseline * value)
  }

  return relativeValues.map((value) => baseline + value)
}

function makeClip(recipe, activeRoot) {
  if (!recipe?.tracks?.length) {
    return null
  }

  const tracks = recipe.tracks
    .map((track) => {
      const targetObject = findTargetObject(activeRoot, track.targetName)

      if (!targetObject) {
        return null
      }

      const absoluteValues = absoluteTrackValues(targetObject, track.binding, track.values)

      return new THREE.NumberKeyframeTrack(
        `${targetObject.uuid}${track.binding}`,
        Float32Array.from(track.times),
        Float32Array.from(absoluteValues),
        track.interpolation === 'linear' ? THREE.InterpolateLinear : THREE.InterpolateSmooth,
      )
    })
    .filter(Boolean)

  if (!tracks.length) {
    return null
  }

  return new THREE.AnimationClip(recipe.name, recipe.durationSeconds, tracks)
}

function attachModel(runtime, gltf, onStatusChange, activeRootRef, embeddedAnimationsRef) {
  const root = gltf.scene || new THREE.Group()
  runtime.content.add(root)
  const renderStats = collectRenderStats(root)
  const framing = frameObject(runtime.camera, runtime.controls, root)
  activeRootRef.current = root
  embeddedAnimationsRef.current = gltf.animations

  if (!renderStats.meshCount) {
    onStatusChange(
      'Model parsed, but no mesh objects were found. This file may contain only bones, empties, or unsupported data.',
    )
    return
  }

  if (!renderStats.visibleMeshCount) {
    onStatusChange(
      `Model parsed ${renderStats.meshCount} mesh objects, but none are currently visible. Check the source export for hidden meshes or disabled scene content.`,
    )
    return
  }

  if (!framing.centered) {
    onStatusChange(
      `Model parsed ${renderStats.visibleMeshCount} visible mesh objects, but the viewer could not compute stable bounds. This usually points to malformed geometry or extreme transforms in the GLB.`,
    )
    return
  }

  const loadPrefix = framing.normalized
    ? `Model loaded with ${renderStats.visibleMeshCount} visible mesh objects. Preview scale normalized ${framing.previewScale.toFixed(2)}x for viewing.`
    : `Model loaded with ${renderStats.visibleMeshCount} visible mesh objects.`

  if (gltf.animations.length) {
    const previewAction = runtime.mixer.clipAction(gltf.animations[0], root)
    previewAction.play()
    onStatusChange(`${loadPrefix} Playing the first embedded clip until you generate a new one.`)
    return
  }

  onStatusChange(`${loadPrefix} Generate an animation recipe to preview motion.`)
}

function cloneSceneForPlayback(scene) {
  return cloneSkeleton(scene)
}

function summarizeVector(vector) {
  return {
    x: Number(vector.x.toFixed(4)),
    y: Number(vector.y.toFixed(4)),
    z: Number(vector.z.toFixed(4)),
  }
}

function classifyMeshRegion(centerY, minY, maxY) {
  const height = Math.max(maxY - minY, 0.001)
  const normalizedY = (centerY - minY) / height

  if (normalizedY > 0.88) {
    return 'head'
  }

  if (normalizedY > 0.72) {
    return 'upper-torso'
  }

  if (normalizedY > 0.48) {
    return 'core'
  }

  if (normalizedY > 0.24) {
    return 'legs'
  }

  return 'feet'
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1)
}

function summarizeProjectedPoint(point, axes) {
  return {
    ...summarizeVector(point),
    forward: Number(projectHorizontalAxes(point, axes).forward.toFixed(4)),
    lateral: Number(projectHorizontalAxes(point, axes).lateral.toFixed(4)),
  }
}

function buildRegionExtentSummary(points, axes) {
  if (!points.length) {
    return null
  }

  const centroid = points.reduce((accumulator, nextValue) => accumulator.add(nextValue), new THREE.Vector3())
  centroid.multiplyScalar(1 / points.length)

  let left = points[0]
  let right = points[0]
  let front = points[0]
  let back = points[0]
  let top = points[0]
  let bottom = points[0]

  points.forEach((point) => {
    const projectedPoint = projectHorizontalAxes(point, axes)
    const projectedLeft = projectHorizontalAxes(left, axes)
    const projectedRight = projectHorizontalAxes(right, axes)
    const projectedFront = projectHorizontalAxes(front, axes)
    const projectedBack = projectHorizontalAxes(back, axes)

    if (projectedPoint.lateral < projectedLeft.lateral) {
      left = point
    }

    if (projectedPoint.lateral > projectedRight.lateral) {
      right = point
    }

    if (projectedPoint.forward > projectedFront.forward) {
      front = point
    }

    if (projectedPoint.forward < projectedBack.forward) {
      back = point
    }

    if (point.y > top.y) {
      top = point
    }

    if (point.y < bottom.y) {
      bottom = point
    }
  })

  return {
    back: summarizeProjectedPoint(back, axes),
    bottom: summarizeProjectedPoint(bottom, axes),
    centroid: summarizeProjectedPoint(centroid, axes),
    front: summarizeProjectedPoint(front, axes),
    left: summarizeProjectedPoint(left, axes),
    right: summarizeProjectedPoint(right, axes),
    top: summarizeProjectedPoint(top, axes),
  }
}

function buildGeometryClues(size, center, meshRegions, regionBuckets, axes, skinnedMeshCount) {
  const meshCount = Math.max(meshRegions.length, 1)
  const longestHorizontal = Math.max(size.x, size.z, 0.001)
  const height = Math.max(size.y, 0.001)
  const verticality = size.y / longestHorizontal
  const horizontalAspectRatio = longestHorizontal / height
  const widthToHeightRatio = size.x / height
  const depthToHeightRatio = size.z / height
  const lowMeshRatio = (regionBuckets.feet.length + regionBuckets.legs.length) / meshCount
  const feetMeshRatio = regionBuckets.feet.length / meshCount
  const projectedCenter = projectHorizontalAxes(center, axes)
  const headCentroid = regionBuckets.head.length
    ? regionBuckets.head.reduce((accumulator, nextValue) => accumulator.add(nextValue), new THREE.Vector3()).multiplyScalar(1 / regionBuckets.head.length)
    : null
  const headForwardBias = headCentroid
    ? (projectHorizontalAxes(headCentroid, axes).forward - projectedCenter.forward) / longestHorizontal
    : 0
  const leftMeshCount = meshRegions.filter((meshRegion) => meshRegion.center[axes.lateralAxis] < center[axes.lateralAxis]).length
  const rightMeshCount = meshRegions.filter((meshRegion) => meshRegion.center[axes.lateralAxis] >= center[axes.lateralAxis]).length
  const lateralSymmetry = clamp01(1 - Math.abs(leftMeshCount - rightMeshCount) / meshCount)
  const posture = verticality > 1.2 ? 'upright' : horizontalAspectRatio > 1.25 ? 'horizontal' : 'compact'
  const familyScores = {
    humanoid: clamp01(
      clamp01((verticality - 0.75) / 1.1) * 0.45 +
        lateralSymmetry * 0.2 +
        clamp01(regionBuckets.head.length / 2) * 0.15 +
        clamp01(regionBuckets['upper-torso'].length / 2) * 0.1 +
        clamp01(1 - lowMeshRatio) * 0.1,
    ),
    quadruped: clamp01(
      clamp01((horizontalAspectRatio - 1.05) / 1.35) * 0.28 +
        clamp01(lowMeshRatio / 0.6) * 0.24 +
        clamp01(headForwardBias / 0.22) * 0.22 +
        clamp01(regionBuckets.feet.length / 3) * 0.14 +
        clamp01(lateralSymmetry) * 0.12,
    ),
    arachnid: clamp01(
      clamp01((Math.max(widthToHeightRatio, depthToHeightRatio) - 1.2) / 1.5) * 0.24 +
        clamp01((horizontalAspectRatio - 1.1) / 1.5) * 0.18 +
        clamp01(lowMeshRatio / 0.75) * 0.22 +
        clamp01(meshCount / 8) * 0.18 +
        clamp01(feetMeshRatio / 0.55) * 0.18,
    ),
    prop: clamp01(
      (meshCount <= 3 ? 0.34 : 0.08) +
        (skinnedMeshCount === 0 ? 0.18 : 0.04) +
        clamp01(1 - lateralSymmetry) * 0.16 +
        clamp01(1 - regionBuckets.head.length / 2) * 0.16 +
        clamp01(1 - lowMeshRatio) * 0.16,
    ),
    'generic-creature': clamp01(
      0.34 +
        clamp01((horizontalAspectRatio - 0.95) / 1.8) * 0.12 +
        clamp01(lowMeshRatio / 0.7) * 0.16 +
        clamp01(meshCount / 6) * 0.12,
    ),
  }
  const familyCandidates = Object.entries(familyScores).sort((left, right) => right[1] - left[1])
  const [candidateRigFamily, familyConfidence] = familyCandidates[0] ?? ['generic-creature', 0.35]

  return {
    candidateRigFamily,
    dominantForwardAxis: axes.forwardAxis,
    familyConfidence: Number(familyConfidence.toFixed(4)),
    familyScores: Object.fromEntries(
      Object.entries(familyScores).map(([familyName, value]) => [familyName, Number(value.toFixed(4))]),
    ),
    headForwardBias: Number(headForwardBias.toFixed(4)),
    horizontalAspectRatio: Number(horizontalAspectRatio.toFixed(4)),
    lateralSymmetry: Number(lateralSymmetry.toFixed(4)),
    lowMeshRatio: Number(lowMeshRatio.toFixed(4)),
    posture,
    widthToHeightRatio: Number(widthToHeightRatio.toFixed(4)),
  }
}

function pickRegionPoint(regionExtent, pointName, fallbackValue) {
  return regionExtent?.[pointName] ?? fallbackValue
}

function analyzeSceneGeometry(scene) {
  scene.updateMatrixWorld(true)
  const overallBox = new THREE.Box3().setFromObject(scene)

  if (overallBox.isEmpty()) {
    throw new Error('The loaded scene does not have measurable geometry bounds.')
  }

  const size = overallBox.getSize(new THREE.Vector3())
  const center = overallBox.getCenter(new THREE.Vector3())
  const axes = dominantHorizontalAxes(size)
  const meshRegions = []
  const regionBuckets = {
    core: [],
    feet: [],
    head: [],
    legs: [],
    'upper-torso': [],
  }
  let meshCount = 0
  let skinnedMeshCount = 0
  let triangleCount = 0

  scene.traverse((node) => {
    if (!node.isMesh) {
      return
    }

    meshCount += 1

    if (node.isSkinnedMesh) {
      skinnedMeshCount += 1
    }

    if (node.geometry?.index) {
      triangleCount += node.geometry.index.count / 3
    } else if (node.geometry?.attributes?.position) {
      triangleCount += node.geometry.attributes.position.count / 3
    }

    const meshBox = new THREE.Box3().setFromObject(node)

    if (meshBox.isEmpty()) {
      return
    }

    const meshSize = meshBox.getSize(new THREE.Vector3())
    const meshCenter = meshBox.getCenter(new THREE.Vector3())
    meshRegions.push({
      center: summarizeVector(meshCenter),
      name: node.name || `Mesh ${meshCount}`,
      region: classifyMeshRegion(meshCenter.y, overallBox.min.y, overallBox.max.y),
      size: summarizeVector(meshSize),
      triangleCount: Number(
        node.geometry?.index
          ? (node.geometry.index.count / 3).toFixed(0)
          : ((node.geometry?.attributes?.position?.count ?? 0) / 3).toFixed(0),
      ),
    })

    regionBuckets[classifyMeshRegion(meshCenter.y, overallBox.min.y, overallBox.max.y)]?.push(meshCenter.clone())
  })

  meshRegions.sort((left, right) => right.center.y - left.center.y)
  const bodyHeight = Math.max(size.y, 0.001)
  const regionLandmarks = Object.fromEntries(
    Object.entries(regionBuckets)
      .filter(([, values]) => values.length)
      .map(([regionName, values]) => {
        const average = values.reduce((accumulator, nextValue) => accumulator.add(nextValue), new THREE.Vector3())
        average.multiplyScalar(1 / values.length)
        return [regionName, summarizeVector(average)]
      }),
  )
  const regionExtents = Object.fromEntries(
    Object.entries(regionBuckets)
      .filter(([, values]) => values.length)
      .map(([regionName, values]) => [regionName, buildRegionExtentSummary(values, axes)]),
  )
  const geometryClues = buildGeometryClues(size, center, meshRegions, regionBuckets, axes, skinnedMeshCount)

  return {
    bodyBands: {
      chestY: Number((overallBox.min.y + bodyHeight * 0.72).toFixed(4)),
      footY: Number(overallBox.min.y.toFixed(4)),
      headY: Number((overallBox.min.y + bodyHeight * 0.94).toFixed(4)),
      kneeY: Number((overallBox.min.y + bodyHeight * 0.24).toFixed(4)),
      neckY: Number((overallBox.min.y + bodyHeight * 0.84).toFixed(4)),
      pelvisY: Number((overallBox.min.y + bodyHeight * 0.46).toFixed(4)),
    },
    meshCount,
    meshRegions: meshRegions.slice(0, 24),
    overallBounds: {
      center: summarizeVector(center),
      max: summarizeVector(overallBox.max),
      min: summarizeVector(overallBox.min),
      size: summarizeVector(size),
    },
    regionLandmarks,
    regionExtents,
    geometryClues,
    skinnedMeshCount,
    triangleCount: Number(triangleCount.toFixed(0)),
  }
}

function cloneMaterial(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => (entry?.clone ? entry.clone() : entry))
  }

  return material?.clone ? material.clone() : material
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

function dominantHorizontalAxes(size) {
  return size.z >= size.x
    ? { forwardAxis: 'z', lateralAxis: 'x' }
    : { forwardAxis: 'x', lateralAxis: 'z' }
}

function makeHorizontalPoint(center, axes, lateralValue, y, forwardValue) {
  if (axes.forwardAxis === 'z') {
    return new THREE.Vector3(lateralValue, y, forwardValue)
  }

  return new THREE.Vector3(forwardValue, y, lateralValue)
}

function projectHorizontalAxes(vector, axes) {
  return {
    forward: axes.forwardAxis === 'z' ? vector.z : vector.x,
    lateral: axes.lateralAxis === 'x' ? vector.x : vector.z,
  }
}

function buildHumanoidAnchorMap(geometryAnalysis) {
  const min = geometryAnalysis.overallBounds.min
  const center = geometryAnalysis.overallBounds.center
  const size = geometryAnalysis.overallBounds.size
  const torsoExtents = geometryAnalysis.regionExtents?.['upper-torso']
  const legsExtents = geometryAnalysis.regionExtents?.legs
  const feetExtents = geometryAnalysis.regionExtents?.feet
  const width = Math.max(size.x, 0.2)
  const depth = Math.max(size.z, 0.15)
  const height = Math.max(size.y, 0.2)
  const pelvisY = min.y + height * 0.46
  const chestY = min.y + height * 0.72
  const neckY = min.y + height * 0.84
  const headY = min.y + height * 0.93
  const legSpread = width * 0.1
  const shoulderSpread = width * 0.18
  const armReach = width * 0.58
  const headLandmark = geometryAnalysis.regionLandmarks?.head
  const torsoLandmark = geometryAnalysis.regionLandmarks?.['upper-torso']
  const coreLandmark = geometryAnalysis.regionLandmarks?.core
  const legsLandmark = geometryAnalysis.regionLandmarks?.legs
  const feetLandmark = geometryAnalysis.regionLandmarks?.feet
  const landmarkCenterX = torsoLandmark?.x ?? coreLandmark?.x ?? center.x
  const landmarkCenterZ = torsoLandmark?.z ?? coreLandmark?.z ?? center.z
  const leftShoulderX = torsoExtents?.left?.x ?? landmarkCenterX - shoulderSpread
  const rightShoulderX = torsoExtents?.right?.x ?? landmarkCenterX + shoulderSpread
  const leftLegX = legsExtents?.left?.x ?? feetExtents?.left?.x ?? landmarkCenterX - legSpread
  const rightLegX = legsExtents?.right?.x ?? feetExtents?.right?.x ?? landmarkCenterX + legSpread

  return {
    root: new THREE.Vector3(landmarkCenterX, feetLandmark?.y ?? min.y + height * 0.04, landmarkCenterZ),
    pelvis: new THREE.Vector3(coreLandmark?.x ?? landmarkCenterX, coreLandmark?.y ?? pelvisY, coreLandmark?.z ?? landmarkCenterZ),
    spine: new THREE.Vector3(torsoLandmark?.x ?? landmarkCenterX, coreLandmark?.y ?? min.y + height * 0.58, torsoLandmark?.z ?? landmarkCenterZ),
    chest: new THREE.Vector3(torsoLandmark?.x ?? landmarkCenterX, torsoLandmark?.y ?? chestY, torsoLandmark?.z ?? landmarkCenterZ),
    neck: new THREE.Vector3(headLandmark?.x ?? landmarkCenterX, headLandmark?.y ?? neckY, headLandmark?.z ?? landmarkCenterZ),
    head: new THREE.Vector3(headLandmark?.x ?? landmarkCenterX, headLandmark?.y ?? headY, headLandmark?.z ?? landmarkCenterZ),
    jaw: new THREE.Vector3(headLandmark?.x ?? landmarkCenterX, (headLandmark?.y ?? min.y + height * 0.965), (headLandmark?.z ?? landmarkCenterZ) + depth * 0.08),
    leftShoulder: new THREE.Vector3(leftShoulderX, torsoLandmark?.y ?? chestY, torsoLandmark?.z ?? landmarkCenterZ),
    leftUpperArm: new THREE.Vector3(leftShoulderX - width * 0.14, (torsoLandmark?.y ?? chestY) - height * 0.015, torsoLandmark?.z ?? landmarkCenterZ),
    leftForearm: new THREE.Vector3(leftShoulderX - width * 0.29, (torsoLandmark?.y ?? chestY) - height * 0.035, torsoLandmark?.z ?? landmarkCenterZ),
    leftHand: new THREE.Vector3(Math.min(leftShoulderX - width * 0.41, landmarkCenterX - armReach), (torsoLandmark?.y ?? chestY) - height * 0.05, torsoLandmark?.z ?? landmarkCenterZ),
    rightShoulder: new THREE.Vector3(rightShoulderX, torsoLandmark?.y ?? chestY, torsoLandmark?.z ?? landmarkCenterZ),
    rightUpperArm: new THREE.Vector3(rightShoulderX + width * 0.14, (torsoLandmark?.y ?? chestY) - height * 0.015, torsoLandmark?.z ?? landmarkCenterZ),
    rightForearm: new THREE.Vector3(rightShoulderX + width * 0.29, (torsoLandmark?.y ?? chestY) - height * 0.035, torsoLandmark?.z ?? landmarkCenterZ),
    rightHand: new THREE.Vector3(Math.max(rightShoulderX + width * 0.41, landmarkCenterX + armReach), (torsoLandmark?.y ?? chestY) - height * 0.05, torsoLandmark?.z ?? landmarkCenterZ),
    leftThigh: new THREE.Vector3(leftLegX, legsLandmark?.y ?? min.y + height * 0.36, legsLandmark?.z ?? landmarkCenterZ),
    leftCalf: new THREE.Vector3(leftLegX, (legsLandmark?.y ?? min.y + height * 0.18) - height * 0.16, legsLandmark?.z ?? landmarkCenterZ),
    leftFoot: new THREE.Vector3(feetExtents?.left?.x ?? leftLegX, feetLandmark?.y ?? min.y + height * 0.03, (feetLandmark?.z ?? landmarkCenterZ) + depth * 0.12),
    rightThigh: new THREE.Vector3(rightLegX, legsLandmark?.y ?? min.y + height * 0.36, legsLandmark?.z ?? landmarkCenterZ),
    rightCalf: new THREE.Vector3(rightLegX, (legsLandmark?.y ?? min.y + height * 0.18) - height * 0.16, legsLandmark?.z ?? landmarkCenterZ),
    rightFoot: new THREE.Vector3(feetExtents?.right?.x ?? rightLegX, feetLandmark?.y ?? min.y + height * 0.03, (feetLandmark?.z ?? landmarkCenterZ) + depth * 0.12),
  }
}

function buildQuadrupedAnchorMap(geometryAnalysis) {
  const min = geometryAnalysis.overallBounds.min
  const max = geometryAnalysis.overallBounds.max
  const center = geometryAnalysis.overallBounds.center
  const size = geometryAnalysis.overallBounds.size
  const axes = dominantHorizontalAxes(size)
  const projectedCenter = projectHorizontalAxes(center, axes)
  const forwardMin = axes.forwardAxis === 'z' ? min.z : min.x
  const forwardMax = axes.forwardAxis === 'z' ? max.z : max.x
  const lateralCenter = projectedCenter.lateral
  const length = Math.max(forwardMax - forwardMin, 0.3)
  const width = Math.max(axes.lateralAxis === 'x' ? size.x : size.z, 0.2)
  const height = Math.max(size.y, 0.2)
  const torsoExtents = geometryAnalysis.regionExtents?.['upper-torso']
  const legsExtents = geometryAnalysis.regionExtents?.legs
  const feetExtents = geometryAnalysis.regionExtents?.feet
  const headExtents = geometryAnalysis.regionExtents?.head
  const headLandmark = geometryAnalysis.regionLandmarks?.head
  const torsoLandmark = geometryAnalysis.regionLandmarks?.['upper-torso']
  const coreLandmark = geometryAnalysis.regionLandmarks?.core
  const feetLandmark = geometryAnalysis.regionLandmarks?.feet
  const frontForward = projectedCenter.forward + length * 0.24
  const hindForward = projectedCenter.forward - length * 0.22
  const headForward = projectedCenter.forward + length * 0.46
  const tailForward = projectedCenter.forward - length * 0.46
  const bodyY = torsoLandmark?.y ?? min.y + height * 0.62
  const pelvisY = coreLandmark?.y ?? min.y + height * 0.56
  const footY = feetLandmark?.y ?? min.y + height * 0.04
  const headY = headLandmark?.y ?? min.y + height * 0.76
  const shoulderSpread = width * 0.26
  const hipSpread = width * 0.21
  const frontForwardHint = pickRegionPoint(torsoExtents, 'front', null)?.forward ?? frontForward
  const hindForwardHint = pickRegionPoint(legsExtents, 'back', null)?.forward ?? hindForward
  const leftFrontLateral = pickRegionPoint(torsoExtents, 'left', null)?.lateral ?? lateralCenter - shoulderSpread
  const rightFrontLateral = pickRegionPoint(torsoExtents, 'right', null)?.lateral ?? lateralCenter + shoulderSpread
  const leftHindLateral = pickRegionPoint(feetExtents, 'left', null)?.lateral ?? lateralCenter - hipSpread
  const rightHindLateral = pickRegionPoint(feetExtents, 'right', null)?.lateral ?? lateralCenter + hipSpread
  const headFrontHint = pickRegionPoint(headExtents, 'front', null)?.forward ?? headForward
  const tailBackHint = pickRegionPoint(feetExtents, 'back', null)?.forward ?? tailForward

  return {
    root: makeHorizontalPoint(center, axes, lateralCenter, footY, projectedCenter.forward),
    pelvis: makeHorizontalPoint(center, axes, coreLandmark?.x ?? lateralCenter, pelvisY, hindForwardHint + length * 0.1),
    spineLower: makeHorizontalPoint(center, axes, torsoLandmark?.x ?? lateralCenter, bodyY, (hindForwardHint + frontForwardHint) * 0.5 - length * 0.04),
    spineUpper: makeHorizontalPoint(center, axes, torsoLandmark?.x ?? lateralCenter, bodyY + height * 0.03, frontForwardHint),
    neck: makeHorizontalPoint(center, axes, headLandmark?.x ?? lateralCenter, bodyY + height * 0.08, frontForwardHint + length * 0.13),
    head: makeHorizontalPoint(center, axes, headLandmark?.x ?? lateralCenter, headY, headFrontHint),
    jaw: makeHorizontalPoint(center, axes, headLandmark?.x ?? lateralCenter, headY - height * 0.03, headFrontHint + length * 0.04),
    frontLeftShoulder: makeHorizontalPoint(center, axes, leftFrontLateral, bodyY, frontForwardHint),
    frontLeftUpperLeg: makeHorizontalPoint(center, axes, leftFrontLateral, min.y + height * 0.45, frontForwardHint),
    frontLeftLowerLeg: makeHorizontalPoint(center, axes, leftFrontLateral, min.y + height * 0.2, frontForwardHint + length * 0.02),
    frontLeftFoot: makeHorizontalPoint(center, axes, feetExtents?.left?.lateral ?? leftFrontLateral, footY, feetExtents?.front?.forward ?? frontForwardHint + length * 0.06),
    frontRightShoulder: makeHorizontalPoint(center, axes, rightFrontLateral, bodyY, frontForwardHint),
    frontRightUpperLeg: makeHorizontalPoint(center, axes, rightFrontLateral, min.y + height * 0.45, frontForwardHint),
    frontRightLowerLeg: makeHorizontalPoint(center, axes, rightFrontLateral, min.y + height * 0.2, frontForwardHint + length * 0.02),
    frontRightFoot: makeHorizontalPoint(center, axes, feetExtents?.right?.lateral ?? rightFrontLateral, footY, feetExtents?.front?.forward ?? frontForwardHint + length * 0.06),
    hindLeftHip: makeHorizontalPoint(center, axes, leftHindLateral, pelvisY, hindForwardHint),
    hindLeftUpperLeg: makeHorizontalPoint(center, axes, leftHindLateral, min.y + height * 0.42, hindForwardHint),
    hindLeftLowerLeg: makeHorizontalPoint(center, axes, leftHindLateral, min.y + height * 0.19, hindForwardHint - length * 0.02),
    hindLeftFoot: makeHorizontalPoint(center, axes, feetExtents?.left?.lateral ?? leftHindLateral, footY, feetExtents?.back?.forward ?? hindForwardHint - length * 0.03),
    hindRightHip: makeHorizontalPoint(center, axes, rightHindLateral, pelvisY, hindForwardHint),
    hindRightUpperLeg: makeHorizontalPoint(center, axes, rightHindLateral, min.y + height * 0.42, hindForwardHint),
    hindRightLowerLeg: makeHorizontalPoint(center, axes, rightHindLateral, min.y + height * 0.19, hindForwardHint - length * 0.02),
    hindRightFoot: makeHorizontalPoint(center, axes, feetExtents?.right?.lateral ?? rightHindLateral, footY, feetExtents?.back?.forward ?? hindForwardHint - length * 0.03),
    tailBase: makeHorizontalPoint(center, axes, lateralCenter, pelvisY + height * 0.02, hindForwardHint - length * 0.12),
    tailTip: makeHorizontalPoint(center, axes, lateralCenter, pelvisY + height * 0.1, tailBackHint),
  }
}

function buildArachnidAnchorMap(geometryAnalysis) {
  const min = geometryAnalysis.overallBounds.min
  const max = geometryAnalysis.overallBounds.max
  const center = geometryAnalysis.overallBounds.center
  const size = geometryAnalysis.overallBounds.size
  const axes = dominantHorizontalAxes(size)
  const projectedCenter = projectHorizontalAxes(center, axes)
  const forwardMin = axes.forwardAxis === 'z' ? min.z : min.x
  const forwardMax = axes.forwardAxis === 'z' ? max.z : max.x
  const width = Math.max(axes.lateralAxis === 'x' ? size.x : size.z, 0.25)
  const height = Math.max(size.y, 0.15)
  const length = Math.max(forwardMax - forwardMin, 0.25)
  const thoraxY = min.y + height * 0.5
  const legY = min.y + height * 0.12
  const lateralReach = width * 0.62
  const forwardOffsets = [0.32, 0.12, -0.1, -0.3]
  const names = [
    ['frontLeftLegA', 'frontRightLegA'],
    ['frontLeftLegB', 'frontRightLegB'],
    ['midLeftLegA', 'midRightLegA'],
    ['midLeftLegB', 'midRightLegB'],
    ['rearLeftLegA', 'rearRightLegA'],
    ['rearLeftLegB', 'rearRightLegB'],
    ['backLeftLegA', 'backRightLegA'],
    ['backLeftLegB', 'backRightLegB'],
  ]
  const anchorMap = {
    root: makeHorizontalPoint(center, axes, projectedCenter.lateral, min.y + height * 0.08, projectedCenter.forward),
    abdomen: makeHorizontalPoint(center, axes, projectedCenter.lateral, thoraxY - height * 0.02, projectedCenter.forward - length * 0.16),
    thorax: makeHorizontalPoint(center, axes, projectedCenter.lateral, thoraxY, projectedCenter.forward),
    head: makeHorizontalPoint(center, axes, projectedCenter.lateral, thoraxY + height * 0.02, projectedCenter.forward + length * 0.18),
  }

  names.forEach(([leftName, rightName], index) => {
    const lane = Math.floor(index / 2)
    const forwardValue = projectedCenter.forward + length * forwardOffsets[lane]
    const isOuter = index % 2 === 0
    anchorMap[leftName] = makeHorizontalPoint(
      center,
      axes,
      projectedCenter.lateral - lateralReach - (isOuter ? width * 0.12 : width * 0.22),
      legY,
      forwardValue,
    )
    anchorMap[rightName] = makeHorizontalPoint(
      center,
      axes,
      projectedCenter.lateral + lateralReach + (isOuter ? width * 0.12 : width * 0.22),
      legY,
      forwardValue,
    )
  })

  return anchorMap
}

function buildPropAnchorMap(geometryAnalysis) {
  const min = geometryAnalysis.overallBounds.min
  const max = geometryAnalysis.overallBounds.max
  const center = geometryAnalysis.overallBounds.center
  const size = geometryAnalysis.overallBounds.size
  const axes = dominantHorizontalAxes(size)
  const forwardMin = axes.forwardAxis === 'z' ? min.z : min.x
  const forwardMax = axes.forwardAxis === 'z' ? max.z : max.x
  const projectedCenter = projectHorizontalAxes(center, axes)
  const tipForward = projectedCenter.forward + (forwardMax - forwardMin) * 0.42
  return {
    root: makeHorizontalPoint(center, axes, projectedCenter.lateral, min.y, projectedCenter.forward - (forwardMax - forwardMin) * 0.2),
    body: makeHorizontalPoint(center, axes, projectedCenter.lateral, center.y, projectedCenter.forward),
    pivot: makeHorizontalPoint(center, axes, projectedCenter.lateral, center.y, projectedCenter.forward + (forwardMax - forwardMin) * 0.18),
    tip: makeHorizontalPoint(center, axes, projectedCenter.lateral, max.y, tipForward),
  }
}

function buildGenericCreatureAnchorMap(geometryAnalysis) {
  const quadrupedMap = buildQuadrupedAnchorMap(geometryAnalysis)
  return {
    root: quadrupedMap.root,
    body: quadrupedMap.spineLower,
    neck: quadrupedMap.neck,
    head: quadrupedMap.head,
    frontLeftLimb: quadrupedMap.frontLeftUpperLeg,
    frontRightLimb: quadrupedMap.frontRightUpperLeg,
    rearLeftLimb: quadrupedMap.hindLeftUpperLeg,
    rearRightLimb: quadrupedMap.hindRightUpperLeg,
    tailBase: quadrupedMap.tailBase,
    tailTip: quadrupedMap.tailTip,
  }
}

function buildRigDefinition(geometryAnalysis, rigFamily) {
  const family = normalizeRigFamily(rigFamily)

  switch (family) {
    case 'quadruped':
      return {
        anchorMap: buildQuadrupedAnchorMap(geometryAnalysis),
        boneTree: [
          ['pelvis', 'root'],
          ['spineLower', 'pelvis'],
          ['spineUpper', 'spineLower'],
          ['neck', 'spineUpper'],
          ['head', 'neck'],
          ['jaw', 'head'],
          ['frontLeftShoulder', 'spineUpper'],
          ['frontLeftUpperLeg', 'frontLeftShoulder'],
          ['frontLeftLowerLeg', 'frontLeftUpperLeg'],
          ['frontLeftFoot', 'frontLeftLowerLeg'],
          ['frontRightShoulder', 'spineUpper'],
          ['frontRightUpperLeg', 'frontRightShoulder'],
          ['frontRightLowerLeg', 'frontRightUpperLeg'],
          ['frontRightFoot', 'frontRightLowerLeg'],
          ['hindLeftHip', 'pelvis'],
          ['hindLeftUpperLeg', 'hindLeftHip'],
          ['hindLeftLowerLeg', 'hindLeftUpperLeg'],
          ['hindLeftFoot', 'hindLeftLowerLeg'],
          ['hindRightHip', 'pelvis'],
          ['hindRightUpperLeg', 'hindRightHip'],
          ['hindRightLowerLeg', 'hindRightUpperLeg'],
          ['hindRightFoot', 'hindRightLowerLeg'],
          ['tailBase', 'pelvis'],
          ['tailTip', 'tailBase'],
        ],
        color: '#8ad7ff',
        family,
      }
    case 'arachnid':
      return {
        anchorMap: buildArachnidAnchorMap(geometryAnalysis),
        boneTree: [
          ['abdomen', 'root'],
          ['thorax', 'abdomen'],
          ['head', 'thorax'],
          ['frontLeftLegA', 'thorax'],
          ['frontLeftLegB', 'frontLeftLegA'],
          ['frontRightLegA', 'thorax'],
          ['frontRightLegB', 'frontRightLegA'],
          ['midLeftLegA', 'thorax'],
          ['midLeftLegB', 'midLeftLegA'],
          ['midRightLegA', 'thorax'],
          ['midRightLegB', 'midRightLegA'],
          ['rearLeftLegA', 'abdomen'],
          ['rearLeftLegB', 'rearLeftLegA'],
          ['backLeftLegA', 'abdomen'],
          ['backLeftLegB', 'backLeftLegA'],
          ['rearRightLegA', 'abdomen'],
          ['rearRightLegB', 'rearRightLegA'],
          ['backRightLegA', 'abdomen'],
          ['backRightLegB', 'backRightLegA'],
        ],
        color: '#e07bff',
        family,
      }
    case 'prop':
      return {
        anchorMap: buildPropAnchorMap(geometryAnalysis),
        boneTree: [
          ['body', 'root'],
          ['pivot', 'body'],
          ['tip', 'pivot'],
        ],
        color: '#7be0b3',
        family,
      }
    case 'generic-creature':
      return {
        anchorMap: buildGenericCreatureAnchorMap(geometryAnalysis),
        boneTree: [
          ['body', 'root'],
          ['neck', 'body'],
          ['head', 'neck'],
          ['frontLeftLimb', 'body'],
          ['frontRightLimb', 'body'],
          ['rearLeftLimb', 'body'],
          ['rearRightLimb', 'body'],
          ['tailBase', 'body'],
          ['tailTip', 'tailBase'],
        ],
        color: '#ffb261',
        family,
      }
    default:
      return {
        anchorMap: buildHumanoidAnchorMap(geometryAnalysis),
        boneTree: [
          ['pelvis', 'root'],
          ['spine', 'pelvis'],
          ['chest', 'spine'],
          ['neck', 'chest'],
          ['head', 'neck'],
          ['jaw', 'head'],
          ['leftShoulder', 'chest'],
          ['leftUpperArm', 'leftShoulder'],
          ['leftForearm', 'leftUpperArm'],
          ['leftHand', 'leftForearm'],
          ['rightShoulder', 'chest'],
          ['rightUpperArm', 'rightShoulder'],
          ['rightForearm', 'rightUpperArm'],
          ['rightHand', 'rightForearm'],
          ['leftThigh', 'pelvis'],
          ['leftCalf', 'leftThigh'],
          ['leftFoot', 'leftCalf'],
          ['rightThigh', 'pelvis'],
          ['rightCalf', 'rightThigh'],
          ['rightFoot', 'rightCalf'],
        ],
        color: '#ffb261',
        family,
      }
  }
}

function makeBone(name, absolutePosition, parentAbsolutePosition) {
  const bone = new THREE.Bone()
  bone.name = name
  bone.position.copy(absolutePosition.clone().sub(parentAbsolutePosition))
  return bone
}

function createSyntheticSkeleton(rigDefinition) {
  const { anchorMap, boneTree } = rigDefinition
  const rootBone = new THREE.Bone()
  rootBone.name = 'root'
  rootBone.position.copy(anchorMap.root)

  const boneMap = { root: rootBone }
  const boneList = [rootBone]

  function addBone(slotName, parentSlot) {
    const bone = makeBone(slotName, anchorMap[slotName], anchorMap[parentSlot])
    boneMap[parentSlot].add(bone)
    boneMap[slotName] = bone
    boneList.push(bone)
  }

  boneTree.forEach(([slotName, parentSlot]) => addBone(slotName, parentSlot))

  const slotIndexMap = Object.fromEntries(boneList.map((bone, index) => [bone.name, index]))
  return { boneList, rootBone, slotIndexMap }
}

function buildRigSlotReverseMap(rigProfile) {
  return Object.fromEntries(
    Object.entries(rigProfile ?? {})
      .filter(([, nodeName]) => Boolean(nodeName))
      .map(([slotName, nodeName]) => [nodeName, slotName]),
  )
}

function retargetRecipeToRig(recipe, rigProfile) {
  if (!recipe?.tracks?.length) {
    return null
  }

  const reverseRigMap = buildRigSlotReverseMap(rigProfile)
  const tracks = recipe.tracks
    .map((track) => ({
      ...track,
      targetName: track.targetName ? reverseRigMap[track.targetName] ?? track.targetName : 'root',
    }))
    .filter((track) => Boolean(track.targetName))

  if (!tracks.length) {
    return null
  }

  return {
    ...recipe,
    name: `${recipe.name || 'Rigged Motion'} Rigged`,
    tracks,
  }
}

function chooseBoneInfluencesForVertex(vertex, rigDefinition, geometryAnalysis) {
  const { anchorMap, family } = rigDefinition
  const centerX = geometryAnalysis.overallBounds.center.x
  const size = geometryAnalysis.overallBounds.size
  const minY = geometryAnalysis.overallBounds.min.y
  const maxY = geometryAnalysis.overallBounds.max.y
  const height = Math.max(maxY - minY, 0.001)
  const vertexSide = vertex.x >= centerX ? 'right' : 'left'
  const normalizedY = (vertex.y - minY) / height
  const axes = dominantHorizontalAxes(size)
  const projectedCenter = projectHorizontalAxes(geometryAnalysis.overallBounds.center, axes)
  const projectedVertex = projectHorizontalAxes(vertex, axes)
  const forwardMin = axes.forwardAxis === 'z' ? geometryAnalysis.overallBounds.min.z : geometryAnalysis.overallBounds.min.x
  const forwardMax = axes.forwardAxis === 'z' ? geometryAnalysis.overallBounds.max.z : geometryAnalysis.overallBounds.max.x
  const forwardSpan = Math.max(forwardMax - forwardMin, 0.001)
  const normalizedForward = (projectedVertex.forward - forwardMin) / forwardSpan

  return Object.entries(anchorMap)
    .map(([slotName, anchorPosition]) => {
      const distance = Math.max(anchorPosition.distanceTo(vertex), 0.0001)
      let score = 1 / (distance * distance)

      if ((slotName.startsWith('left') && vertexSide === 'right') || (slotName.startsWith('right') && vertexSide === 'left')) {
        score *= 0.12
      }

      if (family === 'humanoid') {
        if (normalizedY < 0.22 && (slotName.includes('Hand') || slotName.includes('Arm') || slotName === 'head' || slotName === 'jaw')) {
          score *= 0.08
        }

        if (normalizedY > 0.72 && (slotName.includes('Foot') || slotName.includes('Calf') || slotName.includes('Thigh'))) {
          score *= 0.08
        }

        if (normalizedY > 0.82 && (slotName === 'head' || slotName === 'jaw' || slotName === 'neck')) {
          score *= 1.6
        }

        if (normalizedY > 0.58 && normalizedY < 0.82 && (slotName === 'chest' || slotName === 'spine' || slotName === 'neck')) {
          score *= 1.35
        }

        if (normalizedY > 0.2 && normalizedY < 0.56 && (slotName === 'pelvis' || slotName.includes('Thigh'))) {
          score *= 1.25
        }
      } else if (family === 'quadruped' || family === 'generic-creature') {
        if (normalizedY < 0.22 && (slotName.includes('Leg') || slotName.includes('Foot') || slotName.includes('Limb'))) {
          score *= 1.45
        }

        if (normalizedForward > 0.58 && (slotName.includes('front') || slotName === 'neck' || slotName === 'head' || slotName === 'jaw')) {
          score *= 1.35
        }

        if (normalizedForward < 0.4 && (slotName.includes('hind') || slotName.includes('rear') || slotName.includes('tail') || slotName === 'pelvis')) {
          score *= 1.35
        }

        if (normalizedY > 0.52 && (slotName.includes('spine') || slotName === 'body' || slotName === 'neck' || slotName === 'head')) {
          score *= 1.28
        }
      } else if (family === 'arachnid') {
        if (normalizedY < 0.22 && slotName.toLowerCase().includes('leg')) {
          score *= 1.6
        }

        if (normalizedY > 0.28 && ['abdomen', 'thorax', 'head'].includes(slotName)) {
          score *= 1.35
        }

        if (normalizedForward > 0.58 && (slotName.includes('front') || slotName === 'head')) {
          score *= 1.3
        }

        if (normalizedForward < 0.42 && (slotName.includes('rear') || slotName.includes('back') || slotName === 'abdomen')) {
          score *= 1.3
        }
      }

      return { score, slotName }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
}

function assignSkinning(geometry, slotIndexMap, rigDefinition, geometryAnalysis) {
  const positionAttribute = geometry.getAttribute('position')

  if (!positionAttribute) {
    throw new Error('The mesh geometry does not contain positions for skinning.')
  }

  const skinIndices = new Uint16Array(positionAttribute.count * 4)
  const skinWeights = new Float32Array(positionAttribute.count * 4)
  const vertex = new THREE.Vector3()

  for (let index = 0; index < positionAttribute.count; index += 1) {
    vertex.fromBufferAttribute(positionAttribute, index)
    const influences = chooseBoneInfluencesForVertex(vertex, rigDefinition, geometryAnalysis)
    const influenceTotal = influences.reduce((sum, influence) => sum + influence.score, 0) || 1

    for (let influenceIndex = 0; influenceIndex < 4; influenceIndex += 1) {
      const influence = influences[influenceIndex]
      skinIndices[index * 4 + influenceIndex] = influence
        ? (slotIndexMap[influence.slotName] ?? slotIndexMap.pelvis ?? 0)
        : 0
      skinWeights[index * 4 + influenceIndex] = influence ? influence.score / influenceTotal : 0
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))
}

function buildRiggedSceneFromSource(sourceScene, geometryAnalysis, upgradePlan) {
  if (!sourceScene) {
    throw new Error('Load a model before applying a rig upgrade.')
  }

  if (upgradePlan?.applyStrategy === 'preserve-and-remap') {
    return {
      metadata: {
        createdJointCount: 0,
        riggedMeshCount: 0,
        strategy: 'preserve-and-remap',
      },
      scene: cloneSceneForPlayback(sourceScene),
    }
  }

  const rigDefinition = buildRigDefinition(geometryAnalysis, upgradePlan?.rigFamily)
  const exportGroup = new THREE.Group()
  exportGroup.name = 'RigUpgradeResult'
  let riggedMeshCount = 0
  let createdJointCount = 0

  sourceScene.updateMatrixWorld(true)
  sourceScene.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes?.position) {
      return
    }

    const geometry = node.geometry.clone()
    geometry.applyMatrix4(node.matrixWorld)
    const { boneList, rootBone, slotIndexMap } = createSyntheticSkeleton(rigDefinition)
    assignSkinning(geometry, slotIndexMap, rigDefinition, geometryAnalysis)
    const skinnedMesh = new THREE.SkinnedMesh(geometry, cloneMaterial(node.material))
    skinnedMesh.name = node.name || `Rigged Mesh ${riggedMeshCount + 1}`
    skinnedMesh.add(rootBone)
    skinnedMesh.bind(new THREE.Skeleton(boneList))
    exportGroup.add(skinnedMesh)
    riggedMeshCount += 1
    createdJointCount = boneList.length
  })

  if (!riggedMeshCount) {
    throw new Error('The current model does not contain any mesh geometry that can be converted into a skinned export.')
  }

  return {
    metadata: {
      createdJointCount,
      riggedMeshCount,
      strategy: upgradePlan?.applyStrategy ?? 'generate-canonical-skeleton',
    },
    scene: exportGroup,
  }
}

function buildRigPreviewGroup(geometryAnalysis, upgradePlan) {
  const rigDefinition = buildRigDefinition(geometryAnalysis, upgradePlan?.rigFamily)
  const { rootBone } = createSyntheticSkeleton(rigDefinition)
  const previewGroup = new THREE.Group()
  previewGroup.name = 'RigPreviewGroup'
  previewGroup.add(rootBone)

  const skeletonHelper = new THREE.SkeletonHelper(rootBone)
  skeletonHelper.material.linewidth = 2
  skeletonHelper.material.depthTest = false
  skeletonHelper.material.transparent = true
  skeletonHelper.material.opacity = 0.95
  skeletonHelper.material.color.set(
    upgradePlan?.applyStrategy === 'preserve-and-remap' ? '#7be0b3' : rigDefinition.color,
  )
  previewGroup.add(skeletonHelper)

  return previewGroup
}

function exportGlb(scene, animations) {
  const exporter = new GLTFExporter()

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result)
          return
        }

        reject(new Error('GLB export returned JSON instead of a binary payload.'))
      },
      (error) => {
        reject(error instanceof Error ? error : new Error('GLB export failed.'))
      },
      {
        animations,
        binary: true,
        onlyVisible: false,
      },
    )
  })
}

const ModelViewport = forwardRef(function ModelViewport(
  { geometryAnalysis, isTauriRuntime, modelFilePath, modelUrl, recipe, rigPreviewEnabled, rigPreviewPlan, rigProfile, onStatusChange },
  ref,
) {
  const stageRef = useRef(null)
  const runtimeRef = useRef(null)
  const activeRootRef = useRef(null)
  const embeddedAnimationsRef = useRef([])
  const sourceRootRef = useRef(null)
  const sourceAnimationsRef = useRef([])
  const rigPreviewRootRef = useRef(null)

  useImperativeHandle(
    ref,
    () => ({
      analyzeRigGeometry() {
        if (!sourceRootRef.current) {
          throw new Error('Load a model before analyzing body geometry.')
        }

        return analyzeSceneGeometry(sourceRootRef.current)
      },
      async exportRecipeGlb(activeRecipe) {
        if (!sourceRootRef.current) {
          throw new Error('Load a model before exporting a GLB.')
        }

        if (!activeRecipe) {
          throw new Error('Generate or select a recipe before exporting a GLB.')
        }

        const exportRoot = cloneSceneForPlayback(sourceRootRef.current)
        const exportAnimations = sourceAnimationsRef.current.map((clip) => clip.clone())
        const generatedClip = makeClip(activeRecipe, exportRoot)

        if (!generatedClip) {
          throw new Error('The selected recipe does not contain any playable tracks to export.')
        }

        exportAnimations.push(generatedClip)

        const glbBuffer = await exportGlb(exportRoot, exportAnimations)
        return {
          bytes: Array.from(new Uint8Array(glbBuffer)),
          defaultFileName: `${activeRecipe.name || 'generated-motion'}.glb`,
        }
      },
      async applyRigUpgradePlan(activePlan, geometryAnalysisInput, activeRecipe, activeRigProfile, options = {}) {
        if (!sourceRootRef.current) {
          throw new Error('Load a model before applying a rig upgrade.')
        }

        if (!activePlan) {
          throw new Error('Generate a rig upgrade plan before applying it.')
        }

        const resolvedGeometryAnalysis = geometryAnalysisInput ?? analyzeSceneGeometry(sourceRootRef.current)
        const { metadata, scene } = buildRiggedSceneFromSource(
          sourceRootRef.current,
          resolvedGeometryAnalysis,
          activePlan,
        )
        const riggedRecipe = retargetRecipeToRig(activeRecipe, activeRigProfile)
        const animations = []

        if (options.includeEmbeddedSourceClips && activePlan?.applyStrategy === 'preserve-and-remap') {
          animations.push(...sourceAnimationsRef.current.map((animation) => animation.clone()))
        }

        if (riggedRecipe) {
          animations.push(...[makeClip(riggedRecipe, scene)].filter(Boolean))
        }
        const glbBuffer = await exportGlb(scene, animations)
        const generatedRig = createSyntheticSkeleton(
          buildRigDefinition(resolvedGeometryAnalysis, activePlan?.rigFamily),
        )

        return {
          defaultBaseName: 'rig-upgrade-result',
          generatedBoneNames: generatedRig.boneList.map((bone) => bone.name),
          geometryAnalysis: resolvedGeometryAnalysis,
          includedSourceAnimationCount:
            options.includeEmbeddedSourceClips && activePlan?.applyStrategy === 'preserve-and-remap'
              ? sourceAnimationsRef.current.length
              : 0,
          metadata,
          riggedAnimationCount: animations.length,
          riggedGlbBytes: Array.from(new Uint8Array(glbBuffer)),
        }
      },
    }),
    [],
  )

  useEffect(() => {
    const stage = stageRef.current

    if (!stage) {
      return undefined
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#091017')
    scene.fog = new THREE.Fog('#091017', 14, 24)

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    stage.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0.75, 0)

    const hemiLight = new THREE.HemisphereLight('#ffd8a9', '#091017', 1.8)
    scene.add(hemiLight)

    const keyLight = new THREE.DirectionalLight('#fff4dd', 2.8)
    keyLight.position.set(4, 6, 5)
    scene.add(keyLight)

    const rimLight = new THREE.DirectionalLight('#75d6d0', 1.4)
    rimLight.position.set(-5, 3, -3)
    scene.add(rimLight)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 80),
      new THREE.MeshStandardMaterial({
        color: '#0f1b23',
        roughness: 0.95,
        metalness: 0.02,
        transparent: true,
        opacity: 0.94,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.15
    scene.add(floor)

    const grid = new THREE.GridHelper(18, 18, '#35555a', '#1b2d32')
    grid.position.y = -1.14
    grid.material.opacity = 0.38
    grid.material.transparent = true
    scene.add(grid)

    const content = new THREE.Group()
    scene.add(content)

    const mixer = new THREE.AnimationMixer(content)
    const clock = new THREE.Clock()

    function resize() {
      const width = stage.clientWidth
      const height = stage.clientHeight

      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    function tick() {
      runtimeRef.current.frameHandle = window.requestAnimationFrame(tick)
      mixer.update(clock.getDelta())
      controls.update()
      renderer.render(scene, camera)
    }

    runtimeRef.current = {
      camera,
      content,
      controls,
      frameHandle: 0,
      mixer,
      renderer,
      scene,
    }

    resize()
    tick()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(runtimeRef.current?.frameHandle ?? 0)
      controls.dispose()
      disposeObject(content)
      mixer.stopAllAction()
      renderer.dispose()
      stage.removeChild(renderer.domElement)
      runtimeRef.current = null
      activeRootRef.current = null
      embeddedAnimationsRef.current = []
      sourceRootRef.current = null
      sourceAnimationsRef.current = []
      rigPreviewRootRef.current = null
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return undefined
    }

    runtime.mixer.stopAllAction()
    runtime.content.clear()
    activeRootRef.current = null
    embeddedAnimationsRef.current = []
    sourceRootRef.current = null
    sourceAnimationsRef.current = []

    if (!modelUrl && !modelFilePath) {
      onStatusChange('Choose a GLB to inspect and preview.')
      return undefined
    }

    onStatusChange('Loading model preview…')
    let cancelled = false
    const loader = new GLTFLoader()

    if (isTauriRuntime && modelFilePath) {
      invoke('read_glb_binary', { filePath: modelFilePath })
        .then((payload) => {
          if (cancelled) {
            return
          }

          const binary = Uint8Array.from(payload.bytes)
          loader.parse(
            binary.buffer,
            '',
            (gltf) => {
              if (!cancelled) {
                sourceRootRef.current = gltf.scene || new THREE.Group()
                sourceAnimationsRef.current = gltf.animations.map((animation) => animation.clone())
                const previewScene = cloneSceneForPlayback(sourceRootRef.current)
                attachModel(
                  runtime,
                  { ...gltf, animations: sourceAnimationsRef.current.map((animation) => animation.clone()), scene: previewScene },
                  onStatusChange,
                  activeRootRef,
                  embeddedAnimationsRef,
                )
              }
            },
            () => {
              if (!cancelled) {
                onStatusChange('The selected GLB could not be parsed by the desktop viewer.')
              }
            },
          )
        })
        .catch((error) => {
          if (!cancelled) {
            onStatusChange(error instanceof Error ? error.message : 'Unable to load the selected GLB.')
          }
        })

      return () => {
        cancelled = true

        if (activeRootRef.current) {
          disposeObject(activeRootRef.current)
        }

        runtime.mixer.stopAllAction()
        runtime.content.clear()
        activeRootRef.current = null
        embeddedAnimationsRef.current = []
      }
    }

    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) {
          return
        }
        sourceRootRef.current = gltf.scene || new THREE.Group()
        sourceAnimationsRef.current = gltf.animations.map((animation) => animation.clone())
        const previewScene = cloneSceneForPlayback(sourceRootRef.current)
        attachModel(
          runtime,
          { ...gltf, animations: sourceAnimationsRef.current.map((animation) => animation.clone()), scene: previewScene },
          onStatusChange,
          activeRootRef,
          embeddedAnimationsRef,
        )
      },
      undefined,
      () => {
        if (!cancelled) {
          onStatusChange('The viewer could not load that file. Check that it is a valid GLB or GLTF.')
        }
      },
    )

    return () => {
      cancelled = true

      if (activeRootRef.current) {
        disposeObject(activeRootRef.current)
      }

      runtime.mixer.stopAllAction()
      runtime.content.clear()
      activeRootRef.current = null
      embeddedAnimationsRef.current = []
      sourceRootRef.current = null
      sourceAnimationsRef.current = []
      rigPreviewRootRef.current = null
    }
  }, [isTauriRuntime, modelFilePath, modelUrl, onStatusChange])

  useEffect(() => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return undefined
    }

    if (rigPreviewRootRef.current) {
      runtime.scene.remove(rigPreviewRootRef.current)
      rigPreviewRootRef.current = null
    }

    if (!rigPreviewEnabled || !sourceRootRef.current || !rigPreviewPlan) {
      return undefined
    }

    try {
      const resolvedGeometryAnalysis = geometryAnalysis ?? analyzeSceneGeometry(sourceRootRef.current)
      const previewGroup = buildRigPreviewGroup(resolvedGeometryAnalysis, rigPreviewPlan)
      runtime.scene.add(previewGroup)
      rigPreviewRootRef.current = previewGroup
    } catch {
      rigPreviewRootRef.current = null
    }

    return () => {
      if (rigPreviewRootRef.current) {
        runtime.scene.remove(rigPreviewRootRef.current)
        rigPreviewRootRef.current = null
      }
    }
  }, [geometryAnalysis, rigPreviewEnabled, rigPreviewPlan])

  useEffect(() => {
    const runtime = runtimeRef.current
    const activeRoot = activeRootRef.current

    if (!runtime || !activeRoot) {
      return undefined
    }

    runtime.mixer.stopAllAction()

    if (!recipe) {
      if (embeddedAnimationsRef.current.length) {
        const previewAction = runtime.mixer.clipAction(embeddedAnimationsRef.current[0], activeRoot)
        previewAction.reset().fadeIn(0.15).play()
        onStatusChange('Embedded animation preview restored.')
      }

      return undefined
    }

    const clip = makeClip(recipe, activeRoot)

    if (!clip) {
      onStatusChange('The recipe did not contain any playable animation tracks.')
      return undefined
    }

    const action = runtime.mixer.clipAction(clip, activeRoot)
    action.clampWhenFinished = true
    action.setLoop(recipe.looping ? THREE.LoopRepeat : THREE.LoopOnce, recipe.looping ? Infinity : 1)
    action.reset().fadeIn(0.2).play()
    onStatusChange(`Playing ${recipe.name}.`)

    return () => {
      action.stop()
      runtime.mixer.uncacheClip(clip)
    }
  }, [recipe, onStatusChange])

  return (
    <div className="viewer-stage">
      <div className="viewer-canvas" ref={stageRef} />
      <div className="viewer-overlay">
        {isTauriRuntime && modelFilePath
          ? 'Desktop preview parses GLB bytes in-memory through the Rust backend.'
          : 'Browser preview loads the selected model URL directly.'}
      </div>
    </div>
  )
})

export default ModelViewport