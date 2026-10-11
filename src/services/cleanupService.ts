import type { D1Database } from "@cloudflare/workers-types";




export class CleanupService {
  constructor(private db: D1Database) {}







  async cleanupOldPluginLogs(daysToKeep: number = 30): Promise<{
    success: boolean;
    deletedCount: number;
    error?: string;
  }> {
    try {
      const result = await this.db
        .prepare(`
          DELETE FROM plugin_logs
          WHERE date(created_at) < date('now', '-' || ? || ' days')
        `)
        .bind(daysToKeep.toString())
        .run();

      const deletedCount = result.meta?.changes || 0;

      console.log(`Cleanup service: Deleted ${deletedCount} old plugin logs (older than ${daysToKeep} days)`);

      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      console.error("Cleanup service: Failed to delete old plugin logs", error);
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }








  async cleanupPushOutbox(daysToKeep: number = 30): Promise<{
    success: boolean;
    deletedCount: number;
    error?: string;
  }> {
    try {
      const result = await this.db
        .prepare(`
          DELETE FROM push_outbox
          WHERE status IN ('success', 'dead')
            AND datetime(updated_at) < datetime('now', '-' || ? || ' days')
        `)
        .bind(daysToKeep.toString())
        .run();

      const deletedCount = result.meta?.changes || 0;

      if (deletedCount > 0) {
        console.log(`Cleanup service: Deleted ${deletedCount} terminal push_outbox rows (older than ${daysToKeep} days)`);
      }

      return {
        success: true,
        deletedCount,
      };
    } catch (error) {
      console.error("Cleanup service: Failed to cleanup push_outbox", error);
      return {
        success: false,
        deletedCount: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }






  async getLogsStats(): Promise<{
    totalCount: number;
    oldestLog?: string;
    newestLog?: string;
  }> {
    try {

      const countResult = await this.db
        .prepare("SELECT COUNT(*) as count FROM plugin_logs")
        .first<{ count: number }>();

      const totalCount = countResult?.count || 0;


      const dateRangeResult = await this.db
        .prepare("SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM plugin_logs")
        .first<{ oldest: string; newest: string }>();

      return {
        totalCount,
        oldestLog: dateRangeResult?.oldest || undefined,
        newestLog: dateRangeResult?.newest || undefined,
      };
    } catch (error) {
      console.error("Cleanup service: Failed to get logs stats", error);
      return { totalCount: 0 };
    }
  }
}
