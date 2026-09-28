/** 期限监控里批量文号用分号、空格或换行隔开。提交时统一成半角分号。 */
const VOLUME_SPLIT = /[\s;；]+/

export function splitCaseVolumes(text: string): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const part of text.split(VOLUME_SPLIT)) {
    const volume = part.trim()
    if (!volume || volume.length > 80 || seen.has(volume)) continue
    seen.add(volume)
    output.push(volume)
    if (output.length >= 300) break
  }
  return output
}

export function joinCaseVolumes(volumes: string[]): string {
  return volumes.join(';')
}
