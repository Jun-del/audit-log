# Capture Configuration

## Overview

The audit logger provides configuration options to control what data is captured during UPDATE and DELETE operations. This is particularly useful for performance optimization in high-volume scenarios.

## Configuration Options

### `captureOldValues` (default: `true`)

Controls whether "before" values are captured for UPDATE operations.

When **enabled** (default):

- A SELECT query is executed before each UPDATE to capture current values
- Audit logs include both `oldValues` and `newValues`
- You can see what changed from → to

When **disabled**:

- Skips the SELECT query before UPDATE
- Audit logs only include `newValues`
- Saves a database round-trip per update
- Better performance for high-volume updates where you don't need the "before" state

### `captureDeletedValues` (default: `true`)

Controls whether values are captured for DELETE operations.

When **enabled** (default):

- A SELECT query is executed before each DELETE to capture what's being deleted
- Audit logs include the deleted record in `oldValues`
- You can see what was deleted

When **disabled**:

- Skips the SELECT query before DELETE
- No audit log is created (since we don't know what to log)
- Better performance for high-volume deletes where you don't need to track deletions

## Usage Examples

### Example 1: High-Performance Mode

If you're doing bulk updates and don't need to track the previous values:

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users", "orders"],
  captureOldValues: false, // Skip SELECT before UPDATE
  captureDeletedValues: false, // Skip SELECT before DELETE
});
```

**Result**: Faster updates and deletes, but audit logs only show:

- UPDATE: `newValues` only (no `oldValues`)
- DELETE: No audit logs created

### Example 2: Compliance Mode (Default)

For audit compliance where you need complete history:

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users", "financial_transactions"],
  captureOldValues: true, // Capture before state (default)
  captureDeletedValues: true, // Capture deleted records (default)
});
```

**Result**: Complete audit trail with before/after states, at the cost of additional SELECT queries.

### Example 3: Mixed Mode

Capture old values for updates but skip deleted values:

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureOldValues: true, // Need to track changes
  captureDeletedValues: false, // Don't care about deletions
});
```

## Performance Impact

### With `captureOldValues: true` (default)

```typescript
// What happens behind the scenes:
await db.update(users).set({ name: "New Name" }).where(eq(users.id, 1)).returning();

// 1. SELECT * FROM users WHERE id = 1;        ← Extra query
// 2. UPDATE users SET name = 'New Name' WHERE id = 1 RETURNING *;
// 3. INSERT INTO audit_logs (...);
```

**Cost**: 3 queries per update

### With `captureOldValues: false`

```typescript
// What happens behind the scenes:
await db.update(users).set({ name: "New Name" }).where(eq(users.id, 1)).returning();

// 1. UPDATE users SET name = 'New Name' WHERE id = 1 RETURNING *;
// 2. INSERT INTO audit_logs (...);            ← No SELECT!
```

**Cost**: 2 queries per update (33% faster)

## Audit Log Differences

### With `captureOldValues: true`

```json
{
  "action": "UPDATE",
  "tableName": "users",
  "recordId": "123",
  "oldValues": {
    "id": 123,
    "name": "Old Name",
    "email": "old@example.com"
  },
  "newValues": {
    "id": 123,
    "name": "New Name",
    "email": "new@example.com"
  },
  "changedFields": ["name", "email"]
}
```

### With `captureOldValues: false`

```json
{
  "action": "UPDATE",
  "tableName": "users",
  "recordId": "123",
  "oldValues": null,
  "newValues": {
    "id": 123,
    "name": "New Name",
    "email": "new@example.com"
  },
  "changedFields": null
}
```

## When to Disable Capturing

### Good Use Cases for `captureOldValues: false`

✅ Bulk status updates (e.g., marking orders as "processed")
✅ Counters and statistics (e.g., incrementing view counts)
✅ Session/token updates (high frequency, low importance)
✅ Cache invalidation timestamps
✅ Non-critical metadata updates

### Keep `captureOldValues: true` for

❌ Financial transactions (compliance requirement)
❌ User profile changes (accountability)
❌ Permission/role changes (security)
❌ Legal documents (regulatory requirement)
❌ Healthcare records (HIPAA compliance)

## Best Practices

1. **Start with defaults**: Use `captureOldValues: true` unless you have a specific performance need

2. **Profile before optimizing**: Measure whether the SELECT queries are actually a bottleneck

3. **Consider regulatory requirements**: Some industries require complete audit trails

4. **Use different loggers**: Create separate audit loggers with different configurations for different table groups:

```typescript
// Strict auditing for sensitive tables
const strictAudit = createAuditLogger(db, {
  tables: ["users", "payments"],
  captureOldValues: true,
  captureDeletedValues: true,
});

// Relaxed auditing for activity logs
const relaxedAudit = createAuditLogger(db, {
  tables: ["sessions", "analytics"],
  captureOldValues: false,
  captureDeletedValues: false,
});
```

## Migration Guide

If you have existing code and want to optimize:

### Before (implicit default)

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  // captureOldValues defaults to true
});
```

### After (explicit optimization)

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureOldValues: false, // Explicitly disable for performance
});
```

**Note**: This is a **breaking change** for audit log format. Make sure your audit log consumers can handle `null` in `oldValues`.

## Related Configuration

- See [Configuration](./configuration.md) for all available options
- See [Performance](./performance.md) for other optimization strategies
- See [Custom Writer](./custom-writer.md) for advanced audit log customization
