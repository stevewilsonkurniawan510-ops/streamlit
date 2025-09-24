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

import React, {
  memo,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { Delete, FileDownload } from "@emotion-icons/material-outlined"

import { AudioInput as AudioInputProto } from "@streamlit/protobuf"

import {
  useWaveformController,
  type WaveformState,
  WaveformSurface,
} from "~lib/components/audio"
import Toolbar, { ToolbarAction } from "~lib/components/shared/Toolbar"
import { Placement } from "~lib/components/shared/Tooltip"
import TooltipIcon from "~lib/components/shared/TooltipIcon"
import { WidgetLabel } from "~lib/components/widgets/BaseWidget"
import { FormClearHelper } from "~lib/components/widgets/Form"
import { FileUploadClient } from "~lib/FileUploadClient"
import { useEmotionTheme } from "~lib/hooks/useEmotionTheme"
import useWidgetManagerElementState from "~lib/hooks/useWidgetManagerElementState"
import { blend } from "~lib/theme/utils"
import { uploadFiles } from "~lib/util/uploadFiles"
import {
  isNullOrUndefined,
  labelVisibilityProtoValueToEnum,
  notNullOrUndefined,
} from "~lib/util/utils"
import { WidgetStateManager } from "~lib/WidgetStateManager"

import AudioInputActionButtons from "./AudioInputActionButtons"
import AudioInputErrorState from "./AudioInputErrorState"
import { STARTING_TIME_STRING } from "./constants"
import NoMicPermissions from "./NoMicPermissions"
import Placeholder from "./Placeholder"
import {
  StyledAudioInputContainerDiv,
  StyledWaveformContainerDiv,
  StyledWaveformInnerDiv,
  StyledWaveformTimeCode,
  StyledWaveSurferDiv,
  StyledWidgetLabelHelp,
} from "./styled-components"

export interface Props {
  element: AudioInputProto
  uploadClient: FileUploadClient
  widgetMgr: WidgetStateManager
  fragmentId?: string
  disabled: boolean
}

const AudioInput: React.FC<Props> = ({
  element,
  uploadClient,
  widgetMgr,
  fragmentId,
  disabled,
}): ReactElement => {
  const theme = useEmotionTheme()

  // State for URLs and file management
  const [deleteFileUrl, setDeleteFileUrl] = useWidgetManagerElementState<
    string | null
  >({
    widgetMgr,
    id: element.id,
    key: "deleteFileUrl",
    defaultValue: null,
  })

  const [recordingUrl, setRecordingUrl] = useWidgetManagerElementState<
    string | null
  >({
    widgetMgr,
    id: element.id,
    key: "recordingUrl",
    defaultValue: null,
  })

  // Local state
  const [hasNoMicPermissions, setHasNoMicPermissions] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isError, setIsError] = useState(false)
  const [displayTime, setDisplayTime] = useState(STARTING_TIME_STRING)
  const [waveformState, setWaveformState] = useState<WaveformState>("idle")

  const currentBlobRef = useRef<Blob | null>(null)
  const uploadAbortControllerRef = useRef<AbortController | null>(null)
  const widgetId = element.id
  const widgetFormId = element.formId
  const targetSampleRate = element.sampleRate || 16000

  // Use the new headless controller
  const controller = useWaveformController({
    sampleRate: targetSampleRate,
    waveformHeight: 50,
    waveformColor: blend(theme.colors.fadedText40, theme.colors.secondaryBg),
    progressColor: theme.colors.bodyText,
    recordingColor: theme.colors.primary,
  })

  // Upload handling
  const transcodeAndUploadFile = useCallback(
    async (blob: Blob) => {
      // Cancel any previous upload
      if (uploadAbortControllerRef.current) {
        uploadAbortControllerRef.current.abort()
      }

      // Create new abort controller for this upload
      const abortController = new AbortController()
      uploadAbortControllerRef.current = abortController

      try {
        setIsUploading(true)
        if (notNullOrUndefined(widgetFormId)) {
          widgetMgr.setFormsWithUploadsInProgress(new Set([widgetFormId]))
        }

        // Check if aborted before continuing
        if (abortController.signal.aborted) {
          return
        }

        // Create blob URL for local playback
        const blobUrl = URL.createObjectURL(blob)
        setRecordingUrl(blobUrl)

        // Load into controller for playback
        await controller.load(blob)

        const timestamp = new Date()
          .toISOString()
          .slice(0, 16)
          .replace(/:/g, "-")
        const file = new File([blob], `${timestamp}_audio.wav`, {
          type: blob.type,
        })

        try {
          const { successfulUploads, failedUploads } = await uploadFiles({
            files: [file],
            uploadClient,
            widgetMgr,
            widgetInfo: { id: widgetId, formId: widgetFormId },
            fragmentId,
            signal: abortController.signal,
          })

          // Check if aborted before processing results
          if (abortController.signal.aborted) {
            return
          }

          if (failedUploads.length > 0) {
            setIsError(true)
            return
          }

          setIsError(false)
          const upload = successfulUploads[0]
          if (upload?.fileUrl?.deleteUrl) {
            setDeleteFileUrl(upload.fileUrl.deleteUrl)
          }
        } catch {
          if (!abortController.signal.aborted) {
            setIsError(true)
          }
        } finally {
          if (notNullOrUndefined(widgetFormId)) {
            widgetMgr.setFormsWithUploadsInProgress(new Set())
          }
          if (!abortController.signal.aborted) {
            setIsUploading(false)
          }
        }
      } catch {
        if (!abortController.signal.aborted) {
          setIsError(true)
          setIsUploading(false)
        }
        if (notNullOrUndefined(widgetFormId)) {
          widgetMgr.setFormsWithUploadsInProgress(new Set())
        }
      }
    },
    [
      controller,
      uploadClient,
      widgetMgr,
      widgetId,
      widgetFormId,
      fragmentId,
      setDeleteFileUrl,
      setRecordingUrl,
    ]
  )

  // Subscribe to controller events
  useEffect(() => {
    const handleStateChange = (data: {
      prev: WaveformState
      next: WaveformState
    }): void => {
      setWaveformState(data.next)

      // Handle error states
      if (data.next === "error") {
        setIsError(true)
      }
    }

    const handleError = (_data: { message: string; error?: Error }): void => {
      setIsError(true)
    }

    const handlePermissionDenied = (_data: Record<string, never>): void => {
      setHasNoMicPermissions(true)
    }

    const handleReady = async (data: { wavBlob: Blob }): Promise<void> => {
      currentBlobRef.current = data.wavBlob
      await transcodeAndUploadFile(data.wavBlob)
    }

    const handleTimeUpdate = (data: { currentTime: number }): void => {
      const ms = data.currentTime
      const seconds = Math.floor(ms / 1000)
      const minutes = Math.floor(seconds / 60)
      const displaySec = (seconds % 60).toString().padStart(2, "0")
      const displayMin = minutes.toString().padStart(2, "0")
      setDisplayTime(`${displayMin}:${displaySec}`)
    }

    controller.on("state", handleStateChange)
    controller.on("error", handleError)
    controller.on("permissionDenied", handlePermissionDenied)
    controller.on("ready", data => void handleReady(data))
    controller.on("timeupdate", handleTimeUpdate)

    return () => {
      controller.off("state", handleStateChange)
      controller.off("error", handleError)
      controller.off("permissionDenied", handlePermissionDenied)
      controller.off("ready", data => void handleReady(data))
      controller.off("timeupdate", handleTimeUpdate)
    }
  }, [controller, transcodeAndUploadFile])

  // Clear handling
  const handleClear = useCallback(
    async ({
      updateWidgetManager,
      deleteFile,
    }: {
      updateWidgetManager: boolean
      deleteFile: boolean
    }): Promise<void> => {
      // Clean up blob URL
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl)
      }

      setRecordingUrl(null)
      setDeleteFileUrl(null)
      setDisplayTime(STARTING_TIME_STRING)
      currentBlobRef.current = null

      controller.clear()

      if (updateWidgetManager) {
        widgetMgr.setFileUploaderStateValue(
          element,
          {},
          { fromUi: true },
          fragmentId
        )
      }

      if (deleteFile && deleteFileUrl) {
        try {
          await uploadClient.deleteFile(deleteFileUrl)
        } catch {
          // Silently handle deletion errors
        }
      }
    },
    [
      deleteFileUrl,
      recordingUrl,
      uploadClient,
      element,
      widgetMgr,
      fragmentId,
      setDeleteFileUrl,
      setRecordingUrl,
      controller,
    ]
  )

  // Form clear handling
  useEffect(() => {
    if (isNullOrUndefined(widgetFormId)) return

    const formClearHelper = new FormClearHelper()
    formClearHelper.manageFormClearListener(widgetMgr, widgetFormId, () => {
      void handleClear({ updateWidgetManager: true, deleteFile: false })
    })

    return () => formClearHelper.disconnect()
  }, [widgetFormId, handleClear, widgetMgr])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any ongoing upload
      if (uploadAbortControllerRef.current) {
        uploadAbortControllerRef.current.abort()
        uploadAbortControllerRef.current = null
      }
      // Clean up blob URL if any
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl)
      }
      // Destroy controller
      controller.destroy()
    }
  }, [controller, recordingUrl])

  // Action handlers using the controller
  const handleStartRecording = useCallback(async () => {
    // Clear previous recording if any
    if (recordingUrl) {
      await handleClear({ updateWidgetManager: false, deleteFile: true })
    }

    try {
      await controller.startRecording()
    } catch {
      // Error handling is done via event handlers
    }
  }, [controller, recordingUrl, handleClear])

  const handleStopRecording = useCallback(async () => {
    try {
      await controller.stopRecording()
      // The blob will be handled by the onReady event
    } catch {
      setIsError(true)
    }
  }, [controller])

  const handlePlayPause = useCallback(async () => {
    const caps = controller.getCapabilities()

    if (caps.canPlay) {
      await controller.play()
    } else if (caps.canPause) {
      controller.pause()
    }
  }, [controller])

  const handleClearWithError = useCallback(() => {
    void handleClear({ updateWidgetManager: false, deleteFile: true })
    setIsError(false)
  }, [handleClear])

  const handleDownloadClick = useCallback(() => {
    if (recordingUrl) {
      const link = document.createElement("a")
      link.href = recordingUrl
      link.download = "recording.wav"
      link.click()
    }
  }, [recordingUrl])

  const handleDeleteClick = useCallback(() => {
    void handleClear({
      updateWidgetManager: true,
      deleteFile: true,
    })
  }, [handleClear])

  // Compute UI state
  const isRecording = waveformState === "recording"
  const isPlaying = waveformState === "playing"
  const isPlayingOrRecording = isRecording || isPlaying
  const showPlaceholder =
    waveformState === "idle" &&
    !recordingUrl &&
    !hasNoMicPermissions &&
    !isError
  const showNoMicPermissionsOrPlaceholderOrError =
    hasNoMicPermissions || showPlaceholder || isError

  return (
    <StyledAudioInputContainerDiv
      className="stAudioInput"
      data-testid="stAudioInput"
    >
      <WidgetLabel
        label={element.label}
        disabled={disabled}
        labelVisibility={labelVisibilityProtoValueToEnum(
          element.labelVisibility?.value
        )}
      >
        {element.help && (
          <StyledWidgetLabelHelp>
            <TooltipIcon content={element.help} placement={Placement.TOP} />
          </StyledWidgetLabelHelp>
        )}
      </WidgetLabel>
      <StyledWaveformContainerDiv disabled={disabled}>
        <Toolbar
          isFullScreen={false}
          disableFullscreenMode={true}
          target={StyledWaveformContainerDiv}
        >
          {recordingUrl && (
            <ToolbarAction
              label="Download as WAV"
              icon={FileDownload}
              onClick={handleDownloadClick}
            />
          )}
          {deleteFileUrl && (
            <ToolbarAction
              label="Clear recording"
              icon={Delete}
              onClick={handleDeleteClick}
            />
          )}
        </Toolbar>
        <AudioInputActionButtons
          isRecording={isRecording}
          isPlaying={isPlaying}
          isUploading={isUploading}
          isError={isError}
          recordingUrlExists={Boolean(recordingUrl)}
          startRecording={() => void handleStartRecording()}
          stopRecording={() => void handleStopRecording()}
          onClickPlayPause={() => void handlePlayPause()}
          onClear={handleClearWithError}
          disabled={disabled || hasNoMicPermissions}
        />
        <StyledWaveformInnerDiv>
          {isError && <AudioInputErrorState />}
          {showPlaceholder && <Placeholder />}
          {hasNoMicPermissions && <NoMicPermissions />}
          <StyledWaveSurferDiv
            data-testid="stAudioInputWaveSurfer"
            show={!showNoMicPermissionsOrPlaceholderOrError}
          >
            <WaveformSurface
              controller={controller}
              showTimer={false}
              height={50}
            />
          </StyledWaveSurferDiv>
        </StyledWaveformInnerDiv>
        <StyledWaveformTimeCode
          isPlayingOrRecording={isPlayingOrRecording}
          disabled={disabled}
          data-testid="stAudioInputWaveformTimeCode"
        >
          {displayTime}
        </StyledWaveformTimeCode>
      </StyledWaveformContainerDiv>
    </StyledAudioInputContainerDiv>
  )
}

export default memo(AudioInput)
