import { useState, useEffect } from 'react'
import SingleCutTabSimple from './SingleCutTabSimple'
import MultiCutTab from './MultiCutTab'
import MergeTab from './MergeTab'
import MuteAudioTab from './MuteAudioTab'
import NormalizeVideoTab from './NormalizeVideoTab'
import ExtractAudioTab from './ExtractAudioTab'
import AuditFilesTab from './AuditFilesTab'

type VideoTab = 'single' | 'multi' | 'merge' | 'mute' | 'normalize' | 'extract-audio' | 'audit'

function CutMergeVideoPage() {
  console.log('[CutMergeVideoPage] Component mounted/rendered')

  const [activeTab, setActiveTab] = useState<VideoTab>('single')

  useEffect(() => {
    console.log('[CutMergeVideoPage] useEffect - component mounted')
    return () => {
      console.log('[CutMergeVideoPage] useEffect cleanup - component unmounted')
    }
  }, [])

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e', color: '#e0e0e0' }}>
      <h2 style={{ marginBottom: '20px', fontSize: '24px', fontWeight: 'bold' }}>
        Cắt/Ghép video
      </h2>

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #444' }}>
        <button
          onClick={() => setActiveTab('single')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'single' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'single' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Cắt đơn
        </button>
        <button
          onClick={() => setActiveTab('multi')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'multi' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'multi' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Cắt nhiều
        </button>
        <button
          onClick={() => setActiveTab('merge')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'merge' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'merge' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Ghép
        </button>
        <button
          onClick={() => setActiveTab('mute')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'mute' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'mute' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Tắt âm thanh
        </button>
        <button
          onClick={() => setActiveTab('normalize')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'normalize' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'normalize' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Chuẩn hóa video
        </button>
        <button
          onClick={() => setActiveTab('extract-audio')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'extract-audio' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'extract-audio' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Tách âm thanh
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'audit' ? '#007acc' : '#2d2d2d',
            color: '#fff',
            border: 'none',
            borderRadius: '6px 6px 0 0',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'audit' ? 'bold' : 'normal',
            transition: 'all 0.2s',
          }}
        >
          Rà soát file
        </button>
      </div>

      {/* Tab content — keep-alive: tất cả tabs luôn mounted, chỉ ẩn/hiện bằng CSS để giữ state */}
      <div style={{ flex: 1 }}>
        <div style={{ display: activeTab === 'single' ? 'block' : 'none', height: '100%' }}><SingleCutTabSimple /></div>
        <div style={{ display: activeTab === 'multi' ? 'block' : 'none', height: '100%' }}><MultiCutTab /></div>
        <div style={{ display: activeTab === 'merge' ? 'block' : 'none', height: '100%' }}><MergeTab /></div>
        <div style={{ display: activeTab === 'mute' ? 'block' : 'none', height: '100%' }}><MuteAudioTab /></div>
        <div style={{ display: activeTab === 'normalize' ? 'block' : 'none', height: '100%' }}><NormalizeVideoTab /></div>
        <div style={{ display: activeTab === 'extract-audio' ? 'block' : 'none', height: '100%' }}><ExtractAudioTab /></div>
        <div style={{ display: activeTab === 'audit' ? 'block' : 'none', height: '100%' }}><AuditFilesTab /></div>
      </div>
    </div>
  )
}

export default CutMergeVideoPage
