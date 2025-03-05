# Contact

<a href="https://discord.gg/RHxrPUwmUP">
  <img src="https://r.resimlink.com/LZh-kGtb.png" alt="Gomui" width="20" height="20" style="vertical-align: middle; margin-right: 5px;">
  Discord Support Server
</a>


# GrokDB

GrokDB is a high-performance, secure, and feature-rich SQLite database wrapper for Node.js applications. Built with TypeScript and powered by better-sqlite3, it provides a modern and type-safe interface for database operations.

## System Requirements

- Node.js >= 16.0.0
- SQLite3
- Operating Systems:
  - Linux (x64, arm64)
  - macOS (x64, arm64)
  - Windows (x64)

## Features

- 🚀 High-performance SQLite operations
- 🔒 Built-in encryption support
- 📝 Schema validation with Zod
- 🔄 Transaction support
- 🏗️ Advanced table relationships
- 🔍 Indexing support
- 🛡️ Type safety with TypeScript
- 💾 Automatic backups
- 🔐 Foreign key constraints
- 📊 Query builder with pagination
- 🔄 JSON field support
- 📦 Migration system
- 🎯 Event system
- 🗑️ Soft delete support
- 🖥️ Interactive CLI

## Installation

```bash
npm install grokdb
```

## Quick Start

```typescript
import { GrokDB } from 'grokdb';
import { z } from 'zod';

// Create a database instance
const db = new GrokDB('myapp.db', {
  encryptionKey: 'your-secret-key', // Optional
  timeout: 5000,                    // Optional
  readonly: false,                  // Optional
});

// Define a schema with relationships
db.createTable('users', {
  id: { 
    type: 'INTEGER', 
    primary: true 
  },
  email: { 
    type: 'TEXT', 
    unique: true, 
    notNull: true,
    index: true 
  },
  password: { 
    type: 'TEXT', 
    notNull: true,
    encrypted: true  // Automatically encrypted/decrypted
  },
  created_at: { 
    type: 'DATETIME', 
    default: 'CURRENT_TIMESTAMP' 
  }
});

db.createTable('posts', {
  id: { 
    type: 'INTEGER', 
    primary: true 
  },
  user_id: { 
    type: 'INTEGER',
    notNull: true,
    foreignKey: {
      table: 'users',
      column: 'id',
      onDelete: 'CASCADE'
    }
  },
  title: { 
    type: 'TEXT', 
    notNull: true 
  },
  content: { 
    type: 'TEXT' 
  }
});

// Add schema validation
const userSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

db.setValidator('users', userSchema);

// Basic CRUD Operations

// Create
const userId = db.insert('users', {
  email: 'user@example.com',
  password: 'securepass123'
});

// Read with pagination
const users = db.find('users', 
  { /* where conditions */ },
  { 
    limit: 10, 
    offset: 0,
    orderBy: {
      column: 'created_at',
      direction: 'DESC'
    }
  }
);

// Update
db.update('users',
  { password: 'newpassword123' },
  { email: 'user@example.com' }
);

// Delete
db.delete('users', { email: 'user@example.com' });

// Using Transactions
const transaction = db.transaction();

try {
  db.insert('users', { /* user data */ });
  db.insert('posts', { /* post data */ });
  transaction.commit();
} catch (error) {
  transaction.rollback();
  console.error('Transaction failed:', error);
}

// Backup database
db.backup('backup.db');

// Close connection
db.close();
```

## Advanced Features

### 1. JSON Fields

GrokDB supports automatic JSON serialization and deserialization:

```typescript
// Define a table with JSON field
db.createTable('settings', {
  id: { type: 'INTEGER', primary: true },
  config: { type: 'TEXT', json: true } // Automatic JSON handling
});

// Insert JSON data
db.insert('settings', {
  config: { 
    theme: 'dark',
    notifications: true,
    preferences: {
      language: 'en',
      timezone: 'UTC'
    }
  }
});

// Read JSON data (automatically parsed)
const settings = db.findOne('settings', { id: 1 });
console.log(settings.config.theme); // 'dark'
console.log(settings.config.preferences.language); // 'en'
```

### 2. Migration System

Manage database schema changes with migrations:

```typescript
// Create a new migration
await db.createMigration('add_user_settings');

// Migration file example (migrations/20240224_add_user_settings.ts)
export default {
  up: (db: GrokDB) => {
    db.alterTable('users', {
      settings: { type: 'TEXT', json: true }
    });
  },
  down: (db: GrokDB) => {
    db.dropColumn('users', 'settings');
  }
};

// Run migrations
await db.migrate(); // Apply pending migrations
await db.migrate('down'); // Rollback migrations
```

### 3. Event System

Listen for database events:

```typescript
// Listen for insert events
db.on('users:insert', (data) => {
  console.log(`New user created: ${data.id}`);
  // Trigger notifications, update cache, etc.
});

// Listen for updates
db.on('users:update', ({ where, data }) => {
  console.log(`User updated:`, data);
});

// Transaction events
db.on('transaction:commit', () => {
  console.log('Transaction completed successfully');
});

db.on('transaction:rollback', () => {
  console.log('Transaction rolled back');
});
```

### 4. Soft Delete

Implement soft delete functionality:

```typescript
// Define table with soft delete
db.createTable('posts', {
  id: { type: 'INTEGER', primary: true },
  title: { type: 'TEXT' },
  content: { type: 'TEXT' },
  deleted_at: { type: 'DATETIME', softDelete: true } // Enable soft delete
});

// Soft delete a record
db.delete('posts', { id: 1 }); // Sets deleted_at timestamp

// Query excluding deleted records (default)
const activePosts = db.find('posts');

// Query including deleted records
const allPosts = db.find('posts', {}, { includeDeleted: true });
```

### 5. CLI Tool

Manage your database from the command line:

```bash
# Create a new migration
npx grokdb create-migration add_new_feature

# Run migrations
npx grokdb migrate
npx grokdb migrate --down  # Rollback

# Start interactive CLI
npx grokdb cli
```

Interactive CLI features:
- Execute SQL queries
- View table schemas
- Manage data
- Run migrations
- Export/import data

## Best Practices

1. **Connection Management**
```typescript
try {
  // Database operations
} finally {
  db.close(); // Always close the connection
}
```

2. **Error Handling**
```typescript
try {
  const transaction = db.transaction();
  // Operations
  transaction.commit();
} catch (error) {
  transaction.rollback();
  console.error('Error:', error);
}
```

3. **Type Safety**
```typescript
interface User {
  id: number;
  email: string;
  password: string;
}

const users = db.find('users') as User[];
```

4. **Validation**
```typescript
// Always set validators for tables with user input
db.setValidator('users', userSchema);
```

5. **Indexing**
```typescript
// Add indexes for frequently queried columns
{
  email: { type: 'TEXT', index: true }
}
```

## Performance Considerations

1. Use transactions for multiple operations
2. Create indexes for frequently queried columns
3. Use appropriate column types
4. Keep encrypted fields to a minimum
5. Use prepared statements (automatic with FluxDB)
6. Enable WAL mode for better concurrency (enabled by default)
7. Use JSON fields judiciously
8. Implement proper indexing strategies
9. Monitor and optimize queries
10. Regular database maintenance

## Security Features

1. Automatic field encryption
2. Input validation
3. Prepared statements
4. Type safety
5. Foreign key constraints
6. Schema validation
7. Secure defaults
8. Audit trails through events
9. Access control patterns
10. Data integrity checks

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
