import type { FileSearchEnvironment } from './file-search-params'

export const EASY_ORIGIN = 'http://183.36.43.66:88'

/** 业务 API 只信任当前 EASY Origin；本地页面仍可用于独立的 Scanner 验收。 */
export function trustedOrigin(pageOrigin: string): string | null {
  try {
    const url = new URL(pageOrigin)
    if (url.origin === EASY_ORIGIN) return EASY_ORIGIN
  } catch {
    return null
  }
  return null
}

/**
 * 当前环境配置来自 API/04-文件查询.md 中已验证请求。
 * 这些内部 ID 与列配置不代表其他租户；以后由动态 Schema 替换。
 */
export const CURRENT_ENVIRONMENT: FileSearchEnvironment = {
  fileClass: 'general',
  caseTypeId: '31D1A147-2931-43B5-94AE-B72B1525BA8A',
  isPatent: 0,
  colsel: ';undefined;undefined;case_id;file_name;file_status;case_volume;case_volume_customer;app_no;case_name;file_type;file_desc;post_date;upload_time;ctrl_proc_name;apply_type;customer_name;customer_status;legal_due_date;case_status;'
}
