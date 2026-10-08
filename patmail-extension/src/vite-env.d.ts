/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

declare module '*.css?inline' {
  const css: string
  export default css
}

declare module 'sql.js' {
  interface SqlStatement {
    run(values: unknown[]): void
    free(): void
  }
  interface SqlDatabase {
    run(sql: string): void
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
    prepare(sql: string): SqlStatement
    export(): Uint8Array
    close(): void
  }
  export interface SqlStatic {
    Database: new (data?: Uint8Array) => SqlDatabase
  }
  export default function initSqlJs(config?: { wasmBinary?: ArrayBuffer }): Promise<SqlStatic>
}
