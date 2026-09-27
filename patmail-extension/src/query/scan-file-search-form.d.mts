import type { FileSearchFormField } from '../shared/message'

export function scanFileSearchForm(doc?: Document): { page: string; fields: FileSearchFormField[] }
export function warmFileSearchTrees(doc?: Document): Promise<void>
