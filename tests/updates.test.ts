import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isAllowedDownloadHost,
  isReleaseAssetUrl,
  parseReleaseNotes,
  parseVersion,
  pickReleaseAsset,
  releaseAssetName,
} from '../shared/updates'

describe('release versions', () => {
  it('compares semantic versions and ignores a leading v', () => {
    expect(parseVersion('v1.2.0')).toEqual([1, 2, 0])
    expect(compareVersions('1.0.0', '1.2.0')).toBe(-1)
    expect(compareVersions('1.2.0', 'v1.2.0')).toBe(0)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
  })

  it('picks the asset whose name includes the version and this computer', () => {
    expect(releaseAssetName('1.2.0', 'win32', 'x64')).toBe('MeetLocal-1.2.0-windows-x64.exe')
    expect(releaseAssetName('v1.2.0', 'darwin', 'arm64')).toBe('MeetLocal-1.2.0-mac-arm64.zip')
    const url = 'https://github.com/YHOneBox/Meet-Local/releases/download/v1.2.0/MeetLocal-1.2.0-windows-x64.exe'
    const asset = pickReleaseAsset(
      [
        { name: 'MeetLocal-1.2.0-mac-arm64.zip', url: url.replace('windows-x64.exe', 'mac-arm64.zip'), size: 10 },
        { name: 'MeetLocal-1.2.0-windows-x64.exe', url, size: 20 },
      ],
      '1.2.0',
      'win32',
      'x64',
    )
    expect(asset?.size).toBe(20)
    expect(isReleaseAssetUrl(url)).toBe(true)
    expect(isReleaseAssetUrl('https://example.com/MeetLocal-1.2.0-windows-x64.exe')).toBe(false)
    expect(isAllowedDownloadHost('https://release-assets.githubusercontent.com/download/file')).toBe(true)
    expect(isAllowedDownloadHost('https://evil.example/file')).toBe(false)
  })

  it('turns release notes into headings and lists', () => {
    const blocks = parseReleaseNotes('## Changes\n\n- Faster screen sharing\n- [Notes](https://example.com)\n\nThanks.')
    expect(blocks).toEqual([
      { type: 'heading', text: 'Changes' },
      { type: 'list', items: ['Faster screen sharing', '[Notes](https://example.com)'] },
      { type: 'paragraph', text: 'Thanks.' },
    ])
  })
})
