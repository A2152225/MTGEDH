// Local ambient declarations to satisfy dev tsc until typed packages added.

declare module "uuid" {
  export function v4(): string;
}

// Minimal Better-SQLite3 declarations to satisfy common usage
declare module "better-sqlite3" {
  class BetterSqlite3Database {
    constructor(file: string);
    pragma(setting: string): void;
    exec(sql: string): void;
    prepare<T extends any[]>(sql: string): {
      run(...params: T): { changes: number; lastInsertRowid: number | bigint };
      get(...params: T): any;
      all(...params: T): any[];
    };
  }
  export default BetterSqlite3Database;

  // Back-compat namespace type (Database.Database) used in code
  export namespace Database {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    export interface Database extends BetterSqlite3Database {}
  }
}