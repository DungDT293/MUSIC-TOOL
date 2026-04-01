import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

export type DayPresetId = 'tomorrowland' | 'partymix' | 'custom'

export interface DayPlanDetailOverrides {
  priorityTracksPerPlaylist: number | ''
  videoPickPercent: number | '' // 65-80
  enableCrossfade: boolean
  crossfadeSeconds: number | ''
  // Các field cũ cho tomorrowland/partymix (optional để backward compatible)
  titleVariant?: 'pipe' | 'fire'
  topDj?: string
  // Các field mới cho custom preset
  useCustomTitles: boolean
  customTitles: string[]
  generateTracklist: boolean
  normalizeVideoInput: boolean
  /** Chuẩn hóa tỉ lệ khung hình + FPS khi ghép video (thêm dải đen nếu cần) */
  unifyVideoFormat?: boolean
  /** Tỉ lệ khung hình / độ phân giải mục tiêu khi unifyVideoFormat = true */
  targetResolution?: string
  /** FPS mục tiêu khi unifyVideoFormat = true */
  targetFps?: string
  /** Cách chọn bài ưu tiên: 'auto' = giống hiện tại, 'manual' = user tự chọn giống tab 2 */
  prioritySelectionMode?: 'auto' | 'manual'
  /** Danh sách track id ưu tiên (chọn tay) dùng khi prioritySelectionMode === 'manual' */
  priorityPinnedTrackIds?: string[]
}

export interface DayPlanUI {
  id: string
  dateCode: string // '0212'
  playlistCount: number | ''
  minutesPerPlaylist: number | ''
  presetId: DayPresetId
  overrides?: DayPlanDetailOverrides
}

export interface AutopilotFoldersConfig {
  rootAudio: string
  rootVideo: string
  rootFinal: string
  autoCreateDailySubfolder: boolean
  priorityMusicFolder: string
  randomMusicFolder: string
  priorityVideoFolder?: string
  /** Số clip video tối thiểu cần chọn (mặc định 1000) */
  minVideoClipsTarget?: number
}

type AutopilotRunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'cancelling'

interface AutopilotRunProgress {
  status: AutopilotRunStatus
  currentDayIndex: number | null
  currentStep: 1 | 2 | 3 | 4 | 5 | null
  stepPercent: number
  message?: string
  error?: string
  videoSelectedCount?: number
  videoTargetMin?: number
}

interface AutopilotConfig {
  dayPlans: DayPlanUI[]
  folders: AutopilotFoldersConfig
}

interface PriorityTrack {
  id: string
  fileName: string
  folderType: 'priority' | 'random'
  duration: number
}

interface DayPlansSectionProps {
  dayPlans: DayPlanUI[]
  selectedDayPlanId: string | null
  onSelect: (id: string) => void
  onAddDay: () => void
  onCopyFromSelected: () => void
  onUpdateDay: (id: string, patch: Partial<DayPlanUI>) => void
  onDeleteDay: (id: string) => void
  onOpenDetail: (id: string) => void
}

