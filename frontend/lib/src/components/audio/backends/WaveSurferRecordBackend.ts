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

import type WaveSurfer from "wavesurfer.js"
import type RecordPlugin from "wavesurfer.js/dist/plugins/record"

import type {
  RecordingBackend,
  WaveformControllerOptions,
} from "~lib/components/audio/core/types"

/**
 * WaveSurfer-based recording backend with live waveform visualization.
 * Uses the RecordPlugin for real-time waveform during recording.
 */
export class WaveSurferRecordBackend implements RecordingBackend {
  private wavesurfer: WaveSurfer | null = null
  private recordPlugin: RecordPlugin | null = null
  private container: HTMLElement | null = null
  private pendingContainer: HTMLElement | null = null
  private mediaStream: MediaStream | null = null
  private options: Partial<WaveformControllerOptions> = {}
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()
  private isInitialized = false
  private recordingBlob: Blob | null = null
  private cancelRequested = false

  constructor(options: Partial<WaveformControllerOptions> = {}) {
    this.options = {
      waveformHeight: 56,
      waveformColor: options.waveformColor || "transparent",
      progressColor: options.progressColor || "transparent",
      recordingColor: options.recordingColor || "transparent",
      ...options,
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    // SSR guard - skip initialization if no DOM
    if (typeof document === "undefined") {
      return
    }

    // Lazy load WaveSurfer to avoid SSR issues
    const [WaveSurferModule, RecordModule] = await Promise.all([
      import("wavesurfer.js"),
      import("wavesurfer.js/dist/plugins/record"),
    ])

    const WaveSurfer = WaveSurferModule.default
    const RecordPlugin = RecordModule.default

    if (!this.container) {
      // Create a temporary container if none mounted yet
      this.container = document.createElement("div")
      this.container.style.visibility = "hidden"
      this.container.style.position = "absolute"
      document.body.appendChild(this.container)
    }

    this.wavesurfer = WaveSurfer.create({
      container: this.container,
      waveColor: this.options.recordingColor || "transparent",
      progressColor: this.options.progressColor || "transparent",
      cursorColor: "transparent",
      height: this.options.waveformHeight || 56,
      barWidth: 2,
      barGap: 2,
      barRadius: undefined,
      normalize: true,
      interact: false,
    })

    const recordOptions: Record<string, unknown> = {
      scrollingWaveform: false,
      renderRecordedAudio: false,
      mimeType: "audio/webm",
    }

    this.recordPlugin = this.wavesurfer.registerPlugin(
      RecordPlugin.create(recordOptions)
    )

    // Wire up internal events
    this.recordPlugin.on("record-progress", (time: number) => {
      this.emit("progress", time * 1000) // Convert to ms
    })

    // NOTE: No persistent "record-end" listener here to avoid race conditions
    // with the scoped handler in stopRecording(). The scoped handler will
    // properly check cancelRequested flag.

    this.isInitialized = true
  }

  async startRecording(
    constraints: MediaTrackConstraints = {}
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (!this.recordPlugin) {
      throw new Error("RecordPlugin not initialized")
    }

    // Clean up any existing stream
    this.stopMediaStream()

    // Apply sample rate if specified
    const audioConstraints: MediaTrackConstraints = {
      ...constraints,
    }

    if (this.options.sampleRate) {
      audioConstraints.sampleRate = { ideal: this.options.sampleRate }
    }

    // Set recording color
    if (this.wavesurfer && this.options.recordingColor) {
      this.wavesurfer.setOptions({
        waveColor: this.options.recordingColor,
      })
    }

    try {
      await this.recordPlugin.startRecording(audioConstraints)
      // Only emit after successful start
      this.emit("recordStart")
      // Media stream policy: The RecordPlugin owns and manages the MediaStream.
      // It acquires the stream internally and stops all tracks when stopRecording() is called.
      // We don't maintain a reference to avoid dual ownership issues.
    } catch (error) {
      this.emit("error", error)
      throw error
    }
  }

  async stopRecording(): Promise<Blob> {
    if (!this.recordPlugin?.isRecording()) {
      throw new Error("Not currently recording")
    }

    return new Promise<Blob>((resolve, reject) => {
      if (!this.recordPlugin) {
        reject(new Error("RecordPlugin not initialized"))
        return
      }

      const handleRecordEnd = (blob: Blob): void => {
        // Use the detachEvent helper for compatibility
        this.detachEvent(this.recordPlugin, "record-end", handleRecordEnd)
        this.stopMediaStream()

        // Check if this was actually a cancel
        if (this.cancelRequested) {
          this.cancelRequested = false
          // Treat as canceled: do not resolve a blob
          reject(new Error("Recording canceled"))
          return
        }

        // Reset waveform color
        if (this.wavesurfer && this.options.waveformColor) {
          this.wavesurfer.setOptions({
            waveColor: this.options.waveformColor,
          })
        }

        resolve(blob)
      }

      // Use the attachEvent helper for compatibility
      this.attachEvent(this.recordPlugin, "record-end", handleRecordEnd)
      this.recordPlugin.stopRecording()

      // Apply pending container change if any
      if (this.pendingContainer) {
        const pending = this.pendingContainer
        this.pendingContainer = null
        this.mountVisualizer(pending)
      }
    })
  }

  cancelRecording(): void {
    if (this.recordPlugin?.isRecording()) {
      this.cancelRequested = true
      this.recordPlugin.stopRecording() // will fire "record-end"; we will ignore it
      this.recordingBlob = null
    }
    this.stopMediaStream()

    // Reset waveform
    if (this.wavesurfer) {
      this.wavesurfer.empty()
      if (this.options.waveformColor) {
        this.wavesurfer.setOptions({
          waveColor: this.options.waveformColor,
        })
      }
    }

    this.emit("recordCancel")
  }

  mountVisualizer(el: HTMLElement): void {
    if (this.container === el) return // Already mounted

    // Don't change container if actively recording
    if (this.recordPlugin?.isRecording()) {
      // Queue the mount for after recording stops
      this.pendingContainer = el
      return
    }

    this.pendingContainer = null

    // SSR guard for DOM operations
    if (typeof document !== "undefined") {
      // If we have a temporary container, remove it
      if (this.container?.parentNode === document.body) {
        document.body.removeChild(this.container)
      }
    }

    this.container = el

    // Update WaveSurfer container if already initialized
    if (this.isInitialized && this.wavesurfer) {
      try {
        // Use setOptions to update container without destroying
        this.wavesurfer.setOptions({ container: el })
      } catch {
        // Fallback: recreate WaveSurfer with new container
        void this.recreateWaveSurfer(el)
      }
    }
  }

  private async recreateWaveSurfer(el: HTMLElement): Promise<void> {
    if (this.recordPlugin?.isRecording()) {
      throw new Error("Cannot recreate WaveSurfer while recording")
    }

    // Save current state
    const wasInitialized = this.isInitialized

    // Destroy old instance
    if (this.wavesurfer) {
      this.wavesurfer.destroy()
      this.wavesurfer = null
    }

    if (this.recordPlugin) {
      this.recordPlugin.destroy()
      this.recordPlugin = null
    }

    this.isInitialized = false

    // Reinitialize with new container
    if (wasInitialized) {
      this.container = el
      await this.initialize()
    }
  }

  /**
   * Unmounts the visualizer without destroying the backend.
   * This only hides the container visually but keeps the WaveSurfer instance alive
   * for quick remounting. The backend remains fully functional and can be remounted
   * by calling mountVisualizer() again.
   */
  unmountVisualizer(): void {
    // Don't destroy, just hide
    if (this.container) {
      this.container.style.visibility = "hidden"
    }
  }

  setOptions(options: Partial<WaveformControllerOptions>): void {
    this.options = { ...this.options, ...options }

    if (this.wavesurfer) {
      const updates: Record<string, unknown> = {}

      if (options.waveformHeight !== undefined) {
        updates.height = options.waveformHeight
      }
      if (options.waveformColor !== undefined) {
        updates.waveColor = options.waveformColor
      }
      if (options.progressColor !== undefined) {
        updates.progressColor = options.progressColor
      }

      if (Object.keys(updates).length > 0) {
        this.wavesurfer.setOptions(updates)
      }
    }
  }

  destroy(): void {
    this.stopMediaStream()

    if (this.recordPlugin) {
      if (this.recordPlugin.isRecording()) {
        this.recordPlugin.stopRecording()
      }
      this.recordPlugin.destroy()
      this.recordPlugin = null
    }

    if (this.wavesurfer) {
      this.wavesurfer.destroy()
      this.wavesurfer = null
    }

    // SSR guard for DOM operations
    if (typeof document !== "undefined") {
      // Clean up temporary container if we created one
      if (this.container?.parentNode === document.body) {
        document.body.removeChild(this.container)
      }
    }

    this.container = null
    this.pendingContainer = null
    this.isInitialized = false
    this.eventHandlers.clear()
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.add(handler)
    } else {
      this.eventHandlers.set(event, new Set([handler]))
    }
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: string, ...args: unknown[]): void {
    this.eventHandlers.get(event)?.forEach(handler => {
      try {
        handler(...args)
      } catch {
        // Silently ignore handler errors
      }
    })
  }

  private stopMediaStream(): void {
    // Note: mediaStream is kept for potential future use if we switch to Policy A
    // (acquiring stream ourselves). Currently the plugin owns the stream (Policy B).
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
  }

  // Event helper for cross-version compatibility with WaveSurfer
  private attachEvent(
    emitter: any,
    evt: string,
    handler: (...args: any[]) => void
  ): void {
    if (typeof emitter?.on === "function") {
      emitter.on(evt, handler)
    } else if (typeof emitter?.addEventListener === "function") {
      emitter.addEventListener(evt, handler)
    }
  }

  private detachEvent(
    emitter: any,
    evt: string,
    handler: (...args: any[]) => void
  ): void {
    if (typeof emitter?.un === "function") {
      emitter.un(evt, handler)
    } else if (typeof emitter?.off === "function") {
      emitter.off(evt, handler)
    } else if (typeof emitter?.removeEventListener === "function") {
      emitter.removeEventListener(evt, handler)
    }
  }
}
