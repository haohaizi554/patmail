/** 按本地钟点。5 点到 11 点前是早上，11 点到 13 点前是中午，13 点到 18 点前是下午，其余是晚上。 */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  return '晚上好'
}
