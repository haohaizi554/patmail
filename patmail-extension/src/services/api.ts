/**
 * 后续独立后端服务的预留位置。
 * 当前只读 EASY 浏览器端 API Runtime 位于 src/api/，不在这里代理会话。
 */
export interface ReservedApiClient {
  readonly implemented: false
}
