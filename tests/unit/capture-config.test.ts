import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text, varchar } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createAuditLogger, createAuditTableSQL, auditLogs } from "../../src/index.js";

// Test schema
const testUsers = pgTable("config_test_users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  name: text("name"),
});

describe("Capture Configuration", () => {
  let client: Client;
  let originalDb: any;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL is not set");
    }

    client = new Client(dbUrl);
    await client.connect();
    originalDb = drizzle(client);

    // Create audit table and test table
    await originalDb.execute(createAuditTableSQL);
    await originalDb.execute(`
      DROP TABLE IF EXISTS config_test_users CASCADE;
      CREATE TABLE config_test_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        name TEXT
      )
    `);
  });

  afterAll(async () => {
    await originalDb.execute("DROP TABLE IF EXISTS config_test_users CASCADE");
    await originalDb.execute("DROP TABLE IF EXISTS audit_logs CASCADE");
    await client.end();
  });

  beforeEach(async () => {
    await originalDb.execute("DELETE FROM config_test_users");
    await originalDb.execute("DELETE FROM audit_logs");
  });

  describe("captureOldValues configuration", () => {
    it("should capture old values when enabled", async () => {
      const auditLogger = createAuditLogger(originalDb, {
        tables: ["config_test_users"],
        captureOldValues: true, // Explicitly enabled
      });

      const { db, setContext } = auditLogger;
      setContext({ userId: "test-user" });

      // Insert a user
      const [user] = await db
        .insert(testUsers)
        .values({ email: "test@example.com", name: "Original Name" })
        .returning();

      // Update the user
      await db
        .update(testUsers)
        .set({ name: "Updated Name" })
        .where(eq(testUsers.id, user.id))
        .returning();

      // Check audit log
      const logs = await originalDb.select().from(auditLogs).where(eq(auditLogs.action, "UPDATE"));

      expect(logs).toHaveLength(1);
      expect(logs[0].oldValues).toBeDefined();
      expect(logs[0].oldValues).toMatchObject({ name: "Original Name" });
      expect(logs[0].newValues).toMatchObject({ name: "Updated Name" });
    });

    it("should NOT capture old values when disabled (default)", async () => {
      const auditLogger = createAuditLogger(originalDb, {
        tables: ["config_test_users"],
        captureOldValues: false, // Disabled
      });

      const { db, setContext } = auditLogger;
      setContext({ userId: "test-user" });

      // Insert a user
      const [user] = await db
        .insert(testUsers)
        .values({ email: "test@example.com", name: "Original Name" })
        .returning();

      // Update the user
      await db
        .update(testUsers)
        .set({ name: "Updated Name" })
        .where(eq(testUsers.id, user.id))
        .returning();

      // Check audit log
      const logs = await originalDb.select().from(auditLogs).where(eq(auditLogs.action, "UPDATE"));

      // Should still create an audit log, but without old values
      expect(logs).toHaveLength(1);
      expect(logs[0].oldValues).toBeNull();
      expect(logs[0].newValues).toMatchObject({ name: "Updated Name" });
    });
  });

  describe("captureDeletedValues configuration", () => {
    it("should capture deleted values when enabled", async () => {
      const auditLogger = createAuditLogger(originalDb, {
        tables: ["config_test_users"],
        captureDeletedValues: true, // Explicitly enabled
      });

      const { db, setContext } = auditLogger;
      setContext({ userId: "test-user" });

      // Insert a user
      const [user] = await db
        .insert(testUsers)
        .values({ email: "test@example.com", name: "To Be Deleted" })
        .returning();

      // Delete the user
      await db.delete(testUsers).where(eq(testUsers.id, user.id));

      // Check audit log
      const logs = await originalDb.select().from(auditLogs).where(eq(auditLogs.action, "DELETE"));

      expect(logs).toHaveLength(1);
      expect(logs[0].oldValues).toBeDefined();
      expect(logs[0].oldValues).toMatchObject({
        email: "test@example.com",
        name: "To Be Deleted",
      });
      expect(logs[0].newValues).toBeNull();
    });

    it("should NOT capture deleted values when disabled (default)", async () => {
      const auditLogger = createAuditLogger(originalDb, {
        tables: ["config_test_users"],
        captureDeletedValues: false, // Disabled
      });

      const { db, setContext } = auditLogger;
      setContext({ userId: "test-user" });

      // Insert a user
      const [user] = await db
        .insert(testUsers)
        .values({ email: "test@example.com", name: "To Be Deleted" })
        .returning();

      // Delete the user
      await db.delete(testUsers).where(eq(testUsers.id, user.id));

      // Check audit log - should not exist since we can't capture what was deleted
      const logs = await originalDb.select().from(auditLogs).where(eq(auditLogs.action, "DELETE"));

      // Without captureDeletedValues, we don't know what to log
      expect(logs).toHaveLength(0);
    });
  });

  describe("Performance benefits", () => {
    it("should skip SELECT query when captureOldValues is false", async () => {
      // This is more of a documentation test - in practice you'd profile this
      const auditLogger = createAuditLogger(originalDb, {
        tables: ["config_test_users"],
        captureOldValues: false,
      });

      const { db, setContext } = auditLogger;
      setContext({ userId: "test-user" });

      const [user] = await db
        .insert(testUsers)
        .values({ email: "test@example.com", name: "Name" })
        .returning();

      // This update won't trigger a SELECT before the UPDATE
      // In high-volume scenarios, this saves a database round-trip
      await db
        .update(testUsers)
        .set({ name: "New Name" })
        .where(eq(testUsers.id, user.id))
        .returning();

      const logs = await originalDb.select().from(auditLogs).where(eq(auditLogs.action, "UPDATE"));

      expect(logs).toHaveLength(1);
      expect(logs[0].oldValues).toBeNull();
    });
  });
});
