# DELETE Operations Simplified

## Summary

Removed `captureDeletedValues` configuration. DELETE operations now **always** log using auto-injected `.returning()`.

## The Problem (Before)

Previously, we had two different approaches for DELETE:

### Approach 1: With `captureDeletedValues: true`

```typescript
// 1. SELECT query to get data before deletion
const beforeState = await db.select().from(users).where(eq(users.id, 1));

// 2. DELETE the record
await db.delete(users).where(eq(users.id, 1));

// 3. Create audit log using beforeState
await auditLogger.logDelete("users", beforeState);
```

**Problems:**

- Required an extra SELECT query (2 queries total)
- Performance overhead
- Complex logic to track `captureDeletedValues` config

### Approach 2: With `captureDeletedValues: false`

```typescript
// 1. DELETE the record
await db.delete(users).where(eq(users.id, 1));

// 2. No audit log created ❌
```

**Problem:**

- No audit trail at all!
- We don't know who deleted what
- Defeats the purpose of audit logging

## The Solution (Now)

Use Drizzle's `.returning()` to get deleted data in a **single query**:

```typescript
// 1. DELETE with .returning() (auto-injected)
const deleted = await db.delete(users).where(eq(users.id, 1)).returning();

// 2. Create audit log using deleted data
await auditLogger.logDelete("users", deleted);
```

**Benefits:**
✅ Single query - no SELECT needed
✅ Always logs deletes - no configuration needed
✅ Simpler code - less complexity
✅ Better performance - 1 query instead of 2

## Implementation

### Auto-Inject `.returning()` for DELETE

```typescript
// In createExecutionProxy()
if ((operation === "insert" || operation === "update" || operation === "delete") && !hasReturning) {
  if (typeof target.returning === "function") {
    queryToExecute = target.returning(); // ← Auto-inject
  }
}
```

### Use Returned Data for Audit Log

```typescript
// In createAuditLogs()
case "delete":
  // For DELETE, we use data from .returning() which is auto-injected
  // The deleted data is in the result
  if (records.length > 0) {
    debug(`Logging ${records.length} DELETE operations`);
    await auditLogger.logDelete(tableName, records);
  } else {
    debug("Skipping DELETE audit: no records matched or returned");
  }
  break;
```

## Configuration Changes

### Before

```typescript
interface AuditConfig {
  captureOldValues?: boolean; // For UPDATE
  captureDeletedValues?: boolean; // For DELETE ❌ REMOVED
}
```

### After

```typescript
interface AuditConfig {
  captureOldValues?: boolean; // For UPDATE only
  // No captureDeletedValues - DELETE always logs
}
```

## Query Comparison

### UPDATE (with `captureOldValues: true`)

```sql
-- 1. Get before state
SELECT * FROM users WHERE id = 1;

-- 2. Update with .returning() (auto-injected)
UPDATE users SET name = 'New' WHERE id = 1 RETURNING *;

-- 3. Create audit log
INSERT INTO audit_logs (...) VALUES (...);
```

**Total: 3 queries**

### UPDATE (with `captureOldValues: false`)

```sql
-- 1. Update with .returning() (auto-injected)
UPDATE users SET name = 'New' WHERE id = 1 RETURNING *;

-- 2. Create audit log (without old values)
INSERT INTO audit_logs (...) VALUES (...);
```

**Total: 2 queries** (33% faster)

### DELETE (always)

```sql
-- 1. Delete with .returning() (auto-injected)
DELETE FROM users WHERE id = 1 RETURNING *;

-- 2. Create audit log
INSERT INTO audit_logs (...) VALUES (...);
```

**Total: 2 queries**

### DELETE (before - with captureDeletedValues: true)

```sql
-- 1. Get before state
SELECT * FROM users WHERE id = 1;

-- 2. Delete
DELETE FROM users WHERE id = 1;

-- 3. Create audit log
INSERT INTO audit_logs (...) VALUES (...);
```

