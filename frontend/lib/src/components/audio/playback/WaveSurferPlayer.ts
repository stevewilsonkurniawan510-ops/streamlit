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

import type {
  PlaybackBackend,
  WaveformControllerOptions,
} from "~lib/components/audio/core/types"

/**
 * WaveSurfer-based playback backend for playing recorded audio
 * with waveform visualization.
 */
export class WaveSurferPlayer implements PlaybackBackend {
  private wavesurfer: WaveSurfer | null = null
  private container: HTMLElement | null = null
  private options: Partial<WaveformControllerOptions> = {}
  private eventHandlers = new Map<string, Set<(...args: unknown[]) => void>>()
  private isInitialized = false
  private currentBlobUrl: string | null = null

  constructor(options: Partial<WaveformControllerOptions> = {}) {
    this.options = {
      waveformHeight: 56,
      waveformColor: options.waveformColor || "transparent",
      progressColor: options.progressColor || "transparent",
      ...options,
    }
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return

    // Lazy load WaveSurfer
    const WaveSurferModule = await import("wavesurfer.js")
    const WaveSurfer = WaveSurferModule.default

    if (!this.container) {
      // Create temporary container
      this.container = document.createElement("div")
      this.container.style.visibility = "hidden"
      this.container.style.position = "absolute"
      document.body.appendChild(this.container)
    }

    this.wavesurfer = WaveSurfer.create({
      container: this.container,
      waveColor: this.options.waveformColor || "transparent",
      progressColor: this.options.progressColor || "transparent",
      cursorColor: this.options.progressColor || "transparent",
      cursorWidth: 1,
      height: this.options.waveformHeight || 56,
      barWidth: 2,
      barGap: 2,
      barRadius: undefined,
      normalize: true,
      interact: true,
    })

    // Wire up events
    this.wavesurfer.on("ready", () => {
      this.emit("ready")
      this.emit("duration", this.getDuration() * 1000) // Convert to ms
    })

    this.wavesurfer.on("play", () => {
      this.emit("play")
    })

    this.wavesurfer.on("pause", () => {
      this.emit("pause")
    })

    this.wavesurfer.on("finish", () => {
      this.emit("finish")
    })

    this.wavesurfer.on("timeupdate", (currentTime: number) => {
      this.emit("timeupdate", currentTime * 1000) // Convert to ms
    })

    this.wavesurfer.on("error", (error: Error) => {
      this.emit("error", error)
    })

    this.wavesurfer.on("seeking", (progress: number) => {
      this.emit("seeking", progress)
    })

    this.isInitialized = true
  }

  async load(src: Blob | string): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (!this.wavesurfer) {
      throw new Error("WaveSurfer not initialized")
    }

    // Clean up previous blob URL if any BEFORE creating new one
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }

    let url: string
    if (src instanceof Blob) {
      url = URL.createObjectURL(src)
      this.currentBlobUrl = url
    } else {
      url = src
    }

    try {
      await this.wavesurfer.load(url)
    } catch (error) {
      // Clean up blob URL on error
      if (this.currentBlobUrl) {
        URL.revokeObjectURL(this.currentBlobUrl)
        this.currentBlobUrl = null
      }
      throw error
    }
  }

  async play(): Promise<void> {
    if (!this.wavesurfer) {
      throw new Error("WaveSurfer not initialized")
    }
    await this.wavesurfer.play()
  }

  pause(): void {
    if (!this.wavesurfer) {
      throw new Error("WaveSurfer not initialized")
    }
    this.wavesurfer.pause()
  }

  seek(seconds: number): void {
    if (!this.wavesurfer) {
      throw new Error("WaveSurfer not initialized")
    }

    const duration = this.wavesurfer.getDuration()
    if (duration > 0) {
      const progress = Math.max(0, Math.min(1, seconds / duration))
      this.wavesurfer.seekTo(progress)
    }
  }

  getDuration(): number {
    return this.wavesurfer?.getDuration() || 0
  }

  getCurrentTime(): number {
    return this.wavesurfer?.getCurrentTime() || 0
  }

  mountVisualizer(el: HTMLElement): void {
    if (this.container === el) return // Already mounted

    // Clean up temporary container if needed
    if (this.container?.parentNode === document.body) {
      document.body.removeChild(this.container)
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
    } else if (!this.isInitialized) {
      // Initialize with the provided container
      void this.initialize()
    }
  }

  private async recreateWaveSurfer(el: HTMLElement): Promise<void> {
    // Save current state
    const wasInitialized = this.isInitialized
    const currentUrl = this.currentBlobUrl

    // Destroy old instance
    if (this.wavesurfer) {
      if (this.wavesurfer.isPlaying()) {
        this.wavesurfer.pause()
      }
      this.wavesurfer.destroy()
      this.wavesurfer = null
    }

    this.isInitialized = false

    // Reinitialize with new container
    if (wasInitialized) {
      this.container = el
      await this.initialize()

      // Reload the audio if we had one
      if (currentUrl && this.wavesurfer) {
        await this.wavesurfer.load(currentUrl)
      }
    }
  }

  unmountVisualizer(): void {
    // Just hide, don't destroy
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
        updates.cursorColor = options.progressColor
      }

      if (Object.keys(updates).length > 0) {
        this.wavesurfer.setOptions(updates)
      }
    }
  }

  destroy(): void {
    // Clean up blob URL if any
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl)
      this.currentBlobUrl = null
    }

    if (this.wavesurfer) {
      if (this.wavesurfer.isPlaying()) {
        this.wavesurfer.pause()
      }
      this.wavesurfer.destroy()
      this.wavesurfer = null
    }

    // Clean up temporary container if we created one
    if (this.container?.parentNode === document.body) {
      document.body.removeChild(this.container)
    }

    this.container = null
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
}