function DayPlansSection({
  dayPlans,
  selectedDayPlanId,
  onSelect,
  onAddDay,
  onCopyFromSelected,
  onUpdateDay,
  onDeleteDay,
  onOpenDetail,
}: DayPlansSectionProps) {
  // Cột cuối để "Hành động" auto theo độ rộng nút, nhìn cân hơn
  const gridTemplate = '110px 140px 140px 1fr auto'

  const handleSelect = (id: string) => {
    if (selectedDayPlanId === id) return
    onSelect(id)
  }

  const attachFieldHandlers = (planId: string) => ({
    onFocus: () => handleSelect(planId),
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      e.stopPropagation()
      handleSelect(planId)
    },
  })

  return (
    <section style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <h2 style={{ margin: 0, marginBottom: '4px', fontSize: '18px' }}>Kế hoạch sản xuất theo ngày</h2>
        <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>
          Mỗi dòng tương ứng với một ngày (0212, 0313, ...) và một preset / cấu hình riêng.
        </p>
      </div>
      <div
        style={{
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#1a1a1a',
          flex: 1,
          minHeight: '220px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            gap: '8px',
            fontSize: '12px',
            color: '#9ca3af',
            borderBottom: '1px solid #333',
            paddingBottom: '6px',
          }}
        >
          <span>Ngày (ddMM)</span>
          <span>Số playlist / video</span>
          <span>Thời lượng (phút)</span>
          <span>Preset</span>
          <span
            style={{
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            Hành động
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
          {dayPlans.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
              Chưa có kế hoạch nào. Nhấn &quot;+ Thêm ngày&quot; để bắt đầu.
            </div>
          ) : (
            dayPlans.map((plan) => {
              const isSelected = plan.id === selectedDayPlanId
              const commonFieldHandlers = attachFieldHandlers(plan.id)
              return (
                <div
                  key={plan.id}
                  onClick={() => handleSelect(plan.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: gridTemplate,
                    gap: '8px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid #222',
                    backgroundColor: isSelected ? '#2b3b4f' : '#111214',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    value={plan.dateCode}
                    onChange={(e) => onUpdateDay(plan.id, { dateCode: e.target.value })}
                    {...commonFieldHandlers}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      backgroundColor: '#111',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#eee',
                      fontSize: '12px',
                    }}
                  />

                  <input
                    type="number"
                    min={1}
                    value={plan.playlistCount}
                    onChange={(e) =>
                      onUpdateDay(plan.id, {
                        playlistCount: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    {...commonFieldHandlers}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      backgroundColor: '#111',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#eee',
                      fontSize: '12px',
                    }}
                  />

                  <input
                    type="number"
                    min={1}
                    value={plan.minutesPerPlaylist}
                    onChange={(e) =>
                      onUpdateDay(plan.id, {
                        minutesPerPlaylist: e.target.value === '' ? '' : Number(e.target.value),
                      })
                    }
                    {...commonFieldHandlers}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      backgroundColor: '#111',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#eee',
                      fontSize: '12px',
                    }}
                  />

                  <select
                    value={plan.presetId}
                    onChange={(e) => onUpdateDay(plan.id, { presetId: e.target.value as DayPresetId })}
                    {...commonFieldHandlers}
                    style={{
                      width: '100%',
                      padding: '4px 6px',
                      backgroundColor: '#111',
                      border: '1px solid #444',
                      borderRadius: '4px',
                      color: '#eee',
                      fontSize: '12px',
                    }}
                  >
                    <option value="tomorrowland">Tomorrowland 2025</option>
                    <option value="partymix">Party Mix 2025</option>
                    <option value="custom">Custom</option>
                  </select>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenDetail(plan.id)
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #555',
                        backgroundColor: '#222',
                        color: '#eee',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Cấu hình
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteDay(plan.id)
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #743b3b',
                        backgroundColor: '#3a1818',
                        color: '#f88',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      Xoá
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={onAddDay}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#2563eb',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          + Thêm ngày
        </button>
        <button
          type="button"
          onClick={onCopyFromSelected}
          disabled={!selectedDayPlanId}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: '1px solid #555',
            backgroundColor: selectedDayPlanId ? '#111' : '#11111188',
            color: '#eee',
            cursor: selectedDayPlanId ? 'pointer' : 'not-allowed',
            fontSize: '13px',
          }}
        >
          Copy cấu hình ngày trước
        </button>
      </div>
    </section>
  )
}

export interface DayPlanDetailDialogProps {
  plan: DayPlanUI | null
  overrides: DayPlanDetailOverrides
  open: boolean
  onClose: () => void
  onSave: (overrides: DayPlanDetailOverrides) => void
  foldersConfig: AutopilotFoldersConfig
}

export function DayPlanDetailDialog({
  plan,
  overrides,
  open,
  onClose,
  onSave,
  foldersConfig,
}: DayPlanDetailDialogProps) {
  const [local, setLocal] = useState<DayPlanDetailOverrides>({
    ...overrides,
    titleVariant: overrides.titleVariant ?? 'pipe',
    topDj: overrides.topDj ?? 'Tiësto',
    useCustomTitles: overrides.useCustomTitles ?? false,
    customTitles: overrides.customTitles ?? [],
  })
  // Lưu giá trị thô của textarea để cho phép gõ dấu cách tự do
  const [customTitlesRaw, setCustomTitlesRaw] = useState<string>(
    (overrides.customTitles ?? []).join('\n')
  )

  const [priorityTracks, setPriorityTracks] = useState<PriorityTrack[] | null>(null)
  const [loadingPriorityTracks, setLoadingPriorityTracks] = useState(false)
  const [priorityError, setPriorityError] = useState<string | null>(null)

  // Reset local state when plan / overrides change
  const effectivePlanId = plan?.id
  useMemo(() => {
    const newCustomTitles = overrides.customTitles ?? []
    setLocal({
      ...overrides,
      titleVariant: overrides.titleVariant ?? 'pipe',
      topDj: overrides.topDj ?? 'Tiësto',
      useCustomTitles: overrides.useCustomTitles ?? false,
      customTitles: newCustomTitles,
    })
    setCustomTitlesRaw(newCustomTitles.join('\n'))
    setPriorityTracks(null)
    setPriorityError(null)
  }, [effectivePlanId, overrides])

  const handleTogglePinnedTrack = (trackId: string) => {
    setLocal((prev) => {
      const current = Array.isArray(prev.priorityPinnedTrackIds)
        ? prev.priorityPinnedTrackIds
        : []
      const next = current.includes(trackId)
        ? current.filter((id) => id !== trackId)
        : [...current, trackId]
      return {
        ...prev,
        priorityPinnedTrackIds: next,
        prioritySelectionMode: prev.prioritySelectionMode ?? 'manual',
      }
    })
  }

  const handleLoadPriorityTracks = async () => {
    const w = window as any
    if (!w.api?.scanMusicFolders) {
      setPriorityError('Không gọi được backend scanMusicFolders. Vui lòng thử lại sau.')
      return
    }

    if (priorityTracks && priorityTracks.length > 0) {
      setPriorityError(null)
      return
    }

    const priorityFolder = foldersConfig.priorityMusicFolder?.trim() || null
    const randomFolder = foldersConfig.randomMusicFolder?.trim() || null

    if (!priorityFolder && !randomFolder) {
      setPriorityError('Vui lòng cấu hình thư mục nhạc ưu tiên / random ở bên phải trước.')
      return
    }

    try {
      setLoadingPriorityTracks(true)
      setPriorityError(null)
      const result = await w.api.scanMusicFolders({
        priorityFolder,
        randomFolder,
      })
      if (!result || !Array.isArray(result.tracks)) {
        setPriorityError('Không lấy được danh sách bài nhạc từ backend.')
        setPriorityTracks([])
        return
      }
      const mapped: PriorityTrack[] = result.tracks.map((t: any) => ({
        id: t.id,
        fileName: t.fileName || t.path || 'Unknown',
        folderType: t.folderType === 'priority' ? 'priority' : 'random',
        duration: typeof t.duration === 'number' ? t.duration : 0,
      }))
      setPriorityTracks(mapped)
    } catch (err: any) {
      console.warn('[Autopilot] handleLoadPriorityTracks error:', err)
      setPriorityError(err?.message || 'Lỗi không xác định khi quét thư mục nhạc.')
      setPriorityTracks([])
    } finally {
      setLoadingPriorityTracks(false)
    }
  }

  if (!open || !plan) return null

  const handleSave = () => {
    // Chỉ trim và filter khi lưu, không trim khi đang gõ
    const customTitlesProcessed = local.useCustomTitles
      ? customTitlesRaw
          .split(/\r?\n/)
          .map((t) => t.trim())
          .filter(Boolean)
      : []

    const normalized: DayPlanDetailOverrides = {
      ...local,
      priorityTracksPerPlaylist: typeof local.priorityTracksPerPlaylist === 'number'
        ? local.priorityTracksPerPlaylist
        : 0,
      videoPickPercent: typeof local.videoPickPercent === 'number' ? local.videoPickPercent : 0,
      crossfadeSeconds: typeof local.crossfadeSeconds === 'number' ? local.crossfadeSeconds : 0,
      titleVariant: local.titleVariant,
      topDj: local.topDj,
      useCustomTitles: !!local.useCustomTitles,
      customTitles: customTitlesProcessed,
      generateTracklist: !!local.generateTracklist,
      // unifyVideoFormat implies re-encode (cannot copy-stream with vf filter)
      normalizeVideoInput: !!local.normalizeVideoInput || !!local.unifyVideoFormat,
      unifyVideoFormat: !!local.unifyVideoFormat,
      targetResolution: local.unifyVideoFormat ? (local.targetResolution || '1920x1080') : undefined,
      targetFps: local.unifyVideoFormat ? (local.targetFps || '30') : undefined,
    }
    onSave(normalized)
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: '90%',
          maxHeight: '90vh',
          backgroundColor: '#111827',
          borderRadius: '8px',
          border: '1px solid #374151',
          padding: '16px 20px',
          color: '#f9fafb',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '16px' }}>
          Cấu hình chi tiết – Ngày {plan.dateCode}
        </h3>
        <p style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', color: '#9ca3af' }}>
          Điều chỉnh cách chọn bài ưu tiên, số bài ưu tiên, crossfade, tỷ lệ chọn video và quy tắc tiêu đề cho ngày này.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', overflowY: 'auto', flex: 1, minHeight: 0, paddingRight: '8px', marginRight: '-8px' }}>
          {/* Cách chọn bài ưu tiên */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Cách chọn bài ưu tiên</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="radio"
                  name={`prioritySelectionMode-${plan.id}`}
                  checked={!local.prioritySelectionMode || local.prioritySelectionMode === 'auto'}
                  onChange={() =>
                    setLocal((prev) => ({
                      ...prev,
                      prioritySelectionMode: 'auto',
                    }))
                  }
                />
                <span>Để tool tự chọn (dựa trên thư mục Ưu tiên / Random giống tab 2)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="radio"
                  name={`prioritySelectionMode-${plan.id}`}
                  checked={local.prioritySelectionMode === 'manual'}
                  onChange={() => {
                    setLocal((prev) => ({
                      ...prev,
                      prioritySelectionMode: 'manual',
                    }))
                    // Tự động load danh sách bài khi chuyển sang chế độ manual lần đầu
                    if (!priorityTracks) {
                      void handleLoadPriorityTracks()
                    }
                  }}
                />
                <span>
                  Tôi tự chọn bài ưu tiên (giống tab 2)
                  {Array.isArray(local.priorityPinnedTrackIds) &&
                    local.priorityPinnedTrackIds.length > 0 &&
                    ` – ${local.priorityPinnedTrackIds.length} bài đã chọn`}
                </span>
              </label>
              {local.prioritySelectionMode === 'manual' && (
                <div
                  style={{
                    marginTop: '6px',
                    marginLeft: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <button
                    type="button"
                    onClick={handleLoadPriorityTracks}
                    disabled={loadingPriorityTracks}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid #4b5563',
                      backgroundColor: '#020617',
                      color: '#e5e7eb',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {loadingPriorityTracks ? 'Đang quét thư mục nhạc...' : 'Tải danh sách bài nhạc để chọn'}
                  </button>
                  {priorityError && (
                    <span style={{ color: '#f97373', fontSize: '11px' }}>{priorityError}</span>
                  )}
                  {priorityTracks && priorityTracks.length > 0 && (
                    <div
                      style={{
                        maxHeight: 180,
                        overflowY: 'auto',
                        padding: '6px',
                        borderRadius: '4px',
                        border: '1px solid #27272a',
                        backgroundColor: '#020617',
                      }}
                    >
                      {priorityTracks.map((t) => {
                        const checked =
                          Array.isArray(local.priorityPinnedTrackIds) &&
                          local.priorityPinnedTrackIds.includes(t.id)
                        return (
                          <label
                            key={t.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '3px 0',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleTogglePinnedTrack(t.id)}
                            />
                            <span style={{ color: '#e5e7eb', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.fileName}
                            </span>
                            <span style={{ color: '#9ca3af', fontSize: '11px' }}>
                              {t.folderType === 'priority' ? 'Ưu tiên' : 'Random'}
                            </span>
                          </label>
                        )
                      })}
                      {priorityTracks.length === 0 && !priorityError && !loadingPriorityTracks && (
                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                          Không tìm thấy bài nhạc nào trong thư mục đã chọn.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', opacity: local.prioritySelectionMode === 'manual' ? 0.6 : 1 }}>
            <span>Số bài ưu tiên mỗi playlist</span>
            <input
              type="number"
              min={1}
              max={10}
              disabled={local.prioritySelectionMode === 'manual'}
              value={local.priorityTracksPerPlaylist}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  priorityTracksPerPlaylist: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              style={{
                padding: '6px 8px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#020617',
                color: '#e5e7eb',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Tỷ lệ chọn video (%)</span>
            <input
              type="number"
              min={50}
              max={100}
              value={local.videoPickPercent}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  videoPickPercent: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              style={{
                padding: '6px 8px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#020617',
                color: '#e5e7eb',
              }}
            />
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Gợi ý 65–80% để vừa đủ đa dạng vừa không quá nặng.
            </span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={local.enableCrossfade}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  enableCrossfade: e.target.checked,
                }))
              }
            />
            <span>Bật crossfade khi xuất nhạc</span>
          </label>

          {local.enableCrossfade && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '20px' }}>
              <span>Thời lượng crossfade (giây)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={local.crossfadeSeconds}
                onChange={(e) =>
                  setLocal((prev) => ({
                    ...prev,
                    crossfadeSeconds: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                style={{
                  padding: '6px 8px',
                  borderRadius: '4px',
                  border: '1px solid #4b5563',
                  backgroundColor: '#020617',
                  color: '#e5e7eb',
                }}
              />
            </label>
          )}

          {/* UI mới cho Custom preset: video 1-N hoặc tùy chỉnh */}
          {plan?.presetId === 'custom' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span>Kiểu tiêu đề</span>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  <input
                    type="radio"
                    name="titleMode"
                    checked={!local.useCustomTitles}
                    onChange={() =>
                      setLocal((prev) => ({
                        ...prev,
                        useCustomTitles: false,
                      }))
                    }
                  />
                  <span>Mặc định (video 1-N)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                  <input
                    type="radio"
                    name="titleMode"
                    checked={local.useCustomTitles}
                    onChange={() =>
                      setLocal((prev) => ({
                        ...prev,
                        useCustomTitles: true,
                      }))
                    }
                  />
                  <span>Tùy chỉnh</span>
                </label>
              </div>
              {local.useCustomTitles && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Tiêu đề tùy chỉnh (mỗi dòng = 1 file)</span>
                  <textarea
                    rows={4}
                    value={customTitlesRaw}
                    onChange={(e) => {
                      // Giữ nguyên giá trị thô để cho phép gõ dấu cách tự do
                      setCustomTitlesRaw(e.target.value)
                    }}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #4b5563',
                      backgroundColor: '#020617',
                      color: '#e5e7eb',
                      minHeight: '90px',
                      resize: 'vertical',
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Nhập mỗi tiêu đề trên một dòng. Autopilot sẽ dùng tuần tự cho từng file.
                  </span>
                </label>
              )}
              {!local.useCustomTitles && (
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  Tiêu đề sẽ tự động là: video 1, video 2, video 3, ...
                </span>
              )}
            </div>
          ) : (
            /* UI cũ cho Tomorrowland/Partymix: titleVariant và topDj */
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span>Kiểu tiêu đề</span>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                    <input
                      type="radio"
                      name="titleVariant"
                      disabled={local.useCustomTitles}
                      checked={(local.titleVariant ?? 'pipe') === 'pipe'}
                      onChange={() =>
                        setLocal((prev) => ({
                          ...prev,
                          titleVariant: 'pipe',
                        }))
                      }
                    />
                    <span>Dùng ký tự &quot;|&quot;</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                    <input
                      type="radio"
                      name="titleVariant"
                      disabled={local.useCustomTitles}
                      checked={(local.titleVariant ?? 'pipe') === 'fire'}
                      onChange={() =>
                        setLocal((prev) => ({
                          ...prev,
                          titleVariant: 'fire',
                        }))
                      }
                    />
                    <span>Dùng màu đỏ</span>
                  </label>
                </div>
              </div>

              <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={local.useCustomTitles}
                  onChange={(e) =>
                    setLocal((prev) => ({
                      ...prev,
                      useCustomTitles: e.target.checked,
                    }))
                  }
                />
                <span>Điều chỉnh tiêu đề file thủ công</span>
              </label>

              {local.useCustomTitles && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>Tiêu đề tùy chỉnh (mỗi dòng = 1 file)</span>
                  <textarea
                    rows={4}
                    value={customTitlesRaw}
                    onChange={(e) => {
                      // Giữ nguyên giá trị thô để cho phép gõ dấu cách tự do
                      setCustomTitlesRaw(e.target.value)
                    }}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: '1px solid #4b5563',
                      backgroundColor: '#020617',
                      color: '#e5e7eb',
                      minHeight: '90px',
                      resize: 'vertical',
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Nhập mỗi tiêu đề trên một dòng. Autopilot sẽ dùng tuần tự cho từng file.
                  </span>
                </label>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span>DJ đứng đầu (Top DJ)</span>
                <input
                  type="text"
                  disabled={local.useCustomTitles}
                  value={local.topDj ?? 'Tiësto'}
                  onChange={(e) =>
                    setLocal((prev) => ({
                      ...prev,
                      topDj: e.target.value,
                    }))
                  }
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    border: '1px solid #4b5563',
                    backgroundColor: '#020617',
                    color: '#e5e7eb',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  Nếu để trống sẽ dùng mặc định &quot;Tiësto&quot;.
                </span>
              </label>
            </>
          )}

          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={local.generateTracklist}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  generateTracklist: e.target.checked,
                }))
              }
            />
            <span>Tự tạo file tracklist (.txt) cho mỗi video</span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={local.normalizeVideoInput}
              disabled={!!local.unifyVideoFormat}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  normalizeVideoInput: e.target.checked,
                }))
              }
            />
            <span style={{ color: local.unifyVideoFormat ? '#6b7280' : undefined }}>
              Chuẩn hoá video đầu vào (re-encode + kiểm tra sâu, chậm hơn)
              {local.unifyVideoFormat && (
                <span style={{ fontSize: '11px', color: '#60a5fa', marginLeft: '6px' }}>
                  (tự động bật khi chuẩn hóa tỉ lệ khung hình)
                </span>
              )}
            </span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={!!local.unifyVideoFormat}
              onChange={(e) =>
                setLocal((prev) => ({
                  ...prev,
                  unifyVideoFormat: e.target.checked,
                }))
              }
            />
            <span>Chuẩn hóa tỉ lệ khung hình / FPS khi ghép video (letterbox/pillarbox)</span>
          </label>

          {local.unifyVideoFormat && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>Tỉ lệ khung hình / Độ phân giải mục tiêu</span>
                <select
                  value={local.targetResolution || '1920x1080'}
                  onChange={(e) => setLocal((prev) => ({ ...prev, targetResolution: e.target.value }))}
                  style={{ padding: '4px 8px', backgroundColor: '#1f2937', color: '#f9fafb', border: '1px solid #374151', borderRadius: '4px', fontSize: '12px' }}
                >
                  <option value="1920x1080">16:9 — 1920×1080 (Full HD Ngang)</option>
                  <option value="1440x1080">4:3 — 1440×1080 (Cổ điển)</option>
                  <option value="2560x1080">2.35:1 — 2560×1080 (Cinemascope)</option>
                  <option value="2160x1080">2:1 — 2160×1080 (Univisium)</option>
                  <option value="1998x1080">1.85:1 — 1998×1080 (Widescreen)</option>
                  <option value="1080x1920">9:16 — 1080×1920 (Dọc / Reels / Shorts)</option>
                  <option value="1080x1440">3:4 — 1080×1440 (Dọc cổ điển)</option>
                  <option value="1080x1868">5.8-inch — 1080×1868 (Mobile tall)</option>
                  <option value="1080x1080">1:1 — 1080×1080 (Vuông / Instagram)</option>
                  <option value="3840x2160">16:9 — 3840×2160 (4K UHD)</option>
                  <option value="1280x720">16:9 — 1280×720 (HD 720p)</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>FPS mục tiêu</span>
                <select
                  value={local.targetFps || '30'}
                  onChange={(e) => setLocal((prev) => ({ ...prev, targetFps: e.target.value }))}
                  style={{ padding: '4px 8px', backgroundColor: '#1f2937', color: '#f9fafb', border: '1px solid #374151', borderRadius: '4px', fontSize: '12px' }}
                >
                  <option value="24">24.00 fps (Cinema)</option>
                  <option value="25">25.00 fps (PAL / Europe)</option>
                  <option value="30000/1001">29.97 fps (NTSC)</option>
                  <option value="30">30.00 fps (YouTube phổ biến)</option>
                  <option value="50">50.00 fps (PAL HFR)</option>
                  <option value="60000/1001">59.94 fps (NTSC HFR)</option>
                  <option value="60">60.00 fps (Gaming / HFR)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 10px',
              borderRadius: '4px',
              border: '1px solid #4b5563',
              backgroundColor: '#030712',
              color: '#e5e7eb',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Lưu cấu hình
          </button>
        </div>
      </div>
    </div>
  )
}

interface FoldersAndSourcesSectionProps {
  foldersConfig: AutopilotFoldersConfig
  onChange: (patch: Partial<AutopilotFoldersConfig>) => void
  videoSelectionInfo?: { selected: number; target: number }
}

function FoldersAndSourcesSection({ foldersConfig, onChange, videoSelectionInfo }: FoldersAndSourcesSectionProps) {
  const [videoScanResult, setVideoScanResult] = useState<{
    totalFiles: number
    folders: Array<{ folder: string; count: number }>
  } | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  // Reset khi rootVideo thay đổi
  useEffect(() => {
    setVideoScanResult(null)
  }, [foldersConfig.rootVideo])

  const handleScanVideos = async () => {
    const w = window as any
    if (!w.api?.autopilot?.scanVideoFolders) return
    if (!foldersConfig.rootVideo || foldersConfig.rootVideo.trim().length === 0) return
    setIsScanning(true)
    setVideoScanResult(null)
    try {
      const result = await w.api.autopilot.scanVideoFolders(foldersConfig.rootVideo)
      setVideoScanResult(result)
    } catch {
      setVideoScanResult({ totalFiles: 0, folders: [] })
    } finally {
      setIsScanning(false)
    }
  }
  const today = useMemo(() => {
    const now = new Date()
    const day = `${now.getDate()}`.padStart(2, '0')
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    return { human: `${day}/${month}`, code: `${day}${month}` }
  }, [])

  const previewAudio = foldersConfig.rootAudio
    ? `${foldersConfig.rootAudio.replace(/[/\\\\]$/, '')}${foldersConfig.autoCreateDailySubfolder ? `\\${today.code}` : ''}`
    : ''
  const previewVideo = foldersConfig.rootVideo
    ? `${foldersConfig.rootVideo.replace(/[/\\\\]$/, '')}${foldersConfig.autoCreateDailySubfolder ? `\\${today.code}` : ''}`
    : ''
  const previewFinal = foldersConfig.rootFinal
    ? `${foldersConfig.rootFinal.replace(/[/\\\\]$/, '')}${foldersConfig.autoCreateDailySubfolder ? `\\${today.code}` : ''}`
    : ''

  const handleChooseFolder = async (key: 'rootAudio' | 'rootVideo' | 'rootFinal') => {
    const w = window as any

    // Ưu tiên dùng dialog chọn thư mục của hệ điều hành nếu có
    if (w.api?.selectFolder) {
      try {
        const selected: string | null = await w.api.selectFolder()
        if (!selected) return

        const current = foldersConfig[key] || ''
        const merged =
          current && current.trim().length > 0 ? `${current.trim()}\n${selected}` : selected

        onChange({ [key]: merged } as Partial<AutopilotFoldersConfig>)
        return
      } catch (err) {
        console.warn('[AutopilotPage] selectFolder error, fallback prompt:', err)
      }
    }

    // Fallback: prompt nhập tay (trong môi trường không có IPC)
    const current = foldersConfig[key] || ''
    // eslint-disable-next-line no-alert
    const next = window.prompt(
      `Nhập một hoặc nhiều thư mục cho ${key}.\n- Có thể dán nhiều đường dẫn, cách nhau bằng dấu ; hoặc xuống dòng.\n- Ví dụ: D:\\\\AUDIO_1;D:\\\\AUDIO_2`,
      current,
    )
    if (next != null) {
      onChange({ [key]: next } as Partial<AutopilotFoldersConfig>)
    }
  }

  const handleChooseMusicFolder = async (key: 'priorityMusicFolder' | 'randomMusicFolder') => {
    const w = window as any

    if (w.api?.selectFolder) {
      try {
        const selected: string | null = await w.api.selectFolder()
        if (!selected) return
        onChange({ [key]: selected } as Partial<AutopilotFoldersConfig>)
        return
      } catch (err) {
        console.warn('[AutopilotPage] selectFolder error (music), fallback prompt:', err)
      }
    }

    const current = foldersConfig[key] || ''
    // eslint-disable-next-line no-alert
    const next = window.prompt(
      `Nhập đường dẫn thư mục cho ${key === 'priorityMusicFolder' ? 'nhạc ưu tiên' : 'nhạc random'}.`,
      current,
    )
    if (next != null) {
      onChange({ [key]: next } as Partial<AutopilotFoldersConfig>)
    }
  }

  return (
    <section style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div
          style={{
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '12px',
            backgroundColor: '#111827',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '16px' }}>Thư mục & nguồn dữ liệu</h3>
          <p style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', color: '#9ca3af' }}>
            Chọn thư mục gốc cho Audio, Video đã cắt và Video hoàn chỉnh. Autopilot sẽ tự tạo thư mục con theo ngày
            (vd. 0212, 0313) nếu bạn bật chế độ bên dưới.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
            <FolderRow
              label="Thư mục xuất Audio"
              value={foldersConfig.rootAudio}
              onChoose={() => handleChooseFolder('rootAudio')}
              onClear={() => onChange({ rootAudio: '' })}
            />
            <FolderRow
              label="Thư mục gốc Video đã cắt"
              value={foldersConfig.rootVideo}
              onChoose={() => handleChooseFolder('rootVideo')}
              onClear={() => onChange({ rootVideo: '' })}
            />
            {/* Nút quét video */}
            {foldersConfig.rootVideo && foldersConfig.rootVideo.trim().length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '-4px', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={handleScanVideos}
                    disabled={isScanning}
                    style={{
                      padding: '3px 10px',
                      borderRadius: '4px',
                      border: '1px solid #4b5563',
                      backgroundColor: isScanning ? '#374151' : '#0f3520',
                      color: isScanning ? '#9ca3af' : '#4ade80',
                      cursor: isScanning ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {isScanning ? 'Đang quét...' : 'Quét số lượng video'}
                  </button>
                  {videoScanResult && (
                    <span style={{ fontSize: '12px', color: videoScanResult.totalFiles > 0 ? '#4ade80' : '#fbbf24', fontWeight: 500 }}>
                      {videoScanResult.totalFiles.toLocaleString()} video
                      {videoScanResult.folders.length > 1 && ` (${videoScanResult.folders.length} thư mục)`}
                    </span>
                  )}
                </div>
                {videoScanResult && videoScanResult.folders.length > 0 && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', paddingLeft: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                    {videoScanResult.folders.map((f, i) => (
                      <div key={i}>
                        {f.folder.split(/[\\/]/).pop()}: <strong style={{ color: f.count > 0 ? '#4ade80' : '#f87171' }}>{f.count.toLocaleString()}</strong> video
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <FolderRow
              label="Thư mục xuất Video hoàn chỉnh"
              value={foldersConfig.rootFinal}
              onChoose={() => handleChooseFolder('rootFinal')}
              onClear={() => onChange({ rootFinal: '' })}
            />
            <FolderRow
              label="Thư mục video ưu tiên (tùy chọn)"
              value={foldersConfig.priorityVideoFolder || ''}
              onChoose={async () => {
                const w = window as any
                if (w.api?.selectFolder) {
                  try {
                    const selected: string | null = await w.api.selectFolder()
                    if (!selected) return
                    onChange({ priorityVideoFolder: selected })
                    return
                  } catch (err) {
                    console.warn('[AutopilotPage] selectFolder error (priorityVideoFolder):', err)
                  }
                }
                const current = foldersConfig.priorityVideoFolder || ''
                // eslint-disable-next-line no-alert
                const next = window.prompt(
                  'Nhập thư mục video ưu tiên (có thể để trống). Các clip trong thư mục này sẽ được ưu tiên xuất hiện đầu video.',
                  current,
                )
                if (next != null) {
                  onChange({ priorityVideoFolder: next })
                }
              }}
              onClear={() => onChange({ priorityVideoFolder: '' })}
            />
          </div>
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={foldersConfig.autoCreateDailySubfolder}
                onChange={(e) => onChange({ autoCreateDailySubfolder: e.target.checked })}
              />
              <span>Tự tạo thư mục con theo ngày (ddMM)</span>
            </label>
            <span style={{ fontSize: '11px', color: '#9ca3af' }}>
              Hôm nay: {today.human} → thư mục ngày: <code>{today.code}</code>
            </span>
            {previewAudio && (
              <span style={{ fontSize: '11px', color: '#6b7280' }}>Audio: {previewAudio}</span>
            )}
            {previewVideo && (
              <span style={{ fontSize: '11px', color: '#6b7280' }}>Video: {previewVideo}</span>
            )}
            {previewFinal && (
              <span style={{ fontSize: '11px', color: '#6b7280' }}>Final: {previewFinal}</span>
            )}
            {videoSelectionInfo && (
              <span
                style={{
                  fontSize: '11px',
                  color: videoSelectionInfo.selected >= (videoSelectionInfo.target || 0) ? '#4ade80' : '#fbbf24',
                }}
              >
                Video clips đã chọn: {videoSelectionInfo.selected.toLocaleString()} /{' '}
                {(videoSelectionInfo.target || 0).toLocaleString()} (mục tiêu)
              </span>
            )}
            {/* Mục tiêu clip video */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <label style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                Số clip mục tiêu:
              </label>
              <input
                type="number"
                min={100}
                max={100000}
                step={100}
                value={foldersConfig.minVideoClipsTarget ?? 1000}
                onChange={(e) => {
                  const v = Math.min(100000, Math.max(100, Number(e.target.value) || 1000))
                  onChange({ minVideoClipsTarget: v })
                }}
                style={{
                  width: '90px',
                  padding: '3px 6px',
                  borderRadius: '4px',
                  border: '1px solid #4b5563',
                  backgroundColor: '#020617',
                  color: '#e5e7eb',
                  fontSize: '12px',
                }}
              />
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                (Autopilot sẽ cố chọn ít nhất số clip này từ thư mục video)
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '12px',
            backgroundColor: '#111827',
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: '8px', fontSize: '16px' }}>Nguồn nhạc</h3>
          <p style={{ marginTop: 0, marginBottom: '12px', fontSize: '12px', color: '#9ca3af' }}>
            Autopilot sẽ tự quét trực tiếp hai thư mục giống tab &quot;Quét nhạc&quot; (nhạc ưu tiên &amp; random) trước khi tạo
            playlist. Chỉ cần chọn ít nhất một thư mục là được.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <MusicFolderRow
              label="Thư mục nhạc ưu tiên"
              value={foldersConfig.priorityMusicFolder}
              onChoose={() => handleChooseMusicFolder('priorityMusicFolder')}
              onClear={() => onChange({ priorityMusicFolder: '' })}
            />
            <MusicFolderRow
              label="Thư mục nhạc random"
              value={foldersConfig.randomMusicFolder}
              onChoose={() => handleChooseMusicFolder('randomMusicFolder')}
              onClear={() => onChange({ randomMusicFolder: '' })}
            />
          </div>
          <span style={{ display: 'block', marginTop: '10px', fontSize: '11px', color: '#9ca3af', lineHeight: 1.5 }}>
            - Nhạc ưu tiên sẽ luôn được ưu tiên mở đầu playlist (65–80% thời lượng).<br />
            - Nhạc random bổ sung phần còn lại để đủ thời lượng và tạo độ đa dạng.<br />
            - Có thể chọn 1 hoặc cả 2 thư mục, Autopilot sẽ tự cân đối.
          </span>
        </div>
      </div>
    </section>
  )
}

interface FolderRowProps {
  label: string
  value: string
  onChoose: () => void
  onClear: () => void
}

function FolderRow({ label, value, onChoose, onClear }: FolderRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span>{label}</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <textarea
          readOnly
          value={value}
          placeholder="Chưa chọn thư mục"
          rows={2}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid #4b5563',
            backgroundColor: '#020617',
            color: '#e5e7eb',
            fontSize: '13px',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={onChoose}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: '#030712',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontSize: '13px',
                whiteSpace: 'nowrap',
              }}
            >
              Chọn
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={!value}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: '1px solid #4b5563',
                backgroundColor: value ? '#3b0a0a' : '#111827',
                color: value ? '#fecaca' : '#6b7280',
                cursor: value ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                whiteSpace: 'nowrap',
              }}
            >
              Xóa
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface MusicFolderRowProps {
  label: string
  value: string
  onChoose: () => void
  onClear: () => void
}

function MusicFolderRow({ label, value, onChoose, onClear }: MusicFolderRowProps) {
  return (
    <div style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', backgroundColor: '#0f172a' }}>
      <div style={{ fontSize: '13px', color: '#e5e7eb', marginBottom: '4px' }}>{label}</div>
      <div
        style={{
          fontSize: '12px',
          color: value ? '#cbd5f5' : '#6b7280',
          backgroundColor: '#111827',
          padding: '6px 8px',
          borderRadius: '4px',
          border: '1px solid #1f2937',
          minHeight: '32px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {value || 'Chưa chọn'}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
        <button
          type="button"
          onClick={onChoose}
          style={{
            padding: '5px 10px',
            borderRadius: '4px',
            border: '1px solid #2563eb',
            backgroundColor: '#1d4ed8',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Chọn
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!value}
          style={{
            padding: '5px 10px',
            borderRadius: '4px',
            border: '1px solid #4b5563',
            backgroundColor: value ? '#3b0a0a' : '#111827',
            color: value ? '#fecaca' : '#6b7280',
            cursor: value ? 'pointer' : 'not-allowed',
            fontSize: '12px',
          }}
        >
          Xóa
        </button>
      </div>
    </div>
  )
}

interface AutopilotControlSectionProps {
  config: AutopilotConfig
  runProgress: AutopilotRunProgress
  onStart: () => void
  onCancel: () => void
}

function AutopilotControlSection({
  config,
  runProgress,
  onStart,
  onCancel,
}: AutopilotControlSectionProps) {
  const hasMusicFolder =
    (config.folders.priorityMusicFolder && config.folders.priorityMusicFolder.trim().length > 0) ||
    (config.folders.randomMusicFolder && config.folders.randomMusicFolder.trim().length > 0)
  // Cho phép start lại khi status là 'idle', 'error', hoặc 'completed' (để user có thể chạy lại sau khi sửa lỗi)
  const canStart =
    config.dayPlans.length > 0 &&
    !!config.folders.rootAudio &&
    !!config.folders.rootVideo &&
    !!config.folders.rootFinal &&
    hasMusicFolder &&
    (runProgress.status === 'idle' || runProgress.status === 'error' || runProgress.status === 'completed')

  const steps = [
    'Quét / load kho nhạc',
    'Tạo playlist & xuất audio',
    'Chọn & ghép video',
    'Xuất video hoàn chỉnh',
    'Hoàn thành & log',
  ]

  const renderControls = () => {
    if (runProgress.status === 'idle' || runProgress.status === 'completed' || runProgress.status === 'error') {
      return (
        <button
          type="button"
          onClick={onStart}
          disabled={!canStart}
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: !canStart ? '#64748b' : '#16a34a',
            color: '#ecfdf5',
            cursor: !canStart ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            minWidth: '180px',
          }}
          title={!canStart ? 'Cần cấu hình đủ thư mục và kế hoạch ngày trước khi chạy' : undefined}
        >
          Bắt đầu Autopilot
        </button>
      )
    }

    if (runProgress.status === 'running' || runProgress.status === 'cancelling') {
      return (
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 12px',
            borderRadius: '4px',
            border: '1px solid #f87171',
            backgroundColor: '#450a0a',
            color: '#fecaca',
            cursor: 'pointer',
            fontSize: '13px',
            minWidth: '120px',
          }}
        >
          Hủy
        </button>
      )
    }

    return null
  }

  const currentDayLabel =
    runProgress.currentDayIndex != null && config.dayPlans[runProgress.currentDayIndex]
      ? config.dayPlans[runProgress.currentDayIndex].dateCode
      : '-'

  return (
    <section
      style={{
        marginTop: '16px',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '12px 16px',
        backgroundColor: '#020617',
        color: '#e5e7eb',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <div>
          <h3 style={{ marginTop: 0, marginBottom: '4px', fontSize: '16px' }}>Điều khiển Autopilot</h3>
          <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af' }}>
            Autopilot sẽ chạy lần lượt từng ngày trong bảng kế hoạch, từ quét nhạc, tạo playlist, xuất audio, ghép
            video tới xuất video hoàn chỉnh.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>{renderControls()}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          Trạng thái: <strong>{runProgress.status}</strong> | Ngày hiện tại: <strong>{currentDayLabel}</strong>
        </span>
        {runProgress.message && (
          <span style={{ fontSize: '12px', color: '#e5e7eb' }}>{runProgress.message}</span>
        )}
        {runProgress.error && (
          <span style={{ fontSize: '12px', color: '#f87171', fontWeight: 'bold' }}>{runProgress.error}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {steps.map((label, index) => {
          const stepIndex = (index + 1) as 1 | 2 | 3 | 4 | 5
          let state: 'pending' | 'active' | 'done' = 'pending'
          if (runProgress.currentStep != null) {
            if (stepIndex < runProgress.currentStep) state = 'done'
            else if (stepIndex === runProgress.currentStep) state = 'active'
          }

          const bg =
            state === 'done' ? '#064e3b' : state === 'active' ? '#1d4ed8' : '#111827'
          const border = state === 'pending' ? '#374151' : 'transparent'

          const percent =
            state === 'done'
              ? 100
              : state === 'active'
              ? runProgress.stepPercent
              : 0

          return (
            <div
              key={label}
              style={{
                flex: 1,
                minWidth: '150px',
                borderRadius: '6px',
                border: `1px solid ${border}`,
                backgroundColor: bg,
                padding: '8px 10px',
                fontSize: '12px',
              }}
            >
              <div style={{ marginBottom: '4px', fontWeight: 500 }}>{index + 1}. {label}</div>
              <div
                style={{
                  height: '4px',
                  borderRadius: '999px',
                  backgroundColor: '#111827',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${percent}%`,
                    height: '100%',
                    borderRadius: '999px',
                    backgroundColor: '#22c55e',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          disabled={!config.folders.rootFinal}
          onClick={async () => {
            const w = window as any
            const root = config.folders.rootFinal
            if (!root) {
              // eslint-disable-next-line no-alert
              alert('Hãy cấu hình "Thư mục xuất Video hoàn chỉnh" trước.')
              return
            }
            const now = new Date()
            const day = `${now.getDate()}`.padStart(2, '0')
            const month = `${now.getMonth() + 1}`.padStart(2, '0')
            const dateCode = `${day}${month}`
            const base = root.replace(/[/\\]$/, '')
            const targetDir = config.folders.autoCreateDailySubfolder ? `${base}\\${dateCode}` : base

            if (!w.api?.openPath) {
              // eslint-disable-next-line no-alert
              alert('API mở thư mục chưa sẵn sàng (window.api.openPath).')
              return
            }

            try {
              if (w.api.createDirectory) {
                await w.api.createDirectory(targetDir)
              }
              await w.api.openPath(targetDir)
            } catch (err: any) {
              console.error('[Autopilot] open today folder error:', err)
              // eslint-disable-next-line no-alert
              alert(err?.message || 'Không mở được thư mục ngày hiện tại.')
            }
          }}
          style={{
            padding: '6px 10px',
            borderRadius: '4px',
            border: '1px solid #4b5563',
            backgroundColor: config.folders.rootFinal ? '#030712' : '#030712',
            color: config.folders.rootFinal ? '#e5e7eb' : '#6b7280',
            cursor: config.folders.rootFinal ? 'pointer' : 'not-allowed',
            fontSize: '12px',
          }}
        >
          Mở thư mục ngày hiện tại
        </button>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>
          Tiến trình Autopilot đang được cập nhật trực tiếp từ backend (worker / job queue).
        </span>
      </div>
    </section>
  )
}

export function createDefaultOverrides(): DayPlanDetailOverrides {
  return {
    priorityTracksPerPlaylist: 6,
    videoPickPercent: 70,
    enableCrossfade: false,
    crossfadeSeconds: 4,
    titleVariant: 'pipe',
    topDj: 'Tiësto',
    useCustomTitles: false,
    customTitles: [],
    generateTracklist: false,
    normalizeVideoInput: false,
    unifyVideoFormat: false,
    targetResolution: '1920x1080',
    targetFps: '30',
    prioritySelectionMode: 'auto',
    priorityPinnedTrackIds: [],
  }
}

let dayPlanIdCounter = 1

const AUTOPILOT_STORAGE_KEY = 'autopilotConfigV1'

/**
 * Tăng ngày từ dateCode (ddMM format) lên 1 ngày
 * Xử lý đúng số ngày trong tháng (31, 30, 28/29) và chuyển tháng/năm
 * Date object tự động xử lý tất cả edge cases
 */
function incrementDateCode(dateCode: string): string {
  // Parse dateCode: ddMM (ví dụ: 0412 = ngày 04 tháng 12)
  if (dateCode.length !== 4) {
    // Nếu không đúng format, trả về ngày hiện tại + 1
    const now = new Date()
    now.setDate(now.getDate() + 1)
    const day = `${now.getDate()}`.padStart(2, '0')
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    return `${day}${month}`
  }

  const dayStr = dateCode.substring(0, 2)
  const monthStr = dateCode.substring(2, 4)
  const day = parseInt(dayStr, 10)
  const month = parseInt(monthStr, 10)

  if (isNaN(day) || isNaN(month) || month < 1 || month > 12 || day < 1 || day > 31) {
    // Nếu parse lỗi, trả về ngày hiện tại + 1
    const now = new Date()
    now.setDate(now.getDate() + 1)
    const d = `${now.getDate()}`.padStart(2, '0')
    const m = `${now.getMonth() + 1}`.padStart(2, '0')
    return `${d}${m}`
  }

  // Tạo Date object với năm hiện tại
  // Date object tự động xử lý:
  // - Số ngày trong tháng (31, 30, 28/29)
  // - Chuyển tháng (ví dụ: 31/01 -> 01/02)
  // - Chuyển năm (ví dụ: 31/12 -> 01/01 năm sau)
  const currentYear = new Date().getFullYear()
  const date = new Date(currentYear, month - 1, day) // month - 1 vì Date month bắt đầu từ 0

  // Tăng lên 1 ngày - Date object tự động xử lý chuyển tháng/năm
  date.setDate(date.getDate() + 1)

  // Format lại thành ddMM (bỏ qua năm, chỉ lấy ngày và tháng)
  const newDay = `${date.getDate()}`.padStart(2, '0')
  const newMonth = `${date.getMonth() + 1}`.padStart(2, '0')
  return `${newDay}${newMonth}`
}

function createDefaultDayPlan(): DayPlanUI {
  const now = new Date()
  const day = `${now.getDate()}`.padStart(2, '0')
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const dateCode = `${day}${month}`

  return {
    id: `day-${dayPlanIdCounter++}`,
    dateCode,
    playlistCount: 10,
    minutesPerPlaylist: 30,
    presetId: 'tomorrowland',
    overrides: createDefaultOverrides(),
  }
}

// Legacy Autopilot implementation (disabled for now)
function AutopilotPageLegacy() {
  const [dayPlans, setDayPlans] = useState<DayPlanUI[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(AUTOPILOT_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as AutopilotConfig
      if (!parsed?.dayPlans || !Array.isArray(parsed.dayPlans)) return []
      // Gán lại id counter để tránh trùng id khi thêm ngày mới
      const maxIdNum = parsed.dayPlans
        .map((p) => {
          const match = typeof p.id === 'string' ? p.id.match(/day-(\d+)/) : null
          return match ? Number(match[1]) || 0 : 0
        })
        .reduce((max, n) => Math.max(max, n), 0)
      if (maxIdNum > 0) {
        dayPlanIdCounter = maxIdNum + 1
      }
      return parsed.dayPlans
    } catch {
      return []
    }
  })
  const [selectedDayPlanId, setSelectedDayPlanId] = useState<string | null>(null)
  const [detailOpenFor, setDetailOpenFor] = useState<string | null>(null)
  const [panelRatio, setPanelRatio] = useState(0.55) // left panel width ratio (0-1)
  const [isResizingPanels, setIsResizingPanels] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)

  const [foldersConfig, setFoldersConfig] = useState<AutopilotFoldersConfig>(() => {
    if (typeof window === 'undefined') {
      return {
    rootAudio: '',
    rootVideo: '',
    rootFinal: '',
    autoCreateDailySubfolder: true,
    priorityMusicFolder: '',
    randomMusicFolder: '',
        priorityVideoFolder: '',
      }
    }
    try {
      const raw = window.localStorage.getItem(AUTOPILOT_STORAGE_KEY)
      if (!raw) {
        return {
          rootAudio: '',
          rootVideo: '',
          rootFinal: '',
          autoCreateDailySubfolder: true,
          priorityMusicFolder: '',
          randomMusicFolder: '',
        }
      }
      const parsed = JSON.parse(raw) as AutopilotConfig
      return {
        rootAudio: parsed?.folders?.rootAudio || '',
        rootVideo: parsed?.folders?.rootVideo || '',
        rootFinal: parsed?.folders?.rootFinal || '',
        autoCreateDailySubfolder:
          typeof parsed?.folders?.autoCreateDailySubfolder === 'boolean'
            ? parsed.folders.autoCreateDailySubfolder
            : true,
        priorityMusicFolder: parsed?.folders?.priorityMusicFolder || '',
        randomMusicFolder: parsed?.folders?.randomMusicFolder || '',
        priorityVideoFolder: parsed?.folders?.priorityVideoFolder || '',
        minVideoClipsTarget: typeof parsed?.folders?.minVideoClipsTarget === 'number' ? parsed.folders.minVideoClipsTarget : 1000,
      }
    } catch {
      return {
        rootAudio: '',
        rootVideo: '',
        rootFinal: '',
        autoCreateDailySubfolder: true,
        priorityMusicFolder: '',
        randomMusicFolder: '',
        priorityVideoFolder: '',
      }
    }
  })

  const [runProgress, setRunProgress] = useState<AutopilotRunProgress>({
    status: 'idle',
    currentDayIndex: null,
    currentStep: null,
    stepPercent: 0,
    message: '',
    error: undefined,
  })

  const [logMessages, setLogMessages] = useState<Array<{ timestamp: string; level: 'info' | 'warn' | 'error'; message: string }>>([])
  const logContainerRef = useRef<HTMLDivElement | null>(null)

  const currentDetailPlan = useMemo(
    () => dayPlans.find((p) => p.id === detailOpenFor) ?? null,
    [dayPlans, detailOpenFor],
  )

  const currentOverrides: DayPlanDetailOverrides = currentDetailPlan?.overrides ?? createDefaultOverrides()

  const config: AutopilotConfig = {
    dayPlans,
    folders: foldersConfig,
  }

  const videoSelectionInfo =
    typeof runProgress.videoSelectedCount === 'number'
      ? {
          selected: runProgress.videoSelectedCount,
          target: runProgress.videoTargetMin ?? 1000,
        }
      : undefined

  // Đồng bộ tiến trình với backend Autopilot
  useEffect(() => {
    const w = window as any
    if (!w.api?.autopilot) return

    let unsub: (() => void) | undefined

    // Lấy trạng thái hiện tại khi mount
    w.api.autopilot
      .getStatus()
      .then((status: any) => {
        if (status && typeof status === 'object') {
          setRunProgress((prev) => ({
            ...prev,
            status: status.status ?? prev.status,
            currentDayIndex: status.currentDayIndex ?? prev.currentDayIndex,
            currentStep: status.currentStep ?? prev.currentStep,
            stepPercent:
              typeof status.stepPercent === 'number' ? status.stepPercent : prev.stepPercent,
            message: status.message ?? prev.message,
            error: status.error ?? prev.error,
          }))
        }
      })
      .catch((err: any) => {
        console.warn('[AutopilotPage] getStatus error:', err)
      })

    // Subscribe realtime updates
    if (typeof w.api.autopilot.onStatus === 'function') {
      unsub = w.api.autopilot.onStatus((progress: any) => {
        setRunProgress({
          status: progress.status ?? 'idle',
          currentDayIndex: progress.currentDayIndex ?? null,
          currentStep: progress.currentStep ?? null,
          stepPercent:
            typeof progress.stepPercent === 'number' ? progress.stepPercent : 0,
          message: progress.message,
          error: progress.error,
        })
      })
    }

    // Subscribe log messages
    let logUnsub: (() => void) | undefined
    if (typeof w.api.autopilot.onLog === 'function') {
      logUnsub = w.api.autopilot.onLog((log: any) => {
        setLogMessages((prev) => {
          const newLogs = [...prev, log]
          // Giới hạn tối đa 500 dòng log để tránh lag
          return newLogs.slice(-500)
        })
      })
    }

    return () => {
      if (unsub) unsub()
      if (logUnsub) logUnsub()
    }
  }, [])

  // Tự động scroll xuống cuối khi có log mới
  useEffect(() => {
    if (!logContainerRef.current) return
    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
  }, [logMessages])

  const handleAddDay = () => {
    const next = createDefaultDayPlan()
    setDayPlans((prev) => [...prev, next])
    setSelectedDayPlanId(next.id)
  }

  const handleCopyFromSelected = () => {
    if (!selectedDayPlanId) return
    const base = dayPlans.find((p) => p.id === selectedDayPlanId)
    if (!base) return
    
    // Tự động tăng ngày từ dateCode của ngày được chọn
    const nextDateCode = incrementDateCode(base.dateCode)
    
    const copy: DayPlanUI = {
      ...base,
      id: `day-${dayPlanIdCounter++}`,
      dateCode: nextDateCode, // Tự động tăng ngày
    }
    setDayPlans((prev) => [...prev, copy])
    setSelectedDayPlanId(copy.id)
  }

  const handleUpdateDay = (id: string, patch: Partial<DayPlanUI>) => {
    setDayPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  const handleDeleteDay = (id: string) => {
    setDayPlans((prev) => prev.filter((p) => p.id !== id))
    setSelectedDayPlanId((prev) => (prev === id ? null : prev))
    setDetailOpenFor((prev) => (prev === id ? null : prev))
  }

  const handleSaveOverrides = (overrides: DayPlanDetailOverrides) => {
    if (!detailOpenFor) return
    setDayPlans((prev) =>
      prev.map((p) =>
        p.id === detailOpenFor
          ? {
              ...p,
              overrides: {
                ...createDefaultOverrides(),
                ...overrides,
            titleVariant: overrides.titleVariant ?? 'pipe',
                topDj: overrides.topDj || 'Tiësto',
                useCustomTitles: !!overrides.useCustomTitles,
                customTitles: Array.isArray(overrides.customTitles)
                  ? overrides.customTitles.map((t) => t.trim()).filter(Boolean)
                  : [],
              },
            }
          : p,
      ),
    )
  }

  // Lưu cấu hình Autopilot (dayPlans + folders) vào localStorage để lần sau mở app không phải chọn lại
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const payload: AutopilotConfig = {
        dayPlans,
        folders: foldersConfig,
      }
      window.localStorage.setItem(AUTOPILOT_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore
    }
  }, [dayPlans, foldersConfig])

  const simulateStartAutopilot = () => {
    const w = window as any
    if (!w.api?.autopilot?.start) {
      // eslint-disable-next-line no-alert
      alert('Autopilot backend chưa sẵn sàng (window.api.autopilot.start không tồn tại).')
      return
    }

    console.log('[Autopilot] start with config:', config)
    // Debug: Log dayPlans với overrides để kiểm tra customTitles
    config.dayPlans.forEach((plan, idx) => {
      if (plan.overrides?.useCustomTitles) {
        console.log(`[Autopilot] Day plan ${idx} (${plan.dateCode}): useCustomTitles=true, customTitles count=${plan.overrides.customTitles?.length || 0}`)
        if (plan.overrides.customTitles && plan.overrides.customTitles.length > 0) {
          console.log(`[Autopilot] Day plan ${idx} customTitles[0]=${plan.overrides.customTitles[0]}`)
        }
      }
    })
    // Reset về trạng thái sạch khi start lại (kể cả sau khi error/completed)
    setRunProgress({
      status: 'running',
      currentDayIndex: null,
      currentStep: null,
      stepPercent: 0,
      message: 'Đang khởi động Autopilot...',
      error: undefined,
    })

    w.api.autopilot
      .start(config)
      .then((res: any) => {
        console.log('[Autopilot] Response from backend:', res)
        if (!res?.ok) {
          // eslint-disable-next-line no-alert
          alert(res?.error || 'Không chạy được Autopilot.')
          setRunProgress((prev) => ({
            ...prev,
            status: 'error',
            error: res?.error || 'Không chạy được Autopilot.',
          }))
        } else {
          console.log('[Autopilot] Started successfully')
        }
      })
      .catch((err: any) => {
        console.error('[Autopilot] start error:', err)
        // eslint-disable-next-line no-alert
        alert(err?.message || 'Lỗi không xác định khi chạy Autopilot.')
        setRunProgress((prev) => ({
          ...prev,
          status: 'error',
          error: err?.message || 'Lỗi khi khởi động Autopilot.',
        }))
      })
  }

  useEffect(() => {
    if (!isResizingPanels) return

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!layoutRef.current) return
      const rect = layoutRef.current.getBoundingClientRect()
      const rawRatio = (event.clientX - rect.left) / rect.width
      // Không cho panel "Kế hoạch sản xuất theo ngày" nhỏ quá để tránh vỡ layout
      const clamped = Math.min(0.7, Math.max(0.45, rawRatio))
      setPanelRatio(clamped)
    }

    const handleMouseUp = () => {
      setIsResizingPanels(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingPanels])

  const handleCancel = () => {
    const w = window as any
    if (w.api?.autopilot?.cancel) {
      w.api.autopilot
        .cancel()
        .catch((err: any) => {
          console.warn('[Autopilot] cancel error:', err)
        })
    }

    setRunProgress((prev) => ({
      ...prev,
      status: 'idle',
      currentDayIndex: null,
      currentStep: null,
      stepPercent: 0,
      message: 'Đã gửi yêu cầu hủy Autopilot.',
      error: undefined,
    }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', color: '#e5e7eb' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h2 style={{ margin: 0 }}>Autopilot</h2>
        <p style={{ margin: 0, color: '#cbd5e1', fontSize: '13px', lineHeight: 1.6 }}>
          Lập kế hoạch sản xuất theo ngày, cấu hình thư mục và chạy Autopilot để quét nhạc, tạo playlist, ghép video, xuất
          video hoàn chỉnh. Đảm bảo đã chọn đủ thư mục và kế hoạch trước khi chạy.
        </p>
      </div>

      <div
        ref={layoutRef}
        style={{
          display: 'flex',
          gap: '12px',
          alignItems: 'stretch',
          minHeight: '420px',
        }}
      >
        <div style={{ flex: panelRatio, minWidth: '45%' }}>
          <DayPlansSection
            dayPlans={dayPlans}
            selectedDayPlanId={selectedDayPlanId}
            onSelect={setSelectedDayPlanId}
            onAddDay={handleAddDay}
            onCopyFromSelected={handleCopyFromSelected}
            onUpdateDay={handleUpdateDay}
            onDeleteDay={handleDeleteDay}
            onOpenDetail={setDetailOpenFor}
          />
        </div>

        <div
          onMouseDown={() => setIsResizingPanels(true)}
          style={{
            width: '6px',
            cursor: 'col-resize',
            backgroundColor: '#1f2937',
            borderRadius: '4px',
            alignSelf: 'stretch',
          }}
          title="Kéo để thay đổi độ rộng cột"
        />

        <div style={{ flex: 1 - panelRatio, minWidth: '35%' }}>
          <FoldersAndSourcesSection
            foldersConfig={foldersConfig}
            onChange={(patch) => setFoldersConfig((prev) => ({ ...prev, ...patch }))}
            videoSelectionInfo={videoSelectionInfo}
          />
        </div>
      </div>

      <AutopilotControlSection
        config={config}
        runProgress={runProgress}
        onStart={simulateStartAutopilot}
        onCancel={handleCancel}
      />

        <section
          style={{
            border: '1px solid #374151',
            borderRadius: '8px',
          padding: '12px',
          backgroundColor: '#0b1220',
            display: 'flex',
            flexDirection: 'column',
          gap: '10px',
          minHeight: '220px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '15px' }}>Log realtime</h3>
        <div
          ref={logContainerRef}
            style={{
            backgroundColor: '#0f172a',
            border: '1px solid #1f2937',
            borderRadius: '6px',
            padding: '8px',
            height: '240px',
              overflowY: 'auto',
            fontFamily: 'monospace',
              fontSize: '12px',
            color: '#e2e8f0',
          }}
        >
          {logMessages.length === 0 && <div style={{ color: '#94a3b8' }}>Chưa có log.</div>}
          {logMessages.map((log, idx) => (
            <div key={`${log.timestamp}-${idx}`} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: '#60a5fa' }}>{log.timestamp}</span>{' '}
              <span style={{ color: log.level === 'error' ? '#f87171' : log.level === 'warn' ? '#fbbf24' : '#a5f3fc' }}>
                [{log.level.toUpperCase()}]
                    </span>{' '}
              <span>{log.message}</span>
                  </div>
          ))}
          </div>
        </section>

      <DayPlanDetailDialog
        plan={currentDetailPlan}
        overrides={currentOverrides}
        open={!!detailOpenFor}
        onClose={() => setDetailOpenFor(null)}
        onSave={handleSaveOverrides}
        foldersConfig={foldersConfig}
      />
    </div>
  )
}

// Disabled screen placeholder
function AutopilotComingSoon() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '24px',
      }}
    >
      <div
        style={{
          maxWidth: '520px',
          width: '100%',
          backgroundColor: '#7f1d1d',
          border: '1px solid #b91c1c',
          borderRadius: '12px',
          padding: '24px 28px',
          color: '#fef2f2',
          boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '28px', marginBottom: '12px' }}>🚧</div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 700 }}>
          Tính Năng Đang Được Phát Triển
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: '14px', lineHeight: 1.5 }}>
          Chức năng Autopilot hiện đang được phát triển và tạm thời chưa sẵn sàng sử dụng.
        </p>
        <p style={{ margin: 0, fontSize: '13px', color: '#fecdd3' }}>
          Vui lòng quay lại sau. Cảm ơn bạn đã kiên nhẫn!
        </p>
      </div>
    </div>
  )
}

import BatchModeTab from './Autopilot/BatchModeTab'
import PoolMonitorTab from './Autopilot/PoolMonitorTab'

type AutopilotTabMode = 'plan' | 'batch' | 'pool'

export default function AutopilotPage() {
  const [mode, setMode] = useState<AutopilotTabMode>('plan')
  // Track if each tab was ever mounted (lazy-mount)
  const [planMounted, setPlanMounted] = useState(true)
  const [batchMounted, setBatchMounted] = useState(false)
  const [poolMounted, setPoolMounted] = useState(false)

  // Lazy-mount: mount tab khi lần đầu chọn, giữ nguyên khi chuyển tab
  if (mode === 'batch' && !batchMounted) setBatchMounted(true)
  if (mode === 'plan' && !planMounted) setPlanMounted(true)
  if (mode === 'pool' && !poolMounted) setPoolMounted(true)

  const tabStyle = (tab: AutopilotTabMode): React.CSSProperties => ({
    padding: '10px 24px',
    borderRadius: '6px 6px 0 0',
    border: 'none',
    backgroundColor: mode === tab ? '#007acc' : '#2d2d2d',
    color: '#fff',
    fontWeight: mode === tab ? 'bold' : 'normal',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all 0.2s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: '4px', padding: '12px 12px 0', borderBottom: '1px solid #444' }}>
        <button type="button" onClick={() => setMode('plan')} style={tabStyle('plan')}>
          Plan Mode
        </button>
        <button type="button" onClick={() => setMode('batch')} style={tabStyle('batch')}>
          Batch Mode
        </button>
        <button type="button" onClick={() => setMode('pool')} style={tabStyle('pool')}>
          Pool Monitor
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* display:none giữ state khi chuyển tab, lazy-mount tránh render không cần thiết */}
        {planMounted && (
          <div style={{ display: mode === 'plan' ? 'block' : 'none', height: '100%' }}>
            <AutopilotPageLegacy />
          </div>
        )}
        {batchMounted && (
          <div style={{ display: mode === 'batch' ? 'block' : 'none', height: '100%', padding: '12px' }}>
            <BatchModeTab />
          </div>
        )}
        {poolMounted && (
          <div style={{ display: mode === 'pool' ? 'block' : 'none', height: '100%' }}>
            <PoolMonitorTab />
          </div>
        )}
      </div>
    </div>
  )
}