**Total: 3 queries** (old approach was 50% slower!)

## User Experience

### Before

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureOldValues: true, // For UPDATE
  captureDeletedValues: true, // For DELETE ← Confusing!
});

// User didn't know if deletes were being logged when false
```

### After

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureOldValues: true, // Only for UPDATE
  // DELETE always logs - simpler!
});

// Clear: DELETE always creates audit logs
```

## Examples

### Example 1: Single DELETE

```typescript
await db.delete(users).where(eq(users.id, 1));

// Behind the scenes:
// 1. Auto-injects .returning()
// 2. Gets deleted data: { id: 1, email: '...', name: '...' }
// 3. Creates audit log with deleted data

// Audit log:
// {
//   action: 'DELETE',
//   tableName: 'users',
//   recordId: '1',
//   oldValues: { id: 1, email: 'test@example.com', name: 'Test' },
//   newValues: null
// }
```

### Example 2: Bulk DELETE

```typescript
await db.delete(users).where(eq(users.status, "inactive"));

// Behind the scenes:
// 1. Auto-injects .returning()
// 2. Gets all deleted users
// 3. Creates audit log for each deleted record

// If 5 users were deleted, creates 5 audit logs
```

### Example 3: DELETE with no matches

```typescript
await db.delete(users).where(eq(users.id, 99999));

// Behind the scenes:
// 1. Auto-injects .returning()
// 2. Returns empty array (no records matched)
// 3. No audit log created (nothing was deleted)
```

## Audit Log Format

DELETE audit logs look like this:

```json
{
  "id": 123,
  "action": "DELETE",
  "tableName": "users",
  "recordId": "456",
  "oldValues": {
    "id": 456,
    "email": "deleted@example.com",
    "name": "Deleted User",
    "role": "user"
  },
  "newValues": null,
  "changedFields": null,
  "userId": "admin-123",
  "ipAddress": "192.168.1.1",
  "createdAt": "2026-01-29T12:00:00Z"
}
```

Note:

- `oldValues` contains the deleted data (from `.returning()`)
- `newValues` is always `null` for DELETE
- `changedFields` is always `null` for DELETE

## Migration Guide

### If you had `captureDeletedValues: false`

**Before:**

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureDeletedValues: false, // Deletes not logged ❌
});
```

**After:**

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  // captureDeletedValues removed
  // Deletes now ALWAYS logged ✓
});
```

**Impact:** You'll now get DELETE audit logs where you didn't before. This is good for audit compliance!

### If you had `captureDeletedValues: true`

**Before:**

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  captureDeletedValues: true, // Required SELECT before DELETE
});
```

**After:**

```typescript
const auditLogger = createAuditLogger(db, {
  tables: ["users"],
  // captureDeletedValues removed
  // Deletes still logged, but faster! ✓
});
```

**Impact:** Same behavior, but **50% faster** (1 query instead of 2)!

## Performance Impact

### Before (with `captureDeletedValues: true`)

- DELETE operation: **3 queries**
  1. SELECT (get before state)
  2. DELETE
  3. INSERT (audit log)

### After (always)

- DELETE operation: **2 queries**
  1. DELETE with RETURNING
  2. INSERT (audit log)

**Result: 33% fewer queries, simpler code!**

## Why This Is Better

1. **Simpler API**: One less configuration option to understand
2. **Better defaults**: DELETEs are always logged (good for audit compliance)
3. **Better performance**: Uses `.returning()` instead of SELECT + DELETE
4. **Consistent behavior**: DELETE works like INSERT/UPDATE (always logged)
5. **Less code**: Removed conditional logic for `captureDeletedValues`

## Related

- See [Auto-Returning](./AUTO_RETURNING.md) for how `.returning()` injection works
- See [Capture Configuration](./CAPTURE_CONFIG.md) for `captureOldValues` (UPDATE only)
