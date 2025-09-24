/**
 * Copyright (c) Streamlit Inc. (2018-2022) Snowflake Inc. (2022-2025)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Core types for the headless waveform controller architecture.
 * This provides a clean separation between control logic and presentation.
 */

export type WaveformMode = "record" | "playback" | "auto"

export type WaveformState =
  | "idle" // Nothing loaded, not recording
  | "requesting_mic" // Awaiting user permission
  | "recording" // Actively capturing
  | "stopping" // Flushing/finishing capture
  | "ready" // Recording available for playback
  | "playing" // Currently playing back
  | "paused" // Playback paused
  | "error" // Unrecoverable error

/**
 * Capabilities define what actions are currently allowed based on state.
 * This enables parent components to properly enable/disable UI controls.
 */
export interface WaveformControllerCapabilities {
  canStartRecording: boolean
  canStopRecording: boolean
  canCancelRecording: boolean
  canPlay: boolean
  canPause: boolean
  canSeek: boolean
  canClear: boolean
}

/**
 * Error codes for consistent error handling
 */
export type WaveformErrorCode =
  | "permission_denied"
  | "unsupported_browser"
  | "wavesurfer_unavailable"
  | "recorder_unavailable"
  | "encoder_failed"
  | "container_swap_blocked"
  | "unknown_error"

/**
 * Typed event map for the controller.
 */
export type WaveformEventMap = {
  state: { prev: WaveformState; next: WaveformState }
  error: { code: WaveformErrorCode; message: string; error?: Error }
  ready: { wavBlob: Blob } // Always audio/wav at target SR
  duration: { ms: number } // While recording (elapsed)
  timeupdate: { currentTime: number } // While playing
  permissionDenied: Record<string, never>
}

/**
 * The main controller interface that parent components interact with.
 * Provides an imperative API for controlling recording and playback.
 */
export interface WaveformController {
  // RECORDING
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob> // Returns WAV blob
  cancelRecording: () => void

  // PLAYBACK
  load: (src: Blob | string) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  seek: (seconds: number) => void

  // STATE
  getState: () => WaveformState
  getCapabilities: () => WaveformControllerCapabilities
  getDurationMs: () => number
  getCurrentTimeMs: () => number
  clear: () => void // Clear loaded audio and go to idle
  destroy: () => void // Clean up all resources

  // VISUALIZATION
  mountVisualizer: (el: HTMLElement) => void
  unmountVisualizer: () => void
  setAccentColor: (color: string) => void

  // EVENTS (typed)
  on: <K extends keyof WaveformEventMap>(
    event: K,
    handler: (data: WaveformEventMap[K]) => void
  ) => void
  off: <K extends keyof WaveformEventMap>(
    event: K,
    handler: (data: WaveformEventMap[K]) => void
  ) => void
}

/**
 * Configuration options for the controller.
 */
export interface WaveformControllerOptions {
  sampleRate?: number // Target sample rate for WAV encoding (default: 16000)
  autoLoadOnReady?: boolean // Auto-load into playback after recording (default: true)
  mode?: WaveformMode // Recording backend selection
  waveformHeight?: number // Visualization height in pixels
  waveformColor?: string // Default waveform color
  progressColor?: string // Playback progress color
  recordingColor?: string // Color during recording (e.g., red)
  audioConstraints?: MediaTrackConstraints // Custom getUserMedia constraints
}

/**
 * Backend interface for recording implementations.
 * Allows swapping between WaveSurfer and native MediaRecorder.
 */
export interface RecordingBackend {
  initialize: () => Promise<void>
  startRecording: (constraints?: MediaTrackConstraints) => Promise<void>
  stopRecording: () => Promise<Blob>
  cancelRecording: () => void
  mountVisualizer: (el: HTMLElement) => void
  unmountVisualizer: () => void
  setOptions: (options: Partial<WaveformControllerOptions>) => void
  destroy: () => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
}

/**
 * Backend interface for playback implementations.
 */
export interface PlaybackBackend {
  load: (src: Blob | string) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  seek: (seconds: number) => void
  getDuration: () => number
  getCurrentTime: () => number
  mountVisualizer: (el: HTMLElement) => void
  unmountVisualizer: () => void
  setOptions: (options: Partial<WaveformControllerOptions>) => void
  destroy: () => void
  on: (event: string, handler: (...args: unknown[]) => void) => void
  off: (event: string, handler: (...args: unknown[]) => void) => void
}

/**
 * Props for the presentational WaveformSurface component.
 */
export interface WaveformSurfaceProps {
  controller: WaveformController
  showTimer?: boolean
  height?: number
  accentColor?: string
  className?: string
  ariaLabel?: string
}
