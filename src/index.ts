import Database from 'better-sqlite3';
import { join } from 'path';
import { z } from 'zod';
import CryptoJS from 'crypto-js';
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export type ColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB' | 'NULL' | 'DATETIME';

export interface ColumnDefinition {
  type: ColumnType;
  primary?: boolean;
  unique?: boolean;
  default?: any;
  notNull?: boolean;
  encrypted?: boolean;
  index?: boolean;
  json?: boolean;
  softDelete?: boolean;
  foreignKey?: {
    table: string;
    column: string;
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  };
}

export type TableSchema = {
  [key: string]: ColumnDefinition;
};

export interface QueryOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  orderBy?: {
    column: string;
    direction: 'ASC' | 'DESC';
  };
}

export interface Transaction {
  commit(): void;
  rollback(): void;
}

export interface Migration {
  up: (db: GrokDB) => void;
  down: (db: GrokDB) => void;
}

export class GrokDB extends EventEmitter {
  private db: Database.Database;
  private tables: Map<string, TableSchema>;
  private encryptionKey?: string;
  private validators: Map<string, z.ZodSchema>;
  private migrationPath: string;

  constructor(path: string, options: { 
    encryptionKey?: string;
    timeout?: number;
    readonly?: boolean;
    fileMustExist?: boolean;
    migrationPath?: string;
  } = {}) {
    super();
    this.db = new Database(join(process.cwd(), path), {
      timeout: options.timeout || 5000,
      readonly: options.readonly || false,
      fileMustExist: options.fileMustExist || false,
    });
    this.tables = new Map();
    this.validators = new Map();
    this.encryptionKey = options.encryptionKey;
    this.migrationPath = options.migrationPath || './migrations';

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create migrations directory if it doesn't exist
    if (!existsSync(this.migrationPath)) {
      mkdirSync(this.migrationPath, { recursive: true });
    }
  }

  /**
   * Create a new migration file
   */
  async createMigration(name: string) {
    const timestamp = new Date().toISOString().replace(/\D/g, '');
    const filename = `${timestamp}_${name}.ts`;
    const path = join(this.migrationPath, filename);

    const template = `
import { GrokDB } from '../src/index';

export default {
  up: (db: GrokDB) => {
    // Add your migration code here
  },
  down: (db: GrokDB) => {
    // Add your rollback code here
  }
};
`;

    writeFileSync(path, template);
    return path;
  }

  /**
   * Run migrations
   */
  async migrate(direction: 'up' | 'down' = 'up') {
    const migrations = this.db.prepare(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const files = existsSync(this.migrationPath) 
      ? readdirSync(this.migrationPath)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
        .sort()
      : [];

    for (const file of files) {
      const migration = require(join(this.migrationPath, file)).default;
      
      if (direction === 'up') {
        const executed = this.db.prepare('SELECT * FROM migrations WHERE name = ?').get(file);
        if (!executed) {
          migration.up(this);
          this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
        }
      } else {
        const executed = this.db.prepare('SELECT * FROM migrations WHERE name = ?').get(file);
        if (executed) {
          migration.down(this);
          this.db.prepare('DELETE FROM migrations WHERE name = ?').run(file);
        }
      }
    }
  }

  /**
   * Create a new table with the specified schema
   */
  createTable(name: string, schema: TableSchema) {
    const columns: string[] = [];
    const foreignKeys: string[] = [];
    const indices: string[] = [];

    Object.entries(schema).forEach(([key, config]) => {
      let def = `${key} ${config.type}`;
      if (config.primary) def += ' PRIMARY KEY';
      if (config.unique) def += ' UNIQUE';
      if (config.notNull) def += ' NOT NULL';
      if (config.default !== undefined) def += ` DEFAULT ${JSON.stringify(config.default)}`;

      columns.push(def);

      if (config.foreignKey) {
        foreignKeys.push(
          `FOREIGN KEY (${key}) REFERENCES ${config.foreignKey.table}(${config.foreignKey.column})` +
          (config.foreignKey.onDelete ? ` ON DELETE ${config.foreignKey.onDelete}` : '') +
          (config.foreignKey.onUpdate ? ` ON UPDATE ${config.foreignKey.onUpdate}` : '')
        );
      }

      if (config.index) {
        indices.push(`CREATE INDEX IF NOT EXISTS idx_${name}_${key} ON ${name}(${key})`);
      }
    });

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${name} (
        ${[...columns, ...foreignKeys].join(',\n')}
      )
    `;

    this.db.prepare(createTableSQL).run();
    indices.forEach(indexSQL => this.db.prepare(indexSQL).run());
    
    this.tables.set(name, schema);
    return this;
  }

  /**
   * Begin a new transaction
   */
  transaction(): Transaction {
    this.db.prepare('BEGIN').run();

    return {
      commit: () => {
        this.db.prepare('COMMIT').run();
        this.emit('transaction:commit');
      },
      rollback: () => {
        this.db.prepare('ROLLBACK').run();
        this.emit('transaction:rollback');
      }
    };
  }

  /**
   * Set a validator for a table
   */
  setValidator(table: string, schema: z.ZodSchema) {
    this.validators.set(table, schema);
  }

  private processValue(value: any, config: ColumnDefinition): any {
    if (config.json && value !== null) {
      return typeof value === 'string' ? JSON.parse(value) : JSON.stringify(value);
    }
    
    if (config.encrypted && typeof value === 'string') {
      return this.encryptionKey 
        ? CryptoJS.AES.encrypt(value, this.encryptionKey).toString()
        : value;
    }

    return value;
  }

  private unprocessValue(value: any, config: ColumnDefinition): any {
    if (config.json && value !== null) {
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
    
    if (config.encrypted && typeof value === 'string' && this.encryptionKey) {
      try {
        const bytes = CryptoJS.AES.decrypt(value, this.encryptionKey);
        return bytes.toString(CryptoJS.enc.Utf8);
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * Insert data into a table
   */
  insert(table: string, data: Record<string, any>) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    // Validate data if validator exists
    const validator = this.validators.get(table);
    if (validator) {
      validator.parse(data);
    }

    const processedData = { ...data };
    Object.entries(schema).forEach(([key, config]) => {
      if (key in processedData) {
        processedData[key] = this.processValue(processedData[key], config);
      }
    });

    const columns = Object.keys(processedData).join(', ');
    const values = Object.values(processedData);
    const placeholders = values.map(() => '?').join(', ');

    const stmt = this.db.prepare(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`
    );
    const result = stmt.run(values);

    this.emit(`${table}:insert`, { ...data, id: result.lastInsertRowid });
    return result;
  }

