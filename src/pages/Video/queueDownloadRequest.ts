import type { YouTubeDownloadVideoRequest } from '../../types/ipc'

export function createQueueVideoRequest(
  url: string,
  options: Omit<YouTubeDownloadVideoRequest, 'url'>,
): YouTubeDownloadVideoRequest {
  return { url, ...options }
}
