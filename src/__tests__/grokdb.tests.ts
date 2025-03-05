import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrokDB } from '../index';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { z } from 'zod';

const TEST_DB = 'test.sqlite';
const ENCRYPTION_KEY = 'test-secret-key';

describe('GrokDB', () => {
  let db: GrokDB;

  beforeEach(() => {
    db = new GrokDB(TEST_DB, { encryptionKey: ENCRYPTION_KEY });
    
    // Create test tables
    db.createTable('users', {
      id: { type: 'INTEGER', primary: true },
      email: { type: 'TEXT', unique: true, index: true },
      password: { type: 'TEXT', encrypted: true },
      settings: { type: 'TEXT', json: true },
      deleted_at: { type: 'DATETIME', softDelete: true },
      age: { type: 'INTEGER', default: 0 }
    });

    db.createTable('posts', {
      id: { type: 'INTEGER', primary: true },
      user_id: { 
        type: 'INTEGER',
        foreignKey: {
          table: 'users',
          column: 'id',
          onDelete: 'CASCADE'
        }
      },
      title: { type: 'TEXT', notNull: true },
      content: { type: 'TEXT' },
      metadata: { type: 'TEXT', json: true },
      deleted_at: { type: 'DATETIME', softDelete: true }
    });

    // Set up validator
    const userSchema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      settings: z.object({
        theme: z.string(),
        notifications: z.boolean()
      }).optional(),
      age: z.number().optional()
    });

    db.setValidator('users', userSchema);
  });

  afterEach(async () => {
    db.close();
    if (existsSync(TEST_DB)) {
      await unlink(TEST_DB);
    }
  });

  it('should handle JSON fields', () => {
    const settings = { theme: 'dark', notifications: true };
    
    db.insert('users', {
      email: 'json@test.com',
      password: 'password123',
      settings
    });

    const user = db.findOne('users', { email: 'json@test.com' });
    expect(user.settings).toEqual(settings);
  });

  it('should support soft delete', () => {
    db.insert('users', {
      email: 'softdelete@test.com',
      password: 'password123'
    });

    db.delete('users', { email: 'softdelete@test.com' });

    const userDefault = db.findOne('users', { email: 'softdelete@test.com' });
    expect(userDefault).toBeNull();

    const userWithDeleted = db.findOne(
      'users', 
      { email: 'softdelete@test.com' },
      { includeDeleted: true }
    );
    expect(userWithDeleted).toBeDefined();
    expect(userWithDeleted.deleted_at).toBeDefined();
  });

  it('should emit events', (done) => {
    db.on('users:insert', (data) => {
      expect(data.email).toBe('event@test.com');
      done();
    });

    db.insert('users', {
      email: 'event@test.com',
      password: 'password123'
    });
  });

  it('should handle migrations', async () => {
    await db.createMigration('add_status_column');
    await db.migrate();
    
    const schema = db.getSchema('users');
    expect(schema).toBeDefined();
  });

  it('should support transactions with events', (done) => {
    db.on('transaction:commit', () => {
      const user = db.findOne('users', { email: 'transaction@test.com' });
      expect(user).toBeDefined();
      done();
    });

    const transaction = db.transaction();

    try {
      db.insert('users', {
        email: 'transaction@test.com',
        password: 'password123'
      });
      transaction.commit();
    } catch (error) {
      transaction.rollback();
      throw error;
    }
  });
});
