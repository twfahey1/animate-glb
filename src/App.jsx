import { startTransition, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
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
    animationNames: [],
  }
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

function App() {
  const browserInputRef = useRef(null)
  const browserObjectUrlRef = useRef('')
  const isTauriRuntime = typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [summary, setSummary] = useState(null)
  const [viewerUrl, setViewerUrl] = useState('')
  const [viewerFilePath, setViewerFilePath] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [viewerStatus, setViewerStatus] = useState('Choose a GLB to inspect and preview.')
  const [errorMessage, setErrorMessage] = useState('')
  const [isPickingModel, setIsPickingModel] = useState(false)
  const [isGeneratingRecipe, setIsGeneratingRecipe] = useState(false)

  useEffect(() => {
    return () => {
      if (browserObjectUrlRef.current) {
        URL.revokeObjectURL(browserObjectUrlRef.current)
      }
    }
  }, [])

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
                  onClick={() => setRecipe(null)}
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

              <ul className="track-list">
                {(recipe?.tracks ?? []).map((track) => (
                  <li key={`${track.targetName ?? 'root'}-${track.binding}-${track.times.join('-')}`}>
                    <span>{track.targetName ? `${track.targetName} ${track.binding}` : `Root ${track.binding}`}</span>
                    <strong>{track.times.length} keyframes</strong>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

export default App
