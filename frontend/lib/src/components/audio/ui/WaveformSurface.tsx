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

import React, { memo, useEffect, useRef, useState } from "react"

import styled from "@emotion/styled"

import type {
  WaveformController,
  WaveformState,
} from "~lib/components/audio/core/types"
import formatTime from "~lib/components/audio/formatTime"

export interface WaveformSurfaceProps {
  controller: WaveformController
  showTimer?: boolean
  height?: number
  accentColor?: string
  className?: string
  ariaLabel?: string
}

const StyledWaveformContainer = styled.div<{ $height: number }>(
  ({ $height }) => ({
    position: "relative",
    width: "100%",
    height: `${$height}px`,
    display: "flex",
    alignItems: "center",
  })
)

const StyledWaveformVisualizer = styled.div({
  flex: 1,
  height: "100%",
  position: "relative",
})

const StyledTimer = styled.div(({ theme }) => ({
  position: "absolute" as const,
  right: theme.spacing.sm,
  bottom: theme.spacing.twoXS,
  fontFamily: theme.fonts.mono,
  fontSize: theme.fontSizes.sm,
  color: theme.colors.fadedText60,
  lineHeight: "1em",
  userSelect: "none" as const,
  pointerEvents: "none" as const,
}))

/**
 * Presentational component that displays a waveform visualization
 * and optional timer. No business logic or buttons - purely visual.
 */
const WaveformSurface: React.FC<WaveformSurfaceProps> = ({
  controller,
  showTimer = false,
  height = 56,
  accentColor,
  className,
  ariaLabel,
}) => {
  const visualizerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<WaveformState>(() =>
    controller.getState()
  )
  const [timeMs, setTimeMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)

  // Mount visualizer on mount
  useEffect(() => {
    if (visualizerRef.current) {
      controller.mountVisualizer(visualizerRef.current)
    }

    return () => {
      controller.unmountVisualizer()
    }
  }, [controller])

  // Subscribe to state changes
  useEffect(() => {
    const handleStateChange = (data: {
      prev: WaveformState
      next: WaveformState
    }): void => {
      setState(data.next)
    }

    const handleTimeUpdate = (data: { currentTime: number }): void => {
      setTimeMs(data.currentTime)
    }

    const handleDuration = (data: { ms: number }): void => {
      setDurationMs(data.ms)
    }

    controller.on("state", handleStateChange)
    controller.on("timeupdate", handleTimeUpdate)
    controller.on("duration", handleDuration)

    // Get initial values
    setState(controller.getState())
    setTimeMs(controller.getCurrentTimeMs())
    setDurationMs(controller.getDurationMs())

    return () => {
      controller.off("state", handleStateChange)
      controller.off("timeupdate", handleTimeUpdate)
      controller.off("duration", handleDuration)
    }
  }, [controller])

  // Apply accent color for recording state
  useEffect(() => {
    if (accentColor && state === "recording") {
      controller.setAccentColor(accentColor)
    }
  }, [controller, accentColor, state])

  // Determine what time to show
  const displayTime = (): string => {
    switch (state) {
      case "recording":
      case "playing":
        return formatTime(timeMs)
      case "ready":
      case "paused":
        // Show current position or duration
        return formatTime(timeMs || durationMs)
      case "stopping":
        return formatTime(durationMs)
      default:
        return "00:00"
    }
  }

  // Hide timer in certain states
  const shouldShowTimer =
    showTimer &&
    state !== "idle" &&
    state !== "requesting_mic" &&
    state !== "error"

  return (
    <StyledWaveformContainer
      className={className}
      $height={height}
      aria-label={ariaLabel || "Audio waveform"}
      role="img"
    >
      <StyledWaveformVisualizer
        ref={visualizerRef}
        data-testid="waveform-visualizer"
      />
      {shouldShowTimer && (
        <StyledTimer data-testid="waveform-timer">{displayTime()}</StyledTimer>
      )}
    </StyledWaveformContainer>
  )
}

export default memo(WaveformSurface)
