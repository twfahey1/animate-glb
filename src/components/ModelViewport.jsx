import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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

function frameObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 1)

  object.position.sub(center)
  camera.position.set(radius * 1.5, radius * 0.9, radius * 1.9)
  camera.near = 0.01
  camera.far = radius * 20
  camera.updateProjectionMatrix()
  controls.target.set(0, Math.max(size.y * 0.18, 0.2), 0)
  controls.update()
}

function makeClip(recipe) {
  if (!recipe?.tracks?.length) {
    return null
  }

  const tracks = recipe.tracks.map(
    (track) =>
      new THREE.NumberKeyframeTrack(
        track.binding,
        Float32Array.from(track.times),
        Float32Array.from(track.values),
        track.interpolation === 'linear' ? THREE.InterpolateLinear : THREE.InterpolateSmooth,
      ),
  )

  return new THREE.AnimationClip(recipe.name, recipe.durationSeconds, tracks)
}

function attachModel(runtime, gltf, onStatusChange, activeRootRef, embeddedAnimationsRef) {
  const root = gltf.scene || new THREE.Group()
  runtime.content.add(root)
  frameObject(runtime.camera, runtime.controls, root)
  activeRootRef.current = root
  embeddedAnimationsRef.current = gltf.animations

  if (gltf.animations.length) {
    const previewAction = runtime.mixer.clipAction(gltf.animations[0], root)
    previewAction.play()
    onStatusChange('Model loaded. Playing the first embedded clip until you generate a new one.')
    return
  }

  onStatusChange('Model loaded. Generate an animation recipe to preview motion.')
}

function ModelViewport({ isTauriRuntime, modelFilePath, modelUrl, recipe, onStatusChange }) {
  const stageRef = useRef(null)
  const runtimeRef = useRef(null)
  const activeRootRef = useRef(null)
  const embeddedAnimationsRef = useRef([])

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
                attachModel(runtime, gltf, onStatusChange, activeRootRef, embeddedAnimationsRef)
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
        attachModel(runtime, gltf, onStatusChange, activeRootRef, embeddedAnimationsRef)
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
    }
  }, [isTauriRuntime, modelFilePath, modelUrl, onStatusChange])

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

    const clip = makeClip(recipe)

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
}

export default ModelViewport