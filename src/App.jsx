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
      rigStatus: 'unknown',
      riggingNeeded: true,
      notes: ['Browser mode does not run Rust-side rig diagnostics.'],
    },
    animationNames: [],
  }
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

function buildLocalRecipe(prompt) {
  const normalized = prompt.toLowerCase()
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

function buildLocalRigProposal(summary, source = 'client-fallback') {
  const diagnostics = summary?.rigDiagnostics ?? {}
  const rigProfile = summary?.rigProfile ?? {}
  const unresolvedSlots = [
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
  ].filter((slotName) => !rigProfile[slotName])

  const rigStatus = diagnostics.rigStatus ?? 'unknown'
  const confidence = Number.isFinite(diagnostics.detectedHumanoidScore)
    ? diagnostics.detectedHumanoidScore
    : 0

  let readiness = 'needs-rigging'
  let rationale = 'Built a local rig proposal from the current model summary because backend rig analysis was unavailable.'
  const recommendedActions = []
  const warnings = [...(diagnostics.notes ?? [])]

  if (rigStatus === 'rigged') {
    readiness = 'ready'
    rationale = 'The current model summary already indicates a usable rig. A local fallback proposal is enough to continue targeting work.'
    recommendedActions.push('Use the canonical joint profile as the active targeting map for prompt generation.')
    recommendedActions.push('Review any unresolved slots before exporting production-ready animation assets.')
  } else if (rigStatus === 'partial') {
    readiness = 'needs-remap'
    rationale = 'The current model summary suggests a partial rig. Continue with remapping and unresolved-slot review before any destructive rigging step.'
    recommendedActions.push('Preserve existing joints and map them onto the canonical humanoid profile.')
    recommendedActions.push('Resolve missing limb and torso slots before attempting reusable downstream exports.')
  } else {
    recommendedActions.push('Treat this as an analysis-only result until backend rig proposal generation is available.')
    recommendedActions.push('Review the rig health panel to confirm whether the asset needs a new skeleton or just better naming.')
  }

  if (!warnings.length) {
    warnings.push('This proposal was generated locally from the loaded summary and may be less specific than the Rust-side analysis path.')
  }

  return {
    source,
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
    ? savedClips.filter((clip) => clip.modelFilePath === summary.filePath)
    : []

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
        startTransition(() => {
          setActiveSavedClipId('')
          setRecipe(buildLocalRecipe(prompt))
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
          ...buildLocalRigProposal(summary, 'browser'),
          readiness: 'browser-limited',
          rationale:
            'Rig proposal generation requires the Rust desktop path because browser mode does not run the deeper rig diagnostics pipeline.',
          recommendedActions: ['Run the app in npm run tauri:dev to inspect and plan rigging for this model.'],
          warnings: ['Browser mode cannot inspect skins, joints, or glTF rig structure.'],
        })
        return
      }

      const nextProposal = await invoke('generate_rig_proposal', {
        input: {
          summary,
        },
      })

      startTransition(() => {
        setRigProposal(nextProposal)
      })
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to analyze rigging for this model.')
      const resolvedMessage = isMissingTauriCommand(error, 'generate_rig_proposal')
        ? 'The running desktop app does not include the new rigging command yet. Restart npm run tauri:dev and try Analyze rigging again. Showing a local fallback rig proposal instead.'
        : `${message} Showing a local fallback rig proposal instead.`
      startTransition(() => {
        setRigProposal(buildLocalRigProposal(summary))
      })
      setErrorMessage(resolvedMessage)
    } finally {
      setIsGeneratingRigProposal(false)
    }
  }

  async function handleExportGlb() {
    if (!summary || !recipe || !viewportRef.current) {
      return
    }

    setErrorMessage('')
    setIsExportingGlb(true)

    try {
      const exportPayload = await viewportRef.current.exportRecipeGlb(recipe)
      const suggestedName = buildExportFileName(summary.fileName, recipe.name || exportPayload.defaultFileName)

      if (!isTauriRuntime) {
        const blob = new Blob([Uint8Array.from(exportPayload.bytes)], { type: 'model/gltf-binary' })
        const downloadUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = suggestedName
        link.click()
        URL.revokeObjectURL(downloadUrl)
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

      setViewerStatus(`Exported ${recipe.name} to ${targetPath}.`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to export the current GLB.')
    } finally {
      setIsExportingGlb(false)
    }
  }

  function handlePlaySavedClip(savedClip) {
    startTransition(() => {
      setActiveSavedClipId(savedClip.id)
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
            isTauriRuntime={isTauriRuntime}
            modelFilePath={viewerFilePath}
            modelUrl={viewerUrl}
            recipe={recipe}
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

              <p className="recipe-rationale">
                {rigProposal?.rationale ??
                  'Analyze the current model to determine whether it is already rigged, partially rigged, or still needs a canonical rig proposal.'}
              </p>

              <div className="clip-actions">
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
                  disabled={!summary || !recipe || isExportingGlb}
                >
                  {isExportingGlb ? 'Saving GLB…' : 'Save GLB with animations'}
                </button>
                <span className="clip-actions-note">
                  {activeSavedClipId
                    ? 'Saved clip selected for playback.'
                    : 'Save this result locally or export a new GLB with the generated clip embedded as a native animation for other tools.'}
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
