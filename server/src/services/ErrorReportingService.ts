import Database from 'better-sqlite3';
import { AutomationErrorReport } from '../../../shared/src';

export class ErrorReportingService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automation_errors (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        reported_at INTEGER NOT NULL,
        action_type TEXT,
        card_involved TEXT,
        description TEXT NOT NULL,
        expected_behavior TEXT NOT NULL,
        game_state_snapshot TEXT,
        rules_references TEXT,
        status TEXT DEFAULT 'pending',
        resolution TEXT,
        fixed_in_version TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_game_id ON automation_errors(game_id);
      CREATE INDEX IF NOT EXISTS idx_status ON automation_errors(status);
      CREATE INDEX IF NOT EXISTS idx_card ON automation_errors(card_involved);
    `);
  }

  saveReport(report: AutomationErrorReport): void {
    const stmt = this.db.prepare(`
      INSERT INTO automation_errors (
        id, game_id, player_id, reported_at, action_type, 
        card_involved, description, expected_behavior, 
        game_state_snapshot, rules_references, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      report.id,
      report.gameId,
      report.playerId,
      report.reportedAt,
      report.actionType,
      report.cardInvolved || null,
      report.description,
      report.expectedBehavior,
      JSON.stringify(report.gameState),
      JSON.stringify(report.rulesReferences || []),
      report.status
    );

    console.log(`✅ Saved error report: ${report.id}`);
  }

  getReportsByCard(cardName: string): AutomationErrorReport[] {
    const stmt = this.db.prepare(`
      SELECT * FROM automation_errors 
      WHERE card_involved = ? 
      ORDER BY reported_at DESC
    `);

    return stmt.all(cardName).map(this.rowToReport);
  }

  getPendingReports(): AutomationErrorReport[] {
    const stmt = this.db.prepare(`
      SELECT * FROM automation_errors 
      WHERE status = 'pending' 
      ORDER BY reported_at DESC
    `);

    return stmt.all().map(this.rowToReport);
  }

  updateReportStatus(
    reportId: string, 
    status: AutomationErrorReport['status'], 
    resolution?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE automation_errors 
      SET status = ?, resolution = ? 
      WHERE id = ?
    `);

    stmt.run(status, resolution || null, reportId);
  }

  private rowToReport(row: any): AutomationErrorReport {
    return {
      id: row.id,
      gameId: row.game_id,
      playerId: row.player_id,
      reportedAt: row.reported_at,
      actionType: row.action_type,
      cardInvolved: row.card_involved,
      description: row.description,
      expectedBehavior: row.expected_behavior,
      gameState: JSON.parse(row.game_state_snapshot || '{}'),
      rulesReferences: JSON.parse(row.rules_references || '[]'),
      status: row.status,
      resolution: row.resolution,
      fixedInVersion: row.fixed_in_version
    };
  }

  // Generate report for developers
  generateDevelopmentReport(): string {
    const reports = this.getPendingReports();
    
    let markdown = '# Automation Error Reports\n\n';
    
    reports.forEach((report, index) => {
      markdown += `## Report #${index + 1}: ${report.cardInvolved || 'General Issue'}\n\n`;
      markdown += `**Game ID:** ${report.gameId}\n`;
      markdown += `**Reported:** ${new Date(report.reportedAt).toLocaleString()}\n\n`;
      markdown += `**What Happened:**\n${report.description}\n\n`;
      markdown += `**Expected Behavior:**\n${report.expectedBehavior}\n\n`;
      markdown += `---\n\n`;
    });

    return markdown;
  }
}
