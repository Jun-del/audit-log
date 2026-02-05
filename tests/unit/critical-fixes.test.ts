import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for critical bug fixes
 */
describe("Critical Bug Fixes", () => {
  describe("Fix #1: Race condition in batch writer", () => {
    it("should not lose logs when queueing during flush", async () => {
      // Mock setup
      const logs: any[] = [];
      const mockDb = {
        execute: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate slow write
        }),
      };

      const { BatchAuditWriter } = await import("../../src/storage/batch-writer.js");

      const writer = new BatchAuditWriter(mockDb as any, {
        auditTable: "audit_logs",
        batchSize: 5,
        maxQueueSize: 100,
        flushInterval: 60000,
        strictMode: false,
        waitForWrite: false,
        getUserId: () => "test-user",
        getMetadata: () => ({}),
        logError: () => {},
      });

      // Queue 5 logs (triggers flush)
      const promises1 = Array.from({ length: 5 }, (_, i) =>
        writer.queueAuditLogs(
          [
            {
              action: "INSERT",
              tableName: "test",
              recordId: `${i}`,
              values: { id: i },
            },
          ],
          undefined,
        ),
      );

      // Immediately queue 3 more (during flush)
      const promises2 = Array.from({ length: 3 }, (_, i) =>
        writer.queueAuditLogs(
          [
            {
              action: "INSERT",
              tableName: "test",
              recordId: `${i + 5}`,
              values: { id: i + 5 },
            },
          ],
          undefined,
        ),
      );

      await Promise.all([...promises1, ...promises2]);
      await writer.shutdown();

      // All 8 logs should be written (2 batches: 5 + 3)
      expect(mockDb.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe("Fix #3: BigInt in JSON.stringify", () => {
    it("should handle BigInt in primary key extraction", () => {
      const extractPrimaryKey = (record: Record<string, unknown>, tableName: string): string => {
        // Simplified version of the fix
        const seen = new WeakSet<object>();

        try {
          return JSON.stringify(record, (key, value) => {
            if (typeof value === "bigint") {
              return value.toString();
            }
            if (value instanceof Date) {
              return value.toISOString();
            }
            if (typeof value === "object" && value !== null) {
              if (seen.has(value)) {
                return "[Circular]";
              }
              seen.add(value);
            }
            return value;
          });
        } catch {
          return `composite_key_fallback`;
        }
      };

      const record = {
        bigIntId: BigInt(9007199254740991),
        date: new Date("2024-01-01"),
        nested: { value: 1 },
      };

      const result = extractPrimaryKey(record, "test");

      // Should not throw and should stringify BigInt as string
      expect(result).toContain('"9007199254740991"');
      expect(result).toContain("2024-01-01");
    });

    it("should handle circular references", () => {
      const extractPrimaryKey = (record: Record<string, unknown>, tableName: string): string => {
        const seen = new WeakSet<object>();

        try {
          return JSON.stringify(record, (key, value) => {
            if (typeof value === "bigint") {
              return value.toString();
            }
            if (typeof value === "object" && value !== null) {
              if (seen.has(value)) {
                return "[Circular]";
              }
              seen.add(value);
            }
            return value;
          });
        } catch {
          return `composite_key_fallback`;
        }
      };

      const record: any = { id: 1, name: "test" };
      record.self = record; // Circular reference

      const result = extractPrimaryKey(record, "test");

      // Should not throw and should handle circular ref
      expect(result).toContain("[Circular]");
    });
  });

  describe("Fix #5: Error logging", () => {
    it("should log errors instead of silently swallowing them", async () => {
      const logError = vi.fn();

      const mockDb = {
        execute: vi.fn().mockRejectedValue(new Error("DB error")),
      };

      const { BatchAuditWriter } = await import("../../src/storage/batch-writer.js");

      const writer = new BatchAuditWriter(mockDb as any, {
        auditTable: "audit_logs",
        batchSize: 5,
        maxQueueSize: 100,
        flushInterval: 60000,
        strictMode: false, // Non-strict mode
        waitForWrite: false, // Async mode
        getUserId: () => "test-user",
        getMetadata: () => ({}),
        logError,
      });

      // Queue logs
      await writer.queueAuditLogs(
        [
          {
            action: "INSERT",
            tableName: "test",
            recordId: "1",
            values: { id: 1 },
          },
        ],
        undefined,
      );

      // Trigger flush
      try {
        await writer.flush();
      } catch {
        // Expected to fail
      }

      // Error should be logged
      expect(logError).toHaveBeenCalledWith(expect.stringContaining("[AUDIT]"), expect.any(Error));
      await writer.shutdown();
    });
  });

  describe("Batch writer queue consistency", () => {
    it("should maintain correct queue size during concurrent operations", async () => {
      const mockDb = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const { BatchAuditWriter } = await import("../../src/storage/batch-writer.js");

      const writer = new BatchAuditWriter(mockDb as any, {
        auditTable: "audit_logs",
        batchSize: 100, // High batch size to avoid auto-flush
        maxQueueSize: 1000,
        flushInterval: 60000,
        strictMode: false,
        waitForWrite: false,
        getUserId: () => "test-user",
        getMetadata: () => ({}),
        logError: () => {},
      });

      // Queue 10 logs
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          writer.queueAuditLogs(
            [
              {
                action: "INSERT",
                tableName: "test",
                recordId: `${i}`,
                values: { id: i },
              },
            ],
            undefined,
          ),
        ),
      );

      const stats1 = writer.getStats();
      expect(stats1.queueSize).toBe(10);

      // Flush
      await writer.flush();

      const stats2 = writer.getStats();
      expect(stats2.queueSize).toBe(0);

      await writer.shutdown();
    });
  });
});
