import { bigserial, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Audit logs table schema
 * Stores all database operation audit trails
 */
// TODO: Flexible structure, defined by the user given schema if provided, else default?
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // Who performed the action
    userId: varchar("user_id", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 45 }), // IPv6 compatible
    userAgent: text("user_agent"),

    // What action was performed
    action: varchar("action", { length: 255 }).notNull(),
    tableName: varchar("table_name", { length: 255 }).notNull(),
    recordId: varchar("record_id", { length: 255 }).notNull(),

    // Data changes
    values: jsonb("values"),

    // When it happened
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Additional context
    metadata: jsonb("metadata"),
    transactionId: varchar("transaction_id", { length: 255 }),

    // Soft delete for retention
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Indexes for common query patterns
    index("idx_audit_logs_table_record").on(table.tableName, table.recordId),
    index("idx_audit_logs_user_id").on(table.userId),
    index("idx_audit_logs_created_at").on(table.createdAt.desc()),
    index("idx_audit_logs_action").on(table.action),
    index("idx_audit_logs_table_created").on(table.tableName, table.createdAt.desc()),
  ],
);

/**
 * SQL migration to create the audit_logs table
 * Run this to set up the database
 */
const DEFAULT_TABLE_NAME = "audit_logs";

function assertSafeIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
}

function buildCreateAuditTableSQL(tableName: string): string {
  assertSafeIdentifier(tableName);

  return `
-- Prevent concurrent test runs from racing on schema creation
SELECT pg_advisory_xact_lock(913742, 540129);

CREATE SEQUENCE IF NOT EXISTS ${tableName}_id_seq;

CREATE TABLE IF NOT EXISTS ${tableName} (
  id BIGINT PRIMARY KEY DEFAULT nextval('${tableName}_id_seq'),
  
  user_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  action VARCHAR(255) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  
  "values" JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  metadata JSONB,
  transaction_id VARCHAR(255),
  
  deleted_at TIMESTAMPTZ
);

ALTER SEQUENCE ${tableName}_id_seq OWNED BY ${tableName}.id;

-- Ensure custom actions are allowed when table already exists
ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE ${tableName} ALTER COLUMN action TYPE VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON ${tableName}(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON ${tableName}(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON ${tableName}(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON ${tableName}(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON ${tableName}(table_name, created_at DESC);

COMMENT ON TABLE ${tableName} IS 'Audit trail for all database operations';
`;
}

/**
 * SQL migration to create the audit_logs table (default name)
 * Run this to set up the database
 */
export const createAuditTableSQL = buildCreateAuditTableSQL(DEFAULT_TABLE_NAME);

/**
 * SQL migration for a custom audit table name
 */
export function createAuditTableSQLFor(tableName = DEFAULT_TABLE_NAME): string {
  return buildCreateAuditTableSQL(tableName);
}
