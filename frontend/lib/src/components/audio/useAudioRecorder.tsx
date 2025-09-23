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

import WaveSurfer from "wavesurfer.js"
import RecordPlugin from "wavesurfer.js/dist/plugins/record"

import { useEmotionTheme } from "~lib/hooks/useEmotionTheme"

export interface UseAudioRecorderOptions {
  waveformContainer?: HTMLElement | null
  sampleRate?: number | null
  onRecordingStop?: (blob: Blob) => void
  onRecordingError?: (error: Error) => void
  onTimeUpdate?: (time: number) => void
  showWaveform?: boolean
}

export interface UseAudioRecorderReturn {
  isRecording: boolean
  recordingTime: number
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | undefined>
  hasPermission: boolean | null
  wavesurfer: WaveSurfer | null
  recordPlugin: RecordPlugin | null
}

/**
 * Custom hook for audio recording using WaveSurfer's RecordPlugin.
 * Extracted from AudioInput to be reused in ChatInput.
 */
export function useAudioRecorder(
  options: UseAudioRecorderOptions = {}
): UseAudioRecorderReturn {
  const {
    waveformContainer,
    sampleRate,
    onRecordingStop,
    onRecordingError,
    onTimeUpdate,
    showWaveform = true,
  } = options

  const theme = useEmotionTheme()
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null)
  const [recordPlugin, setRecordPlugin] = useState<RecordPlugin | null>(null)

  const recordPluginRef = useRef<RecordPlugin | null>(null)
  const handlersRef = useRef<{
    handleRecordProgress?: (time: number) => void
  }>({})

  const initializeWaveSurfer = useCallback(() => {
    if (!waveformContainer || !showWaveform) return null

    const BAR_WIDTH = 2
    const BAR_RADIUS = 2
    const CURSOR_WIDTH = 1
    const HEIGHT = 50
    const BAR_GAP = 2

    const ws = WaveSurfer.create({
      container: waveformContainer,
      waveColor: theme.colors.primary,
      progressColor: theme.colors.bodyText,
      cursorColor: theme.colors.primary,
      barWidth: BAR_WIDTH,
      barRadius: BAR_RADIUS,
      cursorWidth: CURSOR_WIDTH,
      height: HEIGHT,
      barGap: BAR_GAP,
      normalize: true,
      interact: false,
    })

    const recordOptions: Record<string, unknown> = {
      scrollingWaveform: false,
      renderRecordedAudio: false,
    }

    if (sampleRate) {
      recordOptions.sampleRate = sampleRate
    }

    try {
      const record = ws.registerPlugin(RecordPlugin.create(recordOptions))
      recordPluginRef.current = record

      const handleRecordProgress = (time: number): void => {
        setRecordingTime(time)
        onTimeUpdate?.(time)
      }

      record.on("record-progress", handleRecordProgress)

      handlersRef.current = {
        handleRecordProgress,
      }

      setWavesurfer(ws)
      setRecordPlugin(record)
      return ws
    } catch (err) {
      onRecordingError?.(
        err instanceof Error ? err : new Error("Failed to initialize recorder")
      )
      ws.destroy()
      return null
    }
  }, [
    waveformContainer,
    showWaveform,
    theme,
    sampleRate,
    onTimeUpdate,
    onRecordingError,
  ])

  const startRecording = useCallback(async () => {
    try {
      let plugin = recordPlugin

      // Initialize if needed
      if (!plugin && waveformContainer && showWaveform) {
        initializeWaveSurfer()
        plugin = recordPluginRef.current
      }

      // For non-waveform recording, use the plugin directly
      if (!plugin) {
        const recordOptions: Record<string, unknown> = {
          scrollingWaveform: false,
          renderRecordedAudio: false,
        }

        if (sampleRate) {
          recordOptions.sampleRate = sampleRate
        }

        plugin = RecordPlugin.create(recordOptions)
        recordPluginRef.current = plugin

        const handleRecordProgress = (time: number): void => {
          setRecordingTime(time)
          onTimeUpdate?.(time)
        }

        plugin.on("record-progress", handleRecordProgress)
        handlersRef.current = { handleRecordProgress }
        setRecordPlugin(plugin)
      }

      const audioConstraints: MediaTrackConstraints = {}
      if (sampleRate) {
        audioConstraints.sampleRate = sampleRate
      }

      await plugin.startRecording(audioConstraints)
      setIsRecording(true)
      setHasPermission(true)
      setRecordingTime(0)
    } catch (err) {
      setHasPermission(false)
      onRecordingError?.(
        err instanceof Error ? err : new Error("Failed to start recording")
      )
      setIsRecording(false)
    }
  }, [
    recordPlugin,
    waveformContainer,
    showWaveform,
    initializeWaveSurfer,
    sampleRate,
    onTimeUpdate,
    onRecordingError,
  ])

  const stopRecording = useCallback(async (): Promise<Blob | undefined> => {
    if (!recordPluginRef.current || !isRecording) {
      return undefined
    }

    return new Promise<Blob>(resolve => {
      const plugin = recordPluginRef.current
      if (!plugin) {
        return
      }

      const handleRecordEnd = (blob: Blob): void => {
        plugin.un("record-end", handleRecordEnd)
        setIsRecording(false)
        setRecordingTime(0)
        onRecordingStop?.(blob)
        resolve(blob)
      }

      plugin.on("record-end", handleRecordEnd)
      plugin.stopRecording()
    })
  }, [isRecording, onRecordingStop])

  // Cleanup
  useEffect(() => {
    return () => {
      if (recordPluginRef.current) {
        if (recordPluginRef.current.isRecording()) {
          recordPluginRef.current.stopRecording()
        }
        const handlers = handlersRef.current
        if (handlers.handleRecordProgress) {
          recordPluginRef.current.un(
            "record-progress",
            handlers.handleRecordProgress
          )
        }
        recordPluginRef.current.destroy()
      }
      if (wavesurfer) {
        wavesurfer.destroy()
      }
    }
  }, [wavesurfer])

  return {
    isRecording,
    recordingTime,
    startRecording,
    stopRecording,
    hasPermission,
    wavesurfer,
    recordPlugin,
  }
}
