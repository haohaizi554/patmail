export interface ReviewPreview {
  state: 'PENDING' | 'BLOCKED'
  self: boolean
  reason: string
}

/** 本阶段只确认身份。没有已核对的审核写接口，不生成审核请求。 */
export function previewReview(currentUserId: string | null, reviewerId: string | null): ReviewPreview {
  if (!currentUserId || !reviewerId || currentUserId.toLowerCase() !== reviewerId.toLowerCase()) {
    return { state: 'BLOCKED', self: false, reason: '当前用户 GUID 与候选审核人不一致。没有已核对的审核接口，不能改选其他人。' }
  }
  return { state: 'PENDING', self: true, reason: '已确认当前用户在候选审核人中。审核写接口尚未核对，不能执行审核。' }
}