  /**
   * Find records in a table
   */
  find(table: string, where: Record<string, any> = {}, options: QueryOptions = {}) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    const conditions = [];
    const values = [];

    // Handle soft deletes
    const hasSoftDelete = Object.entries(schema).some(([_, config]) => config.softDelete);
    if (hasSoftDelete && !options.includeDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    Object.entries(where).forEach(([key, value]) => {
      conditions.push(`${key} = ?`);
      values.push(value);
    });

    let query = conditions.length
      ? `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')}`
      : `SELECT * FROM ${table}`;

    if (options.orderBy) {
      query += ` ORDER BY ${options.orderBy.column} ${options.orderBy.direction}`;
    }

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
      if (options.offset) {
        query += ` OFFSET ${options.offset}`;
      }
    }

    const stmt = this.db.prepare(query);
    const results = stmt.all(values);

    return results.map(row => {
      const unprocessedRow = { ...row };
      Object.entries(schema).forEach(([key, config]) => {
        if (key in unprocessedRow) {
          unprocessedRow[key] = this.unprocessValue(unprocessedRow[key], config);
        }
      });
      return unprocessedRow;
    });
  }

  /**
   * Find a single record
   */
  findOne(table: string, where: Record<string, any> = {}, options: QueryOptions = {}) {
    const results = this.find(table, where, { ...options, limit: 1 });
    return results[0] || null;
  }

  /**
   * Update records in a table
   */
  update(table: string, data: Record<string, any>, where: Record<string, any>) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    // Validate data if validator exists
    const validator = this.validators.get(table);
    if (validator) {
      validator.partial().parse(data);
    }

    const processedData = { ...data };
    Object.entries(schema).forEach(([key, config]) => {
      if (key in processedData) {
        processedData[key] = this.processValue(processedData[key], config);
      }
    });

    const setClause = Object.keys(processedData)
      .map(key => `${key} = ?`)
      .join(', ');

    const whereClause = Object.keys(where)
      .map(key => `${key} = ?`)
      .join(' AND ');

    const stmt = this.db.prepare(
      `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`
    );
    const result = stmt.run([...Object.values(processedData), ...Object.values(where)]);

    this.emit(`${table}:update`, { where, data });
    return result;
  }

  /**
   * Delete records from a table
   */
  delete(table: string, where: Record<string, any>) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    // Check for soft delete
    const softDeleteColumn = Object.entries(schema).find(([_, config]) => config.softDelete)?.[0];

    if (softDeleteColumn) {
      return this.update(table, { [softDeleteColumn]: new Date().toISOString() }, where);
    }

    const conditions = Object.entries(where)
      .map(([key]) => `${key} = ?`)
      .join(' AND ');

    const stmt = this.db.prepare(`DELETE FROM ${table} WHERE ${conditions}`);
    const result = stmt.run(Object.values(where));

    this.emit(`${table}:delete`, where);
    return result;
  }

  /**
   * Execute a raw SQL query
   */
  query(sql: string, params: any[] = []) {
    return this.db.prepare(sql).all(params);
  }

  /**
   * Get table schema
   */
  getSchema(table: string) {
    return this.tables.get(table);
  }

  /**
   * Alter table schema
   */
  alterTable(table: string, newColumns: Record<string, ColumnDefinition>) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    Object.entries(newColumns).forEach(([columnName, config]) => {
      let sql = `ALTER TABLE ${table} ADD COLUMN ${columnName} ${config.type}`;
      
      if (config.notNull) sql += ' NOT NULL';
      if (config.default !== undefined) sql += ` DEFAULT ${JSON.stringify(config.default)}`;
      
      this.db.prepare(sql).run();
      
      if (config.index) {
        this.db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_${table}_${columnName} ON ${table}(${columnName})`
        ).run();
      }
    });

    this.tables.set(table, { ...schema, ...newColumns });
    return this;
  }

  /**
   * Drop a column from a table
   */
  dropColumn(table: string, column: string) {
    const schema = this.tables.get(table);
    if (!schema) throw new Error(`Table ${table} does not exist`);

    // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    const newSchema = { ...schema };
    delete newSchema[column];

    const tempTable = `${table}_temp`;
    this.createTable(tempTable, newSchema);

    const columns = Object.keys(newSchema).join(', ');
    this.db.prepare(`INSERT INTO ${tempTable} SELECT ${columns} FROM ${table}`).run();
    this.db.prepare(`DROP TABLE ${table}`).run();
    this.db.prepare(`ALTER TABLE ${tempTable} RENAME TO ${table}`).run();

    this.tables.set(table, newSchema);
    return this;
  }

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }

  /**
   * Backup the database
   */
  backup(destination: string) {
    return this.db.backup(destination);
  }
  }
