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

import { useCallback, useEffect, useRef, useState } from "react"

import { WaveSurferRecordBackend } from "~lib/components/audio/backends/WaveSurferRecordBackend"
import encodeToWav from "~lib/components/audio/encodeToWav"
import { WaveSurferPlayer } from "~lib/components/audio/playback/WaveSurferPlayer"

import type {
  PlaybackBackend,
  RecordingBackend,
  WaveformController,
  WaveformControllerCapabilities,
  WaveformControllerOptions,
  WaveformEventMap,
  WaveformState,
} from "./types"

/**
 * Custom hook that creates a headless waveform controller.
 * Manages state machine, capabilities, and coordinates between
 * recording and playback backends.
 */
export function useWaveformController(
  options: WaveformControllerOptions = {}
): WaveformController {
  const {
    sampleRate = 16000,
    autoLoadOnReady = true,
    waveformHeight = 56,
    waveformColor,
    progressColor,
    recordingColor,
    audioConstraints = {},
  } = options

  // State
  const [state, setState] = useState<WaveformState>("idle")
  const [durationMs, setDurationMs] = useState(0)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)

  // Refs for backends and event handlers
  const recordingBackendRef = useRef<RecordingBackend | null>(null)
  const playbackBackendRef = useRef<PlaybackBackend | null>(null)
  const prevStateRef = useRef<WaveformState>("idle")
  type EventHandler = (data: WaveformEventMap[keyof WaveformEventMap]) => void
  const eventHandlersRef = useRef<
    Map<keyof WaveformEventMap, Set<EventHandler>>
  >(new Map())
  const visualizerElementRef = useRef<HTMLElement | null>(null)
  const lastRecordedBlobRef = useRef<Blob | null>(null)
  const isDestroyedRef = useRef(false)

  // Helper to emit events
  const emit = useCallback(
    <K extends keyof WaveformEventMap>(
      event: K,
      data: WaveformEventMap[K]
    ) => {
      const handlers = eventHandlersRef.current.get(event)
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(data)
          } catch {
            // Silently ignore handler errors
          }
        })
      }
    },
    []
  )

  // State transition with validation
  const transitionTo = useCallback(
    (nextState: WaveformState) => {
      const prevState = prevStateRef.current
      if (prevState === nextState) return

      // Validate transitions
      const validTransitions: Partial<Record<WaveformState, WaveformState[]>> =
        {
          idle: ["requesting_mic", "error"],
          requesting_mic: ["recording", "idle", "error"],
          recording: ["stopping", "idle", "error"],
          stopping: ["ready", "error"],
          ready: ["playing", "requesting_mic", "idle", "error"],
          playing: ["paused", "ready", "error"],
          paused: ["playing", "ready", "idle", "error"],
          error: ["idle"],
        }

      const allowed = validTransitions[prevState]
      if (!allowed?.includes(nextState)) {
        return
      }

      prevStateRef.current = nextState
      setState(nextState)
      emit("state", { prev: prevState, next: nextState })
    },
    [emit]
  )

  // Compute capabilities based on current state
  const getCapabilities = useCallback((): WaveformControllerCapabilities => {
    return {
      canStartRecording: state === "idle" || state === "ready",
      canStopRecording: state === "recording",
      canCancelRecording: state === "recording" || state === "requesting_mic",
      canPlay: state === "ready" || state === "paused",
      canPause: state === "playing",
      canSeek: state === "ready" || state === "playing" || state === "paused",
      canClear: state === "ready" || state === "paused",
    }
  }, [state])

  // Initialize recording backend lazily
  const getRecordingBackend =
    useCallback(async (): Promise<RecordingBackend> => {
      if (!recordingBackendRef.current) {
        try {
          recordingBackendRef.current = new WaveSurferRecordBackend({
            sampleRate,
            waveformHeight,
            waveformColor,
            progressColor,
            recordingColor,
          })

          // Wire up events
          recordingBackendRef.current.on("progress", (...args: unknown[]) => {
            const ms = args[0] as number
            setDurationMs(ms)
            setCurrentTimeMs(ms)
            emit("duration", { ms })
            emit("timeupdate", { currentTime: ms })
          })

          recordingBackendRef.current.on("error", (...args: unknown[]) => {
            const error = args[0] as Error
            transitionTo("error")
            emit("error", {
              code: "recorder_unavailable",
              message: error.message,
              error,
            })
          })

          await recordingBackendRef.current.initialize()

          // Mount visualizer if element is available
          if (visualizerElementRef.current) {
            recordingBackendRef.current.mountVisualizer(
              visualizerElementRef.current
            )
          }
        } catch (error) {
          // WaveSurfer or Record plugin unavailable
          recordingBackendRef.current = null
          transitionTo("error")
          emit("error", {
            code: "wavesurfer_unavailable",
            message:
              "WaveSurfer Record plugin is required but unavailable: " +
              (error as Error).message,
            error: error as Error,
          })
          throw error
        }
      }
      return recordingBackendRef.current
    }, [
      sampleRate,
      waveformHeight,
      waveformColor,
      progressColor,
      recordingColor,
      emit,
      transitionTo,
    ])

  // Initialize playback backend lazily
  const getPlaybackBackend = useCallback((): PlaybackBackend => {
    if (!playbackBackendRef.current) {
      try {
        playbackBackendRef.current = new WaveSurferPlayer({
          waveformHeight,
          waveformColor,
          progressColor,
        })

        // Wire up events
        playbackBackendRef.current.on("ready", () => {
          // Duration is set when ready event fires
        })

        playbackBackendRef.current.on("duration", (...args: unknown[]) => {
          const ms = args[0] as number
          setDurationMs(ms)
          emit("duration", { ms })
        })

        playbackBackendRef.current.on("timeupdate", (...args: unknown[]) => {
          const ms = args[0] as number
          setCurrentTimeMs(ms)
          emit("timeupdate", { currentTime: ms })
        })

        playbackBackendRef.current.on("play", () => {
          if (prevStateRef.current !== "playing") {
            transitionTo("playing")
          }
        })

        playbackBackendRef.current.on("pause", () => {
          if (prevStateRef.current === "playing") {
            transitionTo("paused")
          }
        })

        playbackBackendRef.current.on("finish", () => {
          transitionTo("ready")
          setCurrentTimeMs(0)
        })

        playbackBackendRef.current.on("error", (...args: unknown[]) => {
          const error = args[0] as Error
          transitionTo("error")
          emit("error", {
            code: "wavesurfer_unavailable",
            message: error.message,
            error,
          })
        })

        // Mount visualizer if element is available
        if (visualizerElementRef.current) {
          playbackBackendRef.current.mountVisualizer(
            visualizerElementRef.current
          )
        }
      } catch (error) {
        // WaveSurfer Player unavailable
        playbackBackendRef.current = null
        transitionTo("error")
        emit("error", {
          code: "wavesurfer_unavailable",
          message:
            "WaveSurfer Player is required but unavailable: " +
            (error as Error).message,
          error: error as Error,
        })
        throw error
      }
    }
    if (!playbackBackendRef.current) {
      throw new Error("Playback backend not initialized")
    }
    return playbackBackendRef.current
  }, [waveformHeight, waveformColor, progressColor, emit, transitionTo])

  // Controller methods
  const startRecording = useCallback(async (): Promise<void> => {
    if (isDestroyedRef.current) return

    const caps = getCapabilities()
    if (!caps.canStartRecording) {
      throw new Error(`Cannot start recording in state: ${state}`)
    }

    transitionTo("requesting_mic")

    try {
      const backend = await getRecordingBackend()
      if (isDestroyedRef.current) return

      await backend.startRecording(audioConstraints)
      if (isDestroyedRef.current) return

      // Double-check state after async operation
      if (prevStateRef.current !== "requesting_mic") return

      transitionTo("recording")
    } catch (error) {
      transitionTo("idle")
      if (
        error instanceof Error &&
        (error.name === "NotAllowedError" ||
          error.name === "PermissionDeniedError")
      ) {
        emit("permissionDenied", {})
      }
      emit("error", {
        code: "permission_denied",
        message: (error as Error).message,
        error: error as Error,
      })
      throw error
    }
  }, [
    state,
    getCapabilities,
    getRecordingBackend,
    audioConstraints,
    transitionTo,
    emit,
  ])

  const stopRecording = useCallback(async (): Promise<Blob> => {
    if (isDestroyedRef.current) {
      throw new Error("Controller is destroyed")
    }

    const caps = getCapabilities()
    if (!caps.canStopRecording) {
      throw new Error(`Cannot stop recording in state: ${state}`)
    }

    transitionTo("stopping")

    try {
      const backend = await getRecordingBackend()
      if (isDestroyedRef.current) throw new Error("Controller destroyed")

      const rawBlob = await backend.stopRecording()
      if (isDestroyedRef.current) throw new Error("Controller destroyed")

      // Convert to WAV format
      const wavBlob = await encodeToWav(rawBlob, sampleRate)
      if (isDestroyedRef.current) throw new Error("Controller destroyed")
      if (!wavBlob) {
        throw new Error("Failed to encode audio to WAV")
      }

      lastRecordedBlobRef.current = wavBlob

      // Conditionally load into playback backend
      if (autoLoadOnReady) {
        const playback = getPlaybackBackend()
        if (isDestroyedRef.current) throw new Error("Controller destroyed")

        await playback.load(wavBlob)
        if (isDestroyedRef.current) throw new Error("Controller destroyed")
      }

      transitionTo("ready")
      emit("ready", { wavBlob })

      return wavBlob
    } catch (error) {
      transitionTo("error")
      emit("error", {
        code: "encoder_failed",
        message: (error as Error).message,
        error: error as Error,
      })
      throw error
    }
  }, [
    state,
    getCapabilities,
    getRecordingBackend,
    getPlaybackBackend,
    sampleRate,
    autoLoadOnReady,
    transitionTo,
    emit,
  ])

  const cancelRecording = useCallback((): void => {
    if (isDestroyedRef.current) return

    const caps = getCapabilities()
    if (!caps.canCancelRecording) {
      return
    }

    if (recordingBackendRef.current) {
      recordingBackendRef.current.cancelRecording()
    }

    transitionTo("idle")
    setDurationMs(0)
    setCurrentTimeMs(0)
  }, [getCapabilities, transitionTo])

  const load = useCallback(
    async (src: Blob | string): Promise<void> => {
      if (isDestroyedRef.current) return

      if (state === "recording" || state === "requesting_mic") {
        throw new Error("Cannot load while recording")
      }

      try {
        const backend = getPlaybackBackend()
        await backend.load(src)
        transitionTo("ready")
        if (src instanceof Blob) {
          lastRecordedBlobRef.current = src
        }
      } catch (error) {
        transitionTo("error")
        emit("error", {
          code: "wavesurfer_unavailable",
          message: (error as Error).message,
          error: error as Error,
        })
        throw error
      }
    },
    [state, getPlaybackBackend, transitionTo, emit]
  )

  const play = useCallback(async (): Promise<void> => {
    if (isDestroyedRef.current) return

    const caps = getCapabilities()
    if (!caps.canPlay) {
      throw new Error(`Cannot play in state: ${state}`)
    }

    try {
      const backend = getPlaybackBackend()
      await backend.play()
      // State transition handled by backend event
    } catch (error) {
      emit("error", {
        code: "wavesurfer_unavailable",
        message: (error as Error).message,
        error: error as Error,
      })
      throw error
    }
  }, [state, getCapabilities, getPlaybackBackend, emit])

  const pause = useCallback((): void => {
    if (isDestroyedRef.current) return

    const caps = getCapabilities()
    if (!caps.canPause) {
      return
    }

    if (playbackBackendRef.current) {
      playbackBackendRef.current.pause()
      // State transition handled by backend event
    }
  }, [getCapabilities])

  const seek = useCallback(
    (seconds: number): void => {
      if (isDestroyedRef.current) return

      const caps = getCapabilities()
      if (!caps.canSeek) {
        return
      }

      if (playbackBackendRef.current) {
        playbackBackendRef.current.seek(seconds)
        setCurrentTimeMs(seconds * 1000)
      }
    },
    [getCapabilities]
  )

  const clear = useCallback((): void => {
    if (isDestroyedRef.current) return

    const caps = getCapabilities()
    if (!caps.canClear) {
      return
    }

    // Stop playback if playing
    if (state === "playing" && playbackBackendRef.current) {
      playbackBackendRef.current.pause()
    }

    lastRecordedBlobRef.current = null
    setDurationMs(0)
    setCurrentTimeMs(0)
    transitionTo("idle")

    // Clear waveform display
    if (recordingBackendRef.current) {
      recordingBackendRef.current.cancelRecording()
    }
  }, [state, getCapabilities, transitionTo])

  const mountVisualizer = useCallback((el: HTMLElement): void => {
    if (isDestroyedRef.current) return

    visualizerElementRef.current = el

    // Mount to whichever backend is active or was last used
    if (playbackBackendRef.current) {
      playbackBackendRef.current.mountVisualizer(el)
    } else if (recordingBackendRef.current) {
      recordingBackendRef.current.mountVisualizer(el)
    }
    // If no backend yet, it will be mounted when backend is created
  }, [])

  const unmountVisualizer = useCallback((): void => {
    if (recordingBackendRef.current) {
      recordingBackendRef.current.unmountVisualizer()
    }
    if (playbackBackendRef.current) {
      playbackBackendRef.current.unmountVisualizer()
    }
    visualizerElementRef.current = null
  }, [])

  const setAccentColor = useCallback((color: string): void => {
    if (recordingBackendRef.current) {
      recordingBackendRef.current.setOptions({ recordingColor: color })
    }
  }, [])

  const destroy = useCallback((): void => {
    isDestroyedRef.current = true

    // Clean up any blob URLs from last recording
    if (lastRecordedBlobRef.current instanceof Blob) {
      // Note: We can't revoke blob URLs we didn't create, but we clear the reference
      lastRecordedBlobRef.current = null
    }

    if (recordingBackendRef.current) {
      recordingBackendRef.current.destroy()
      recordingBackendRef.current = null
    }

    if (playbackBackendRef.current) {
      playbackBackendRef.current.destroy()
      playbackBackendRef.current = null
    }

    eventHandlersRef.current.clear()
    visualizerElementRef.current = null
  }, [])

  // Event subscription
  const on = useCallback(
    <K extends keyof WaveformEventMap>(
      event: K,
      handler: (data: WaveformEventMap[K]) => void
    ): void => {
      if (!eventHandlersRef.current.has(event)) {
        eventHandlersRef.current.set(event, new Set())
      }
      // Cast handler to EventHandler type for storage
      eventHandlersRef.current.get(event)?.add(handler as EventHandler)
    },
    []
  )

  const off = useCallback(
    <K extends keyof WaveformEventMap>(
      event: K,
      handler: (data: WaveformEventMap[K]) => void
    ): void => {
      // Cast handler to EventHandler type for deletion
      eventHandlersRef.current.get(event)?.delete(handler as EventHandler)
    },
    []
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroy()
    }
  }, [destroy])

  // Create controller object
  const controller: WaveformController = {
    // Recording
    startRecording,
    stopRecording,
    cancelRecording,

    // Playback
    load,
    play,
    pause,
    seek,

    // State
    getState: () => state,
    getCapabilities,
    getDurationMs: () => durationMs,
    getCurrentTimeMs: () => currentTimeMs,
    clear,
    destroy,

    // Visualization
    mountVisualizer,
    unmountVisualizer,
    setAccentColor,

    // Events
    on,
    off,
  }

  return controller
}
